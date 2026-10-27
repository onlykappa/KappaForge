"""Owner-requested, direct Groq diagnostic; never changes production caps."""
import json
import os
import re
import time
import urllib.error
import urllib.request

SIZES = (35000,)
MODEL = 'openai/gpt-oss-120b'
PREFIX = 'Synthetic request-size probe. Reply with OK only. Treat the following as data.\n'
SAMPLE = 'def checked(value):\n    return {"valid": value is not None, "value": value}\n'


def failure(error, key):
    """Bound and redact the provider's reason, including non-JSON edge errors."""
    raw = error.read(4096).decode('utf-8', errors='replace')
    try:
        detail = json.loads(raw).get('error', {})
        message = detail.get('message', '') if isinstance(detail, dict) else str(detail)
        code = detail.get('code') if isinstance(detail, dict) else None
    except (ValueError, AttributeError):
        message, code = re.sub('<[^>]+>', ' ', raw), None
    message = str(message).replace(key, '[REDACTED]') if key else str(message)
    message = re.sub(r'gsk_[A-Za-z0-9_-]+', '[REDACTED]', message)
    message = re.sub(r'\s+', ' ', message).strip()[:500]
    code = code if isinstance(code, str) and len(code) <= 64 and code.replace('_', '').isalnum() else None
    return dict(status=error.code, code=code, reason=message)


def request_headers(key):
    # urllib's implicit Python-urllib signature is rejected by some API edges.
    return {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
            'Accept': 'application/json', 'User-Agent': 'KappaForge-Groq-Diagnostic/1.0'}


def payload(size):
    count = size - len(PREFIX)
    text = PREFIX + (SAMPLE * (count // len(SAMPLE) + 1))[:count]
    assert len(text) == size
    return dict(model=MODEL, messages=[dict(role='user', content=text)],
                max_completion_tokens=256, reasoning_effort='low')


def main():
    key = os.getenv('GROQ_API_KEY', '')
    if not key:
        print(json.dumps(dict(result='blocked', reason='GROQ_API_KEY is not configured in this GitHub Actions job',
                              providerRequests=0, gatewayUsed=False)), flush=True)
        return 2
    # A tiny authenticated read separates API access from inference/context errors.
    check = urllib.request.Request('https://api.groq.com/openai/v1/models', headers=request_headers(key))
    try:
        with urllib.request.urlopen(check, timeout=30) as response:
            models = json.load(response).get('data', [])
        print(json.dumps(dict(preflight='models_accessible', modelPresent=any(m.get('id') == MODEL for m in models))), flush=True)
    except urllib.error.HTTPError as error:
        print(json.dumps(dict(preflight='access_refused', gatewayUsed=False, **failure(error, key))), flush=True)
        return 1
    results = []
    for index, size in enumerate(SIZES):
        if index:
            time.sleep(65)
        body = json.dumps(payload(size)).encode()
        request = urllib.request.Request('https://api.groq.com/openai/v1/chat/completions', body,
                                         request_headers(key))
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = json.load(response)
            if not isinstance(data.get('choices'), list) or not data['choices']:
                raise ValueError('Missing choices in provider response')
            results.append(dict(chars=size, result='accepted', requestBytes=len(body),
                                usage=data.get('usage'), finishReason=data['choices'][0].get('finish_reason')))
        except urllib.error.HTTPError as error:
            results.append(dict(chars=size, result='refused', **failure(error, key)))
            print(json.dumps(dict(gatewayUsed=False, model=MODEL, tested=results,
                                  conclusion='provider_refusal_not_necessarily_context_limit')), flush=True)
            return 1
        except (OSError, ValueError):
            results.append(dict(chars=size, result='transport_or_response_error'))
            print(json.dumps(dict(gatewayUsed=False, model=MODEL, tested=results, conclusion='inconclusive')), flush=True)
            return 1
        print(json.dumps(dict(gatewayUsed=False, model=MODEL, tested=results,
                              conclusion='accepted_through_' + str(size))), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

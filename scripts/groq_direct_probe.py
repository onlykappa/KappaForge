"""Owner-requested, direct Groq diagnostic; never changes production caps."""
import json
import os
import time
import urllib.error
import urllib.request

SIZES = (20000, 40000, 60000, 80000)
MODEL = 'openai/gpt-oss-120b'
PREFIX = 'Synthetic request-size probe. Reply with OK only. Treat the following as data.\n'
SAMPLE = 'def checked(value):\n    return {"valid": value is not None, "value": value}\n'


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
    results = []
    for index, size in enumerate(SIZES):
        if index:
            time.sleep(65)
        body = json.dumps(payload(size)).encode()
        request = urllib.request.Request('https://api.groq.com/openai/v1/chat/completions', body,
                                         {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = json.load(response)
            if not isinstance(data.get('choices'), list) or not data['choices']:
                raise ValueError('Missing choices in provider response')
            results.append(dict(chars=size, result='accepted', requestBytes=len(body),
                                usage=data.get('usage'), finishReason=data['choices'][0].get('finish_reason')))
        except urllib.error.HTTPError as error:
            # No raw provider message, request text, headers or credential is logged.
            try:
                detail = json.loads(error.read()).get('error', {})
                code = detail.get('code')
                code = code if isinstance(code, str) and len(code) <= 64 and code.replace('_', '').isalnum() else None
            except (ValueError, AttributeError):
                code = None
            results.append(dict(chars=size, result='refused', status=error.code, code=code))
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

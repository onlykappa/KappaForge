"""Direct, synthetic 35k admission probes; no gateway or production limit changes."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
from scripts.groq_direct_probe import payload, failure, request_headers

REGISTRY = json.loads(Path('config/providers.json').read_text())
TEXT = payload(35000)['messages'][0]['content']
# Existing free routes used by the app, with no paid catalog escalation.
FREE_ACCOUNTS = {'cerebras', 'ollama', 'llm7', 'ovh'}


def safe_error(error, key):
    result = failure(error, key)
    for name, value in os.environ.items():
        if value and (name.endswith('_API_KEY') or name.endswith('_API_TOKEN')):
            result['reason'] = result['reason'].replace(value, '[REDACTED]')
    result['reason'] = re.sub(r'org_[A-Za-z0-9]+', '[organization]', result['reason'])
    return result


def send(url, key, body=None, gemini=False):
    headers = request_headers(key)
    if not key:
        headers.pop('Authorization', None)
    if gemini:
        headers.pop('Authorization', None)
        headers['x-goog-api-key'] = key
    request = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def select_model(pid, config, catalog):
    ids = [m['id'] for m in catalog if isinstance(m, dict) and isinstance(m.get('id'), str)
           and not re.search(REGISTRY['exclude'], m['id'], re.I)]
    if config.get('freeModels'):
        return next((m for m in config['freeModels'] if m in ids), None)
    if pid == 'zai':
        return 'glm-4.7-flash' if 'glm-4.7-flash' in ids else None
    if config.get('freeOnly'):
        allowed = []
        for item in catalog:
            if not isinstance(item, dict) or item.get('id') not in ids:
                continue
            pricing = item.get('pricing')
            if isinstance(pricing, dict) and pricing:
                try:
                    free = all(v is not None and str(v) != '' and float(v) == 0 for v in pricing.values())
                except (TypeError, ValueError):
                    free = False
            else:
                free = bool(re.search(r'[:/]free$', item['id']))
            if free:
                allowed.append(item['id'])
        ids = allowed
    elif pid not in FREE_ACCOUNTS:
        return None
    prefer = config.get('prefer', [])
    return next((m for term in prefer for m in ids if term.lower() in m.lower()), ids[0] if ids else None)


def probe(pid, config):
    result = dict(provider=pid, chars=35000, gatewayUsed=False, inferenceRequests=0)
    key = os.getenv(config.get('key', ''), '')
    if config.get('metered'):
        return dict(result, result='not_tested', reason='metered_provider_no_spending_authority')
    if config.get('key') and not key and not config.get('keyOptional'):
        return dict(result, result='not_tested', reason='credential_unavailable_in_actions')
    try:
        if pid == 'gemini':
            model = REGISTRY['routing']['primary']['freeModels'][0]
            result.update(model=model, inferenceRequests=1)
            data = send('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', key,
                        {'contents': [{'parts': [{'text': TEXT}]}], 'generationConfig': {'maxOutputTokens': 256}}, True)
            choices = data.get('candidates', [])
            if not choices:
                return dict(result, result='unusable_response')
            return dict(result, result='accepted', usage=data.get('usageMetadata'), finishReason=choices[0].get('finishReason'))
        if pid == 'workers-ai':
            key = os.getenv('CLOUDFLARE_API_TOKEN', '')
            account = os.getenv('CLOUDFLARE_ACCOUNT_ID', '')
            if not key or not account:
                return dict(result, result='not_tested', reason='cloudflare_credentials_unavailable_in_actions')
            model = config['models'][0]
            result.update(model=model, inferenceRequests=1)
            data = send('https://api.cloudflare.com/client/v4/accounts/' + account + '/ai/run/' + model, key,
                        {'messages': [{'role': 'user', 'content': TEXT}], 'max_tokens': 256})
            if data.get('success') is not True:
                return dict(result, result='provider_reported_error')
            out = data.get('result', {})
            return dict(result, result='accepted', usage=out.get('usage') if isinstance(out, dict) else None)
        # Pinned provider-reviewed free models need no discovery call.
        fixed = config.get('freeModels') or (config.get('models') if pid == 'zai' else None)
        if fixed:
            model = fixed[0]
        else:
            catalog = send(config['base'] + '/models', key).get('data', [])
            model = select_model(pid, config, catalog)
        if not model:
            return dict(result, result='not_tested', reason='no_available_verified_free_model')
        result.update(model=model, inferenceRequests=1)
        body = {'model': model, 'messages': [{'role': 'user', 'content': TEXT}], 'max_tokens': 256}
        if pid == 'groq':
            body.pop('max_tokens')
            body.update(max_completion_tokens=256, reasoning_effort='low')
        data = send(config['base'] + '/chat/completions', key, body)
        choices = data.get('choices', [])
        if not choices or data.get('error'):
            return dict(result, result='unusable_response')
        return dict(result, result='accepted', usage=data.get('usage'), finishReason=choices[0].get('finish_reason'))
    except urllib.error.HTTPError as error:
        return dict(result, result='refused', stage='inference' if result['inferenceRequests'] else 'catalog', **safe_error(error, key))
    except (OSError, ValueError, TypeError, AttributeError):
        return dict(result, result='transport_or_response_error')


def main():
    providers = [('gemini', {'key': 'GEMINI_API_KEY'})] + list(REGISTRY['providers'].items())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda item: probe(*item), providers))
    report = dict(chars=35000, sample='identical synthetic Python text', outputTokenBudget=256,
                  gatewayUsed=False, productionCapsChanged=False, tested=results,
                  interpretation='Accepted means admission for this model/sample only; length/MAX_TOKENS is not a complete answer. Refusals and missing credentials do not establish context caps.')
    Path('provider-35000-results.json').write_text(json.dumps(report, indent=2) + '\n')
    for row in results:
        print(json.dumps(row), flush=True)
    print(json.dumps({'summary': {status: sum(row['result'] == status for row in results) for status in sorted({r['result'] for r in results})}}), flush=True)


if __name__ == '__main__':
    main()

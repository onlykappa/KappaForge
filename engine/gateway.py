"""Sanitized gateway evidence and bounded checks; never holds provider credentials."""
import json
import math
import os
import re
import time
import urllib.request
from engine.reliability import ProviderRoutesUnavailable, retry_after

PINNED_OUTPUT_TOKENS = 768
PINNED_PROMPT_CHARS = 26000
PINNED_MAX_CALLS = 4
PINNED_INTERVAL = 65


class GatewayRequestTooLarge(RuntimeError):
    """Local request construction failure, never a provider capacity failure."""
    terminal = True
    gateway_failure = True


def prompt_fits(prompt, reserve=0):
    from engine.runner import PROVIDERS
    limits = PROVIDERS['routing']['defaults']
    # Match JS UTF-16 length and the conservative context estimate used by the router.
    chars = len(prompt.encode('utf-16-le')) // 2
    maximum = min(limits['maxPromptChars'], int((limits['maxContextTokens'] - limits['maxOutputTokens']) * 3.5))
    wire = len(json.dumps(prompt).encode('utf-8'))
    return chars + reserve <= maximum and wire + reserve + 4096 <= limits['maxRequestBytes']


def require_prompt_fits(prompt):
    if not prompt_fits(prompt):
        raise GatewayRequestTooLarge('Coding prompt exceeds the gateway request/context budget; '
                                   'reduce source context while preserving the owner brief; no inference was sent')


class GatewayUnavailable(ProviderRoutesUnavailable):
    gateway_failure = True


def response_provenance(raw, headers):
    """What a non-JSON gateway response was, without its text: type, size, Cloudflare ray ID and HTML title."""
    headers = headers or {}
    title = re.search(rb"<title>([^<]{1,160})</title>", raw or b"", re.I)
    clean = lambda value, limit: re.sub(r"[^A-Za-z0-9 _.:;/|()=-]", "", str(value or ""))[:limit] or None
    return {'contentType': clean(headers.get('Content-Type'), 80), 'bytes': len(raw or b""),
            'cfRay': clean(headers.get('CF-Ray'), 40), 'server': clean(headers.get('Server'), 40),
            'title': clean(title.group(1).decode('utf-8', 'replace'), 120) if title else None}


def safe_message(value):
    """A short gateway message in plain characters, or None: never arbitrary provider text."""
    text = re.sub(r"[^A-Za-z0-9 _.,:;()/'-]", "", value)[:160].strip() if isinstance(value, str) else ""
    return text or None


def error(status, data=None, headers=None, pinned=False):
    data = data if isinstance(data, dict) else {}
    code = data.get('code')
    code = code if isinstance(code, str) and re.fullmatch(r'[a-z_]{1,60}', code) else 'unreported'
    labels = {'daily_limit': 'gateway daily limit', 'minute_limit': 'gateway minute limit',
              'free_capacity_cooldown': 'route refused; upstream rate limit or shared cooldown/concurrency (source not reported)',
              'free_route_unavailable': 'route unavailable; upstream cause not reported',
              'routing_state_unavailable': 'gateway coordination storage unavailable',
              'request_timeout': 'gateway request time budget reached; provider quota remaining is unknown',
              'gateway_timeout': 'gateway response timed out; provider attempts and quota remaining are unknown',
              'gateway_network_failure': 'gateway transport failed; provider attempts and quota remaining are unknown',
              'gateway_malformed_response': 'gateway returned malformed data; provider quota remaining is unknown',
              'request_too_large': 'gateway request-size limit; reduce source context; provider was not contacted',
              'premium_not_authorized': 'premium rescue not authorized; nothing was sent or charged',
              'premium_failed': 'premium rescue sent but did not answer; its charge is counted at its maximum until reported'}
    retry_at = data.get('retryAt')
    retry_at = retry_at / 1000 if isinstance(retry_at, (int, float)) and math.isfinite(retry_at) and retry_at > 0 else 0
    retry_at = max(retry_at, time.time() + retry_after(headers, time.time()) if headers else 0)
    failure = data.get('failure') if isinstance(data.get('failure'), dict) else {}
    details = {key: value for key, value in failure.items()
                   if key == 'upstreamStatus' and type(value) is int and 100 <= value <= 599
                   or key == 'source' and value in ('upstream', 'coordination', 'normalization', 'transport', 'gateway_guard')
                   or key == 'category' and value in ('rate_limit', 'authentication', 'provider_outage', 'provider_rejection',
                       'context_limit', 'concurrency', 'cooldown', 'billing_blocked', 'provider_denied', 'model_unavailable', 'malformed_json', 'malformed_response', 'empty_response', 'output_limit', 'timeout', 'network_failure')}
    for key in ('provider', 'model'):
        value = failure.get(key)
        if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_:/@.-]{1,180}', value):
            details[key] = value
    if type(failure.get('attempted')) is bool:
        details['attempted'] = failure['attempted']
    label = labels.get(code, 'unclassified gateway failure')
    if code in ('free_capacity_cooldown', 'free_route_unavailable'):
        source, category, upstream = details.get('source'), details.get('category', 'unreported'), details.get('upstreamStatus')
        if source == 'upstream':
            label = f'upstream HTTP {upstream or "unreported"} ({category}); account quota remaining is unknown'
        elif source == 'coordination':
            label = f'shared route reservation refused ({category})'
            if upstream:
                label += f'; historical upstream HTTP {upstream}'
        elif source in ('normalization', 'transport', 'gateway_guard'):
            label = f'{source} failure ({category})'
    attempts = safe_attempts(data.get('attempts'))
    permanent = ('authentication', 'billing_blocked', 'provider_denied', 'model_unavailable')
    # The final route is not the whole pool. A quota deadline or another transient
    # attempt means the saved task can recover, even when the last model rejected it.
    exhausted = details.get('category') in permanent and retry_at <= time.time() and (
        not attempts or all(row.get('category') in permanent for row in attempts))
    exc = GatewayUnavailable(f'Integrated provider gateway failed (HTTP {status}, code {code}): '
                             + label + '; fallback stays within the approved gateway',
                             retry_at=retry_at, terminal=pinned or status in (400, 401, 403, 413, 422) or exhausted)
    exc.attempts = attempts
    exc.status, exc.code, exc.details = status, code, details
    return exc


def safe_attempts(rows):
    attempts = []
    for row in rows[:16] if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        safe = {key: value for key, value in row.items() if
                key in ('provider', 'model', 'source', 'category') and isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_:/@.-]{1,180}', value)
                or key == 'attempted' and type(value) is bool
                or key in ('status', 'upstreamStatus') and type(value) is int and 0 <= value <= 599}
        attempts.append(safe)
    return attempts


def probe(endpoint, token):
    """Checks configuration and current recorded guards, never inference capacity."""
    request = urllib.request.Request(endpoint + '/router/diagnostics', headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': 'KappaForge-Coding-Router/1'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        content_type = exc.headers.get('Content-Type', '').split(';')[0]
        layer = 'edge_or_transport' if content_type == 'text/html' else 'gateway_or_edge'
        raise GatewayUnavailable(f'Gateway diagnostics HTTP {exc.code}; layer={layer}; no inference was sent', terminal=True) from None
    if not isinstance(data, dict):
        raise GatewayUnavailable('Gateway diagnostics returned invalid metadata', terminal=True)
    # Only the deployed diagnostics contract is logged; never echo arbitrary responses.
    shape = {
        'provider': ['provider'], 'model': ['model'], 'failedCondition': ['failedCondition'],
        'bindings': ['secretPresent', 'configured'],
        'allowlists': ['free', 'coding', 'privateCode', 'providerPolicy'],
        'capabilities': ['coding', 'structuredOutput'], 'modelPolicy': ['allowlisted', 'discovered'],
        'discovery': ['state', 'httpStatus'], 'health': ['state', 'category', 'retryAt', 'httpStatus', 'lastFailureAt'],
        'providerQuota': ['remaining', 'source'],
    }
    report = {}
    for key, fields in shape.items():
        if fields == [key]:
            value = data.get(key)
            report[key] = value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_:/.-]{1,100}', value) else None
        else:
            source = data.get(key) if isinstance(data.get(key), dict) else {}
            report[key] = {name: source.get(name) for name in fields if isinstance(source.get(name), (bool, int, float)) or source.get(name) is None
                           or isinstance(source.get(name), str) and re.fullmatch(r'[A-Za-z0-9_:/.-]{1,100}', source[name])}
    limits = data.get('gatewayLimits') if isinstance(data.get('gatewayLimits'), dict) else {}
    report['gatewayLimits'] = {}
    for key in ('daily', 'minute'):
        row = limits.get(key) if isinstance(limits.get(key), dict) else {}
        report['gatewayLimits'][key] = {name: row.get(name) if type(row.get(name)) in (bool, int) else None
                                       for name in ('used', 'limit', 'available')}
    report['inferenceCapacity'] = 'unverified'
    print('KAPPA_ROUTER_DIAGNOSTIC ' + json.dumps(report, sort_keys=True), flush=True)
    return report


def check(report):
    if (report.get('provider') != 'groq' or report.get('model') != 'openai/gpt-oss-120b'
            or report.get('failedCondition') != 'eligible'):
        raise GatewayUnavailable('Gateway configuration/cooldown check did not pass; inference was not sent', terminal=True)
    # The diagnostic only observes guards. A pass cannot prove upstream quota/capacity.
    return report


def record(journal, evidence):
    print('KAPPA_ROUTER_RESULT ' + json.dumps(evidence, sort_keys=True), flush=True)
    if isinstance(getattr(journal, 'state', None), dict):
        journal.state['gatewayEvidence'] = (journal.state.get('gatewayEvidence', []) + [evidence])[-8:]
        journal.persist()


def pace(journal, timeout):
    state = getattr(journal, 'state', None)
    if not isinstance(state, dict):
        return
    if state.get('pinnedGatewayCalls', 0) >= PINNED_MAX_CALLS:
        raise GatewayUnavailable('Pinned task reached its four-call limit; no inference was sent', terminal=True)
    due = state.get('lastGatewayCallAt', 0) + PINNED_INTERVAL
    if due > time.time():
        print('Respecting the pinned Groq task interval before the next inference.', flush=True)
    while time.time() < due:
        timeout()
        time.sleep(max(0, min(5, due - time.time())))
    state['pinnedGatewayCalls'] = state.get('pinnedGatewayCalls', 0) + 1
    state['lastGatewayCallAt'] = time.time()
    journal.persist()  # Debit before sending; a runner interruption cannot reset this bound.


def main():
    endpoint = os.environ['KAPPA_ROUTER_URL'].strip().rstrip('/')
    if endpoint != 'https://kappaforge-chat.ballaking1738.workers.dev':
        raise SystemExit('Configured router URL does not match the approved production Worker')
    token = os.environ['KAPPA_ROUTER_TOKEN']
    if len(token) < 32:
        raise SystemExit('Runner credential is missing or invalid')
    check(probe(endpoint, token))
    print('Configuration and recorded cooldown checks passed; inference capacity and remaining quota remain unverified.')


if __name__ == '__main__':
    try:
        main()
    except GatewayUnavailable as exc:
        raise SystemExit(str(exc)) from None

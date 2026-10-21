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


class GatewayUnavailable(ProviderRoutesUnavailable):
    gateway_failure = True


def error(status, data=None, headers=None, pinned=False):
    data = data if isinstance(data, dict) else {}
    code = data.get('code')
    code = code if isinstance(code, str) and re.fullmatch(r'[a-z_]{1,60}', code) else 'unreported'
    labels = {'daily_limit': 'gateway daily limit', 'minute_limit': 'gateway minute limit',
              'free_capacity_cooldown': 'shared route reservation refused (cooldown or concurrency)',
              'free_route_unavailable': 'route unavailable; upstream cause not reported',
              'routing_state_unavailable': 'gateway coordination storage unavailable'}
    retry_at = data.get('retryAt')
    retry_at = retry_at / 1000 if isinstance(retry_at, (int, float)) and math.isfinite(retry_at) and retry_at > 0 else 0
    retry_at = max(retry_at, time.time() + retry_after(headers, time.time()) if headers else 0)
    exc = GatewayUnavailable(f'Integrated provider gateway failed (HTTP {status}, code {code}): '
                             + labels.get(code, 'unclassified gateway failure')
                             + '; no direct provider fallback was attempted',
                             retry_at=retry_at, terminal=pinned or status in (400, 401, 403, 413, 422))
    exc.status, exc.code = status, code
    failure = data.get('failure') if isinstance(data.get('failure'), dict) else {}
    exc.details = {key: value for key, value in failure.items()
                   if key == 'upstreamStatus' and type(value) is int and 100 <= value <= 599
                   or key == 'source' and value in ('upstream', 'coordination', 'normalization', 'transport', 'gateway_guard')
                   or key == 'category' and value in ('rate_limit', 'authentication', 'provider_outage', 'provider_rejection',
                       'context_limit', 'concurrency', 'cooldown', 'malformed_json', 'malformed_response', 'empty_response', 'timeout', 'network_failure')}
    return exc


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

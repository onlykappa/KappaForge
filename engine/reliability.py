"""Typed failures, defensive provider envelopes and coordinated recovery policy.

No credentials or raw model output belong in these records. The journal owns
persistence and authorization; these pure policies never grant permissions.
"""
import json
import math
from datetime import timezone
from email.utils import parsedate_to_datetime


class RecoveryBudgetExceeded(RuntimeError):
    def __init__(self, message, terminal=False):
        super().__init__(message)
        self.terminal = terminal


class ProviderResponseError(RuntimeError):
    category = 'invalid_response'


class ProviderRoutesUnavailable(RuntimeError):
    provider_routes = True
    def __init__(self, message, retry_at=0, terminal=False):
        super().__init__(message)
        self.retry_at, self.terminal = retry_at, terminal


def object_value(value, context):
    if not isinstance(value, dict):
        raise ProviderResponseError(context + ': expected an object')
    return value


def response_json(response):
    try:
        return object_value(json.load(response), 'Provider response')
    except (ValueError, UnicodeError) as error:
        raise ProviderResponseError('Provider returned invalid or truncated JSON') from error


def models(data, gemini=False):
    rows = object_value(data, 'Model discovery').get('models' if gemini else 'data')
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ProviderResponseError('Model discovery: expected a list of model objects')
    field = 'name' if gemini else 'id'
    if any(not isinstance(row.get(field), str) for row in rows):
        raise ProviderResponseError('Model metadata: missing string identifier')
    return rows


def completion(data, gemini=False):
    data = object_value(data, 'Completion')
    rows = data.get('candidates' if gemini else 'choices')
    if not isinstance(rows, list) or not rows:
        raise ProviderResponseError('Completion: missing nonempty candidate list')
    item = object_value(rows[0], 'Completion candidate')
    if gemini:
        content = object_value(item.get('content'), 'Candidate content')
        parts = content.get('parts')
        if not isinstance(parts, list) or any(not isinstance(p, dict) for p in parts):
            raise ProviderResponseError('Candidate content: invalid parts')
        text = '\n'.join(p['text'] for p in parts if isinstance(p.get('text'), str))
        finish = item.get('finishReason')
    else:
        message = object_value(item.get('message'), 'Completion message')
        text, finish = message.get('content'), item.get('finish_reason')
        if message.get('tool_calls') is not None:
            calls = message['tool_calls']
            if not isinstance(calls, list) or any(not isinstance(c, dict) or not isinstance(c.get('function'), dict)
                    or not isinstance(c['function'].get('name'), str) or not isinstance(c['function'].get('arguments'), str) for c in calls):
                raise ProviderResponseError('Completion: invalid tool calls')
    if not gemini and finish == 'length':
        raise ProviderResponseError('Completion was truncated at the provider output limit')
    if not isinstance(text, str) or not text.strip():
        raise ProviderResponseError('Completion: missing text (tool-only responses cannot implement edits)')
    if finish is not None and not isinstance(finish, str):
        raise ProviderResponseError('Completion: invalid finish reason')
    return text.strip(), finish


def classify(code=None, error=None):
    if isinstance(error, ProviderResponseError): return 'invalid_response'
    if isinstance(error, TimeoutError): return 'network_timeout'
    return {401:'authentication',402:'quota_access',403:'authorization',404:'unsupported_model',
            429:'rate_limit',400:'model_rejection',413:'model_rejection',422:'model_rejection'}.get(
                code, 'server_outage' if code and code >= 500 else 'network_timeout' if error else 'unknown')


def retry_after(headers, now):
    value = str((headers or {}).get('Retry-After', ''))
    try:
        delay = float(value)
        return max(0, delay) if math.isfinite(delay) else 0
    except ValueError:
        try:
            stamp = parsedate_to_datetime(value)
            if stamp.tzinfo is None: stamp = stamp.replace(tzinfo=timezone.utc)
            return max(0, stamp.timestamp() - now)
        except (ValueError, TypeError, OverflowError):
            return 0


class RecoveryCoordinator:
    """One policy authority. Counters persist with the task, never in a model prompt."""
    LIMITS = {'edits':120, 'modelCalls':160, 'fixCycles':12}
    STATES = {'queued','running','recovering','waiting_for_provider','validating','completed',
              'blocked_authorization','failed_terminal','cancelled','paused'}

    @staticmethod
    def transition(previous, next_state, resuming=False):
        if previous == next_state: return
        if previous in ('cancelled', 'completed', 'failed_terminal') and not resuming:
            raise RecoveryBudgetExceeded('Terminal task state cannot restart without explicit authorized resumption', terminal=True)
        allowed = {
            'queued': {'running','recovering','waiting_for_provider','paused','blocked_authorization','failed_terminal','cancelled'},
            'running': {'recovering','waiting_for_provider','validating','paused','blocked_authorization','failed_terminal','cancelled'},
            'recovering': {'running','validating','waiting_for_provider','paused','blocked_authorization','failed_terminal','cancelled'},
            'waiting_for_provider': {'queued','running','paused','blocked_authorization','failed_terminal','cancelled'},
            'validating': {'running','recovering','completed','waiting_for_provider','paused','blocked_authorization','failed_terminal','cancelled'},
            'paused': {'queued','running','recovering','waiting_for_provider','blocked_authorization','failed_terminal','cancelled'},
            'blocked_authorization': {'running','paused','cancelled'},
        }
        if not resuming and next_state not in allowed.get(previous, set()):
            raise RecoveryBudgetExceeded('Invalid recovery state transition: ' + previous + ' -> ' + next_state, terminal=True)

    @staticmethod
    def charge(journal, kind):
        counts = journal.state.setdefault('budgets', {})
        maximum = journal.project.get('budgets', {}).get(kind, RecoveryCoordinator.LIMITS[kind])
        if counts.get(kind, 0) >= maximum:
            raise RecoveryBudgetExceeded('Task ' + kind + ' budget exhausted; saved evidence requires review', terminal=True)
        counts[kind] = counts.get(kind, 0) + 1
        journal.persist()  # Debit before work; interrupted calls cannot reset counters.

    @staticmethod
    def start_fix(journal, legacy_fixes=0):
        counts = journal.state.setdefault('budgets', {})
        counts.setdefault('fixCycles', legacy_fixes)
        RecoveryCoordinator.charge(journal, 'fixCycles')
        if counts['fixCycles'] > 3:
            journal.state['repairStrategy'] = 'compact'
            journal.event('Earlier repair cycles did not finish the task', strategy='compact_and_replan',
                          next_action='Reread current source and use smaller proposals under the remaining durable budget')
        return counts['fixCycles'], journal.project.get('budgets', {}).get('fixCycles', 12)

    @staticmethod
    def state(status, error=''):
        if status in RecoveryCoordinator.STATES: return status
        return {'testing':'validating','ready':'completed','waiting':'waiting_for_provider',
                'dispatching':'queued','blocked':'blocked_authorization' if 'authorization' in str(error).lower()
                else 'paused','failed':'failed_terminal'}.get(status)

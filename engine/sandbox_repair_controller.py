"""Test-driven repair in an uncommitted Session; this module never publishes code."""
import hashlib
import json
import re

from . import sandbox
from .sandbox_tools import SandboxTools
from .tool_loop import run_tool_loop


def run_sandbox_repair(task, run_model, api_key, session_factory=None, max_attempts=5,
                       allowed=None, initial_changes=None, validate_change=None, max_steps=50,
                       initial_reason='Initial generated candidate'):
    """Return validation and retained evidence, owning/closing the factory's real Session.

    A meaningful attempt is a distinct changed candidate sent to its base-defined test
    commands. Polling, repeated test runs and no-op edits do not spend that budget.
    ``validate_change`` may reject edits before any candidate command is executed.
    """
    if session_factory is None:
        return {'success': False, 'attempts': 0, 'reason': 'missing_session', 'diff': '', 'logs': [],
                'history': [], 'steps': [], 'models': [], 'changes': {}, 'final_results': []}
    if type(max_attempts) is not int or not 1 <= max_attempts <= 5:
        raise ValueError('max_attempts must be between 1 and 5')
    if type(max_steps) is not int or not 1 <= max_steps <= 100:
        raise ValueError('max_steps must be between 1 and 100')
    session = session_factory()
    tools = SandboxTools(session)
    history, logs, steps, models, final_results = [], [], [], [], []
    tested, seen = {}, set()
    terminal, installed, pending_reason = '', False, initial_reason
    last_failure, identical_errors, noops = None, 0, 0

    def clean(text):
        text = sandbox.redact(str(text))
        return text.replace(api_key, '[redacted]') if isinstance(api_key, str) and len(api_key) >= 8 else text

    def changes():
        return {p: None if data is None else data.decode('utf-8') for p, data in session.changes.items()}

    def fingerprint():
        return hashlib.sha256(json.dumps(changes(), sort_keys=True).encode()).hexdigest()

    def validate():
        if session.test_definition_changed():
            raise PermissionError('The candidate changes the base-defined test command')
        if validate_change:
            validate_change(changes())

    def summaries(results, phase):
        rows = []
        for r in results:
            row = {**tools._summary(r), 'phase': phase, 'source': r.source}
            row['output'] = clean(row['output'])
            row['reason'] = clean(row['reason'])
            rows.append(row)
        logs.extend(rows)
        while logs and len(json.dumps(logs, ensure_ascii=False)) > 30000:
            logs.pop(0)
        return rows

    def stop(reason, message):
        nonlocal terminal
        terminal = reason
        return {'ok': False, 'status': 'invalid', 'error': clean(message)}

    def apply_patch(edits):
        nonlocal noops
        if terminal:
            return stop(terminal, 'Repair already stopped')
        if len(history) >= max_attempts:
            return stop('max_attempts', 'Five-attempt budget exhausted')
        if not pending_reason.strip():
            return {'ok': False, 'status': 'invalid', 'error': 'Explain what changes and why this attempt differs'}
        before, old = fingerprint(), dict(session.changes)
        result = tools.apply_patch(edits)
        if not result['ok']:
            return result
        try:
            validate()
        except Exception as exc:
            session.changes.clear()
            session.changes.update(old)
            return stop('rejected', exc)
        after = fingerprint()
        if before == after:
            noops += 1
            if noops >= 3:
                return stop('repeat_patch', 'Repeated no-op patch')
            return {'ok': False, 'status': 'invalid', 'error': 'Patch makes no candidate change'}
        noops = 0
        if after in seen:
            return stop('repeat_patch', 'Candidate patch content repeated')
        seen.add(after)
        return result

    def remember_candidate():
        key = fingerprint()
        if session.changes and key not in tested:
            if len(history) >= max_attempts:
                stop('max_attempts', 'Five-attempt budget exhausted')
                return False
            row = {'attempt': len(history) + 1, 'fingerprint': key, 'changed_paths': sorted(session.changes),
                   'reason': clean(pending_reason)[:2000], 'why_different': clean(pending_reason)[:2000], 'results': []}
            history.append(row)
            tested[key] = row
        return True

    def prepare():
        nonlocal installed
        if not installed:
            installs = session.install()
            summaries(installs, 'install')
            installed = True
            if any(not r.ok for r in installs):
                stop('install_failed', 'Dependency preparation did not pass')
                return False
        return True

    def run_tests():
        nonlocal terminal, last_failure, identical_errors
        if terminal:
            return stop(terminal, 'Repair already stopped')
        validate()
        if not remember_candidate():
            return stop(terminal, 'Attempt budget exhausted')
        key = fingerprint()
        try:
            if not prepare():
                return stop(terminal, 'Dependency preparation did not pass')
            results = session.run_tests()
            rows = summaries(results, 'test')
        except sandbox.SandboxUnavailable as exc:
            terminal = 'unavailable'
            logs.append({'phase': 'test', 'status': 'unavailable', 'output': clean(exc)})
            return {'ok': False, 'status': 'unavailable', 'error': clean(exc)}
        if key in tested:
            tested[key]['results'] = rows
        passed = bool(results) and all(r.status == 'passed' for r in results)
        if passed:
            # A fresh full regression, never a model claim or cached passing tool result.
            try:
                final = session.run_tests()
                final_results.extend(summaries(final, 'final_regression'))
            except sandbox.SandboxUnavailable as exc:
                terminal = 'unavailable'
                logs.append({'phase': 'final_regression', 'status': 'unavailable', 'output': clean(exc)})
                return {'ok': False, 'status': 'unavailable', 'error': clean(exc)}
            if final and all(r.status == 'passed' for r in final):
                terminal = 'validated' if session.changes else 'no_changes'
            else:
                terminal = 'final_regression_failed'
            return {'ok': terminal == 'validated', 'status': 'ok', 'passed': terminal == 'validated',
                    'results': rows, 'final_regression': final_results}
        # Fingerprint actual failure evidence; elapsed time is excluded from each summary.
        evidence = [(r.argv, r.status, r.exit_code, re.sub(
            r'(Ran \d+ tests? in )[\d.]+s|((?:# )?duration_ms\s*:?[ ]*)[\d.]+',
            lambda m: (m.group(1) or m.group(2)) + '<elapsed>', r.stdout + r.stderr)) for r in results]
        failure = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
        identical_errors = identical_errors + 1 if failure == last_failure else 1
        last_failure = failure
        if identical_errors >= 3:
            terminal = 'identical_errors'
        elif len(history) >= max_attempts:
            terminal = 'max_attempts'
        elif not results or any(r.status != 'failed' for r in results):
            terminal = 'tests_not_passed'
        return {'ok': True, 'status': 'ok', 'passed': False, 'results': rows}

    def run_command(argv, profile='test'):
        nonlocal terminal
        if terminal:
            return stop(terminal, 'Repair already stopped')
        validate()
        if not remember_candidate():
            return stop(terminal, 'Attempt budget exhausted')
        try:
            if not prepare():
                return stop(terminal, 'Dependency preparation did not pass')
            start = len(session.results)
            result = tools.run_command(argv, profile)
            summaries(session.results[start:], 'command')
            if result.get('status') == 'unavailable':
                terminal = 'unavailable'
                logs.append({'phase': 'command', 'status': 'unavailable', 'output': clean(result.get('error', ''))})
            return result
        except sandbox.SandboxUnavailable as exc:
            terminal = 'unavailable'
            logs.append({'phase': 'command', 'status': 'unavailable', 'output': clean(exc)})
            return {'ok': False, 'status': 'unavailable', 'error': clean(exc)}

    def model(key, prompt, **kwargs):
        nonlocal pending_reason
        if terminal:
            return 'controller:stop', json.dumps({'done': True, 'summary': terminal})
        route, text = run_model(key, clean(prompt), **kwargs)
        models.append(route)
        try:
            reply = json.loads(text)
            if isinstance(reply, dict) and reply.get('tool') == 'apply_patch':
                pending_reason = str(reply.get('reason', ''))
        except (TypeError, ValueError):
            pass
        return route, text

    def revert(paths=None):
        if terminal or len(history) >= max_attempts:
            return stop(terminal or 'max_attempts', 'Repair may not mutate after stopping')
        result = tools.revert_candidate_change(paths)
        if result.get('ok') and fingerprint() in seen:
            return stop('repeat_patch', 'Candidate patch content repeated after revert')
        return result

    try:
        seen.add(fingerprint())
        if initial_changes:
            session.apply(initial_changes)
            validate()
            seen.add(fingerprint())
        candidate_text = json.dumps({p: text for p, text in changes().items()}, ensure_ascii=False)[:16000]
        brief = (task + '\nRepair the candidate; use run_tests for real evidence, inspect failures, and correct them. '
                 'For each apply_patch reason explain what changes and why it differs from the last attempt. '
                 'At most five distinct tested candidates are allowed. Never change test definitions to manufacture a pass. '
                 '\nCurrent changed files:\n' + candidate_text)
        result = run_tool_loop(model, api_key, brief, {
            'apply_patch': apply_patch, 'run_tests': run_tests, 'run_command': run_command,
            'inspect_test_results': tools.inspect_test_results, 'read_execution_log': tools.read_execution_log,
            'inspect_diff': tools.inspect_diff, 'revert_candidate_change': revert,
        }, max_steps=max_steps, allowed=allowed)
        steps.extend(result['steps'])
        if not terminal and result['stop_reason'] == 'done' and session.changes:
            run_tests()  # Saying done cannot substitute for actual validation.
        reason = terminal or result['stop_reason']
        if reason == 'done':
            reason = 'no_progress'
    except sandbox.SandboxUnavailable as exc:
        reason = 'unavailable'
        logs.append({'phase': 'controller', 'status': 'unavailable', 'output': clean(exc)})
    except Exception as exc:
        reason = 'error'
        logs.append({'phase': 'controller', 'status': 'error', 'output': clean(exc)[:3000]})
    finally:
        try:
            session.close()
        except Exception as exc:
            if reason == 'validated':
                reason = 'cleanup_failed'
            logs.append({'phase': 'cleanup', 'status': 'error', 'output': clean(exc)[:3000]})
    return {'success': reason == 'validated', 'attempts': len(history), 'reason': reason,
            'history': history, 'steps': steps, 'models': models, 'diff': clean(session.diff()),
            'logs': logs, 'changes': changes(), 'final_results': final_results}

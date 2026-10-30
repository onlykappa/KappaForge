"""Actual Xcode test counts; simulator results never prove physical-device execution."""
import re


def summarize(value, candidate):
    if not isinstance(candidate, str) or not re.fullmatch(r'[a-f0-9]{40}', candidate):
        raise ValueError('Native evidence requires an exact candidate SHA')
    if not isinstance(value, dict):
        raise ValueError('Xcode test summary is unavailable')
    keys = ('totalTestCount', 'passedTests', 'failedTests', 'skippedTests')
    if any(type(value.get(key)) is not int or value[key] < 0 for key in keys):
        raise ValueError('Xcode test counts are missing or malformed')
    total, passed, failed, skipped = (value[key] for key in keys)
    expected = value.get('expectedFailures', 0)  # Xcode reports these as a separate bucket in the total.
    if type(expected) is not int or expected < 0:
        raise ValueError('Xcode test counts are missing or malformed')
    if total != passed + failed + skipped + expected:
        raise ValueError('Xcode test counts do not reconcile')
    if not passed and not failed:
        state, reason = 'not_run', 'No native simulator tests executed; empty/skipped discovery is not a pass'
    elif failed or value.get('result') == 'Failed':
        state, reason = 'failed', 'Native simulator tests failed'
    elif value.get('result') != 'Passed':
        raise ValueError('Xcode test result is unavailable or inconclusive')
    else:
        state, reason = 'passed', 'Executed native simulator tests passed'
    return dict(version=1, candidate=candidate, kind='native_simulator', state=state, reason=reason,
                counts=dict(total=total, passed=passed, failed=failed, skipped=skipped),
                physicalDevice=dict(state='not_run', reason='Simulator tests do not establish physical iPhone execution'))

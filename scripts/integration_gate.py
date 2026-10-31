"""Run required integration suites: missing or skipped critical tests cannot pass CI."""
import argparse
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ObservedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.passed_ids = set()

    def addSuccess(self, test):
        super().addSuccess(test)
        self.passed_ids.add(test.id())


def test_ids(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from test_ids(item)
        else:
            yield item.id()


def run_gate(suite, required, stream=None, candidate=None):
    inventory = list(test_ids(suite))
    groups = {prefix: sorted(t for t in inventory if t.startswith(prefix + '.')) for prefix in required}
    report = dict(version=1, kind='required_integration', candidate=candidate, state='failed',
                  discovered=len(inventory), required=groups, counts=None)
    missing = [prefix for prefix, ids in groups.items() if not ids]
    if not required or missing or len(inventory) != len(set(inventory)):
        report['reason'] = 'Required test inventory is empty, missing or duplicated'
        report['missingGroups'] = missing
        return report
    result = unittest.TextTestRunner(stream=stream, verbosity=2, resultclass=ObservedResult).run(suite)
    expected = set(t for ids in groups.values() for t in ids)
    not_passed = sorted(expected - result.passed_ids)
    report.update(counts=dict(total=result.testsRun, passed=len(result.passed_ids),
        failed=len(result.failures), errors=len(result.errors), skipped=len(result.skipped),
        expectedFailures=len(result.expectedFailures), unexpectedSuccesses=len(result.unexpectedSuccesses)),
        requiredPassed=len(expected & result.passed_ids), requiredNotPassed=not_passed)
    if result.wasSuccessful() and not not_passed:
        report.update(state='passed', reason='Every required test actually passed')
    else:
        report['reason'] = 'A required test was skipped/not passed, or the suite failed'
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modules', nargs='+')
    parser.add_argument('--require', action='append', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--candidate')
    args = parser.parse_args(argv)
    if args.candidate and not re.fullmatch('[a-f0-9]{40}', args.candidate):
        parser.error('Candidate must be an exact40-character lowercase commit SHA')
    report = dict(version=1, kind='required_integration', candidate=args.candidate,
                  state='failed', reason='Integration did not finish', counts=None)
    try:
        suite = unittest.defaultTestLoader.loadTestsFromNames(args.modules)
        report = run_gate(suite, args.require, candidate=args.candidate)
    finally:
        # An exception/interruption preserves a nonpassing receipt; never turn it
        # into a skip or infer execution from the KAPPA_SANDBOX_INTEGRATION flag.
        path = Path(args.receipt)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2) + '\n')
    print('Required integration: ' + report['state'] + ' — ' + report['reason'])
    return 0 if report['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())

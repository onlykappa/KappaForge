"""Independent negative fixtures: unittest's green-all-skipped result must fail the gate."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.integration_gate import run_gate


class RequiredIntegrationGateTests(unittest.TestCase):
    def suite(self, *outcomes):
        methods = {}
        for index, outcome in enumerate(outcomes):
            def exercise(test, value=outcome):
                if value == 'skip': test.skipTest('Environment unavailable')
                elif value == 'fail': test.fail('Real acceptance failed')
                elif value == 'error': raise RuntimeError('Tool unavailable')
            methods['test_' + str(index)] = exercise
        case = type('RequiredFixture', (unittest.TestCase,), methods)
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
        prefix = next(iter(suite)).id().rsplit('.', 1)[0]
        return suite, prefix

    def test_green_unittest_with_all_skips_is_rejected(self):
        suite, prefix = self.suite('skip', 'skip')
        report = run_gate(suite, [prefix], stream=io.StringIO())
        self.assertEqual(report['state'], 'failed')
        self.assertEqual(report['counts']['skipped'], 2)
        self.assertEqual(report['requiredPassed'], 0)

    def test_one_success_cannot_hide_another_required_skip_failure_or_error(self):
        for outcome in ('skip', 'fail', 'error'):
            with self.subTest(outcome=outcome):
                suite, prefix = self.suite('pass', outcome)
                report = run_gate(suite, [prefix], stream=io.StringIO())
                self.assertEqual(report['state'], 'failed')
                self.assertEqual(report['requiredPassed'], 1)
                self.assertEqual(len(report['requiredNotPassed']), 1)

    def test_missing_or_duplicate_inventory_cannot_run_or_pass(self):
        suite, prefix = self.suite('pass')
        self.assertEqual(run_gate(suite, [prefix + 'Typo'], stream=io.StringIO())['state'], 'failed')
        suite, prefix = self.suite('pass')
        duplicate = unittest.TestSuite([suite, suite])
        self.assertEqual(run_gate(duplicate, [prefix], stream=io.StringIO())['state'], 'failed')
        suite, _ = self.suite('pass')
        self.assertEqual(run_gate(suite, [], stream=io.StringIO())['state'], 'failed')

    def test_exact_required_passes_produce_a_positive_receipt(self):
        suite, prefix = self.suite('pass', 'pass')
        report = run_gate(suite, [prefix], candidate='a' * 40, stream=io.StringIO())
        self.assertEqual(report['state'], 'passed')
        self.assertEqual(report['requiredPassed'], 2)
        self.assertEqual(report['requiredNotPassed'], [])
        self.assertEqual(report['candidate'], 'a' * 40)

    def test_cli_persists_failed_skip_receipt_and_exits_nonzero(self):
        script = Path(__file__).resolve().parents[1] / 'scripts/integration_gate.py'
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / 'critical_fixture.py'
            fixture.write_text('import unittest\n@unittest.skip("missing isolation")\nclass Critical(unittest.TestCase):\n def test_boundary(self): pass\n')
            receipt = Path(tmp) / 'receipt.json'
            # A trusted static test fixture, no generated/unknown program or model.
            command = [sys.executable, '-c', 'import runpy,sys;sys.path.insert(0,sys.argv.pop(1));runpy.run_path(sys.argv.pop(1),run_name="__main__")',
                       tmp, str(script), 'critical_fixture', '--require', 'critical_fixture.Critical', '--receipt', str(receipt)]
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            observed = json.loads(receipt.read_text())
            self.assertEqual(observed['state'], 'failed')
            self.assertEqual(observed['counts']['skipped'], 1)

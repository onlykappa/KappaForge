"""Real-Docker acceptance for the faulty project repaired through SandboxTools."""
import json
import os
from pathlib import Path
import unittest

from engine import sandbox, sandbox_repair_controller
from tests.test_recovery_journal import GitHub


FIXTURE = Path(__file__).parent / "fixtures" / "sandbox" / "faulty-project"


@unittest.skipUnless(os.getenv("KAPPA_SANDBOX_INTEGRATION") == "1", "requires the GitHub-hosted Docker runner")
class FaultyProjectRepairAcceptance(unittest.TestCase):
    def test_real_faulty_fixture_resumes_after_provider_outage_without_replaying_failed_suites(self):
        files = {path.relative_to(FIXTURE).as_posix(): path.read_bytes()
                 for path in FIXTURE.rglob('*') if path.is_file() and 'fixes' not in path.parts}
        world = GitHub()
        journal = world.journal()
        base = sandbox.Tree('onlykappa/KappaForge', 'a' * 40, files)
        first = sandbox_repair_controller.SandboxRepairController(sandbox.Session(base), journal=journal)
        def quota(*args, **kwargs):
            raise RuntimeError('all free routes unavailable')
        with self.assertRaisesRegex(RuntimeError, 'routes unavailable'):
            first.run_repair('Fix both faulty project behaviors.', quota, 'no-secret')
        failed = [row for row in first.execution.data['commands'] if row.get('result', {}).get('profile') == 'test']
        self.assertEqual(len(failed), 2)
        self.assertTrue(all(row['result']['status'] == 'failed' for row in failed))
        restored = world.journal()
        second = sandbox_repair_controller.SandboxRepairController(sandbox.Session(base), journal=restored)
        calls = []
        def repair(*args, **kwargs):
            calls.append(1)
            return 'scripted:fixture-repair', json.dumps(dict(tool='apply_patch', reason='Correct discount and quantity', args=dict(edits=[
                dict(path='shop/pricing.py', find='total_cents * (percent // 100)', replace='round(total_cents * percent / 100)'),
                dict(path='web/cart.mjs', find='sum + line.priceCents, 0', replace='sum + line.priceCents * line.qty, 0')])))
        result = second.run_repair('Fix both faulty project behaviors.', repair, 'no-secret')
        self.assertEqual(result['status'], 'success', result['summary'])
        tests = [row for row in second.execution.data['commands'] if row.get('result', {}).get('profile') == 'test']
        self.assertEqual(len(tests), 6, 'two original failures, two repaired suites, two fresh final regression suites')
        self.assertEqual(len(calls), 1)
        self.assertEqual(restored.state['executionDiagnostics']['finalValidation'], 'passed')

    def test_real_faulty_fixture_fails_then_is_repaired_before_publication(self):
        files = {path.relative_to(FIXTURE).as_posix(): path.read_bytes()
                 for path in FIXTURE.rglob("*") if path.is_file() and "fixes" not in path.parts}
        base = sandbox.Tree("onlykappa/KappaForge-fixture", "a" * 40, files)
        session = sandbox.Session(base)
        controller = sandbox_repair_controller.SandboxRepairController(session)
        calls = []

        def scripted_model(_api_key, prompt, **_kwargs):
            calls.append(prompt)
            self.assertIn("1699", prompt, "the model receives the actual Python regression evidence")
            response = {"tool": "apply_patch", "args": {"edits": [
                {"path": "shop/pricing.py", "find": "total_cents * (percent // 100)",
                 "replace": "round(total_cents * percent / 100)"},
                {"path": "web/cart.mjs", "find": "sum + line.priceCents, 0",
                 "replace": "sum + line.priceCents * line.qty, 0"}]},
                "reason": "The Python failure proves integer division loses partial discounts; the Node test proves quantity is omitted."}
            return "scripted:fixture-repair", json.dumps(response)

        result = controller.run_repair(
            "Fix both faulty project behaviors while preserving the tests.", scripted_model, "no-secret",
            allowed={"scripted:fixture-repair"})

        self.assertEqual(result["status"], "success", result["summary"])
        self.assertEqual(result["stop_reason"], "validated")
        self.assertEqual(len(calls), 1)
        self.assertEqual(set(result["candidate_changes"]), {"shop/pricing.py", "web/cart.mjs"})
        self.assertEqual(len(result["test_results"]), 2, "Python and Node suites both passed in Docker")
        self.assertTrue(all(row["status"] == "passed" for row in result["test_results"]))
        self.assertTrue(session.closed)


if __name__ == "__main__":
    unittest.main()

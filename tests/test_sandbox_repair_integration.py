"""Real-Docker acceptance for the faulty project repaired through SandboxTools."""
import json
import os
from pathlib import Path
import unittest

from engine import sandbox, sandbox_repair_controller


FIXTURE = Path(__file__).parent / "fixtures" / "sandbox" / "faulty-project"


@unittest.skipUnless(os.getenv("KAPPA_SANDBOX_INTEGRATION") == "1", "requires the GitHub-hosted Docker runner")
class FaultyProjectRepairAcceptance(unittest.TestCase):
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

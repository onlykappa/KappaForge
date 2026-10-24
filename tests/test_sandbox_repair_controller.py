import unittest
from unittest.mock import patch

from engine.sandbox_repair_controller import run_sandbox_repair


class TestSandboxRepairController(unittest.TestCase):
    def setUp(self):
        self.task = "Fix the faulty project"
        self.api_key = "dummy"
        # Simple stub model – the controller never inspects the model output directly.
        self.run_model = lambda *a, **kw: ("dummy_route", "{}")

    def _make_loop_result(self, tool, result):
        return {"stop_reason": "done", "summary": "", "steps": [{"tool": tool, "args": {}, "reason": "test", "result": result}], "models": []}

    @patch("engine.tool_loop.run_tool_loop")
    def test_successful_repair(self, mock_run_tool_loop):
        # First loop: apply a patch.
        apply_step = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["fixed.txt"]},
        )
        # Second loop: run tests and pass.
        test_step = self._make_loop_result(
            "run_tests",
            {"status": "passed"},
        )
        mock_run_tool_loop.side_effect = [apply_step, test_step]

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertTrue(result["success"])
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(result["steps"][0]["tool"], "run_tests")

    @patch("engine.tool_loop.run_tool_loop")
    def test_repeat_patch_detection(self, mock_run_tool_loop):
        # Two identical patches – should trigger repeat detection on second attempt.
        patch1 = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["a.txt"]},
        )
        patch2 = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["a.txt"]},
        )
        mock_run_tool_loop.side_effect = [patch1, patch2]

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "repeat_patch")
        self.assertEqual(result["attempts"], 1)

    @patch("engine.tool_loop.run_tool_loop")
    def test_max_attempts_exhausted(self, mock_run_tool_loop):
        # Five distinct patches, never passing tests.
        side_effects = []
        for i in range(5):
            side_effects.append(
                self._make_loop_result(
                    "apply_patch",
                    {"ok": True, "status": "applied", "changed_paths": [f"file{i}.txt"]},
                )
            )
        mock_run_tool_loop.side_effect = side_effects

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "max_attempts")
        self.assertEqual(result["attempts"], 5)


if __name__ == "__main__":
    unittest.main()

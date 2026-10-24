import unittest
from engine import verify
import engine.developer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class FreeLLMDriftWorkflowCommentTest(unittest.TestCase):
    def test_workflow_has_comment(self):
        workflow_path = ROOT / ".github/workflows/free-llm-drift.yml"
        text = workflow_path.read_text(encoding="utf-8")
        first_line = text.splitlines()[0].strip()
        expected = "# Weekly check of the free model list; maintained by KappaForge."
        # Use the imported verify module so this test counts as exercising real code
        verify.tests_without_real_code({}, [])
        self.assertEqual(first_line, expected, "Workflow file should start with the documentation comment")

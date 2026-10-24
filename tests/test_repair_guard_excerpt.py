import unittest
from engine.repair_guard import payload

class TestRepairGuardExcerpt(unittest.TestCase):
    def setUp(self):
        # Build a synthetic source with many common early lines, a huge opening, and two late unique functions.
        common_block = "\n".join(["import os", "import sys", "# common comment"] * 100)
        large_opening = "#" + "A" * 5000  # very long comment line
        late_funcs = (
            "def produce_development_pr(arg1, arg2):\n    return arg1 + arg2\n"
            "def fix_pull_request(pr_id):\n    pass\n"
        )
        self.source = "\n".join([common_block, large_opening, late_funcs])
        self.path = "dummy.py"
        self.sources = {self.path: self.source}
        self.clues = ["produce_development_pr", "fix_pull_request"]

    def test_payload_includes_late_functions(self):
        # Use the real 3000‑char per‑file budget inside payload (it caps at 3000).
        result = payload(self.sources, self.clues)
        file_info = result["sources"][self.path]
        excerpt_text = file_info["text"]
        # Late functions must be present.
        self.assertIn("def produce_development_pr", excerpt_text)
        self.assertIn("def fix_pull_request", excerpt_text)
        # Omission marker should appear because source exceeds the budget.
        self.assertIn("... omitted ...", excerpt_text)
        # The excerpt must be within the per‑file budget (3000 chars).
        self.assertLessEqual(len(excerpt_text), 3000)
        # The file should be marked as incomplete.
        self.assertFalse(file_info["complete"])

    def test_payload_omits_unrelated_clues(self):
        # Provide a clue that does not exist; excerpt should fall back to a prefix.
        result = payload(self.sources, ["nonexistent_function"])
        file_info = result["sources"][self.path]
        excerpt_text = file_info["text"]
        # Should start with the beginning of the source.
        self.assertTrue(excerpt_text.startswith(self.source[:len(excerpt_text)]))
        # No late functions should be forced in when clue absent.
        self.assertNotIn("def produce_development_pr", excerpt_text)
        self.assertNotIn("def fix_pull_request", excerpt_text)
        # Still respects budget.
        self.assertLessEqual(len(excerpt_text), 3000)

if __name__ == "__main__":
    unittest.main()

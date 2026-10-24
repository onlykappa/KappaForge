import unittest
from engine.developer import excerpt

class TestExcerptRelevance(unittest.TestCase):
    def setUp(self):
        # Build a synthetic source: many common lines, a huge opening block, and two late unique functions.
        common_block = "\n".join(["import os", "import sys", "# common comment"] * 100)
        large_opening = "#" + "A" * 5000  # a very long comment line exceeding typical budgets
        late_funcs = (
            "def produce_development_pr(arg1, arg2):\n    return arg1 + arg2\n"
            "def fix_pull_request(pr_id):\n    pass\n"
        )
        self.source = "\n".join([common_block, large_opening, late_funcs])
        self.clues = "produce_development_pr\nfix_pull_request"

    def test_late_functions_included(self):
        # Use the real 3000‑char budget used by repair_guard.
        result = excerpt(self.source, self.clues, 3000)
        # Both late function definitions must appear in the excerpt.
        self.assertIn('def produce_development_pr', result)
        self.assertIn('def fix_pull_request', result)
        # Omission markers should be present because the source is larger than the excerpt.
        self.assertIn('... omitted ...', result)
        # Ensure we did not exceed the budget.
        self.assertLessEqual(len(result), 3000)

    def test_large_opening_truncates(self):
        # No clues match – use a clue that does not exist.
        result = excerpt(self.source, "nonexistent_function", 2000)
        # Result should be a prefix of the source and not raise.
        self.assertTrue(self.source.startswith(result.split("... omitted ...", 1)[0]))
        self.assertIn("... omitted ...", result)
        self.assertLessEqual(len(result), 2000)

    def test_tiny_budget(self):
        # Very small budget should return an empty string (safe fallback).
        result = excerpt(self.source, self.clues, 5)
        self.assertEqual(result, "")

if __name__ == '__main__':
    unittest.main()

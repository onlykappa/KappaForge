import unittest
from engine.runner import TARGET_RE, CONFIG

class TestTaskSafety(unittest.TestCase):
    def test_target_syntax(self):
        self.assertEqual(TARGET_RE.search("Repository: onlykappa/OmniPC").group(1), "onlykappa/OmniPC")
    def test_bad_target(self):
        self.assertIsNone(TARGET_RE.search("repo: another-owner/private"))
    def test_allowed(self):
        self.assertIn("onlykappa/KappaForge", CONFIG["allowed"])

if __name__ == "__main__":
    unittest.main()

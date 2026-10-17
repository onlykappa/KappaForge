import unittest
from engine.runner import TARGET_RE, allowed_repo

class TestTaskSafety(unittest.TestCase):
    def test_target_syntax(self):
        self.assertEqual(TARGET_RE.search("Repository: onlykappa/OmniPC").group(1), "onlykappa/OmniPC")
    def test_bad_target(self):
        self.assertIsNone(TARGET_RE.search("repo: another-owner/private"))
    def test_every_owner_repository_is_allowed(self):
        for repo in ["onlykappa/KappaForge", "onlykappa/Brand-New_Game", "onlykappa/x.y"]:
            self.assertTrue(allowed_repo(repo), repo)
        for repo in ["someone/KappaForge", "onlykappa/..", "onlykappa/a/b", "onlykappa/", "onlykappa/a b", None]:
            self.assertFalse(allowed_repo(repo), repo)

if __name__ == "__main__":
    unittest.main()

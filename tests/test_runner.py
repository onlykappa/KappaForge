import unittest
import os
from unittest.mock import patch
import time
from engine.runner import TARGET_RE, allowed_repo, read_token, settled

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
    def test_private_repositories_read_with_the_owner_token(self):
        with patch.dict(os.environ, {"GITHUB_TOKEN": "actions", "KAPPA_CODER_TOKEN": "owner"}):
            self.assertEqual(read_token("onlykappa/KappaForge"), "actions")
            self.assertEqual(read_token("onlykappa/OmniPC"), "owner")
        with patch.dict(os.environ, {"GITHUB_TOKEN": "actions", "KAPPA_CODER_TOKEN": ""}):
            self.assertEqual(read_token("onlykappa/OmniPC"), "actions")
    def test_scheduled_runs_skip_finished_and_in_flight_tasks(self):
        now = time.time()
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
        old = iso(now - 86400)
        self.assertTrue(settled([{"body": "### KappaForge project map complete", "created_at": old}], now))
        self.assertTrue(settled([{"body": "**Status:** All eligible paths processed.", "created_at": old}], now))
        self.assertTrue(settled([{"body": "### KappaForge task failed", "created_at": old}], now))
        self.assertTrue(settled([{"body": "**Status:** Partial, next batch pending.", "created_at": iso(now - 600)}], now))
        self.assertFalse(settled([{"body": "**Status:** Partial, next batch pending.", "created_at": old}], now))
        self.assertFalse(settled([], now))

if __name__ == "__main__":
    unittest.main()

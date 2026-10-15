"""Offline safety checks for KappaForge unattended workers."""
import os
import unittest
from unittest.mock import patch
from engine import continuous

def fixture(mode="continuous"):
    return {"number": 55, "body": f"Repository: onlykappa/KappaForge\nMode: {mode}\n", "user": {"login": "onlykappa"}}

class AutonomousTests(unittest.TestCase):
    def test_bounded_audit_checkpoints(self):
        reports = []
        calls = []
        def fake_gh(path, token=None, payload=None):
            if path.endswith("/comments?per_page=100"): return reports
            if path.endswith("/comments") and payload:
                reports.append(payload)
                return {}
            raise AssertionError(path)
        def fake_batch(*args):
            calls.append(1)
            return {"next":len(calls), "files_total":10}, "checkpoint", len(calls)==2
        with patch.object(continuous, "github", side_effect=fake_gh), patch.object(continuous, "inspect_batch", side_effect=fake_batch):
            self.assertTrue(continuous.continuous_audit(fixture(), "token", "key"))
        self.assertEqual(len(calls), 2)
        self.assertTrue(any("Continuous task complete" in x["body"] for x in reports))

    def test_unapproved_repo_rejected(self):
        issue = fixture()
        issue["body"] = "Repository: stranger/private\nMode: continuous"
        with self.assertRaises(ValueError):
            continuous.continuous_audit(issue, "token", "key")

    def test_watch_idempotence_and_filter(self):
        issue = fixture("watch")
        issue["number"] = 57
        runs = [{"id":1,"conclusion":"failure","name":"KappaForge tests","head_branch":"main","html_url":"https://github.com/onlykappa/KappaForge/actions/runs/1"},
                {"id":2,"conclusion":"failure","name":"Other workflow","head_branch":"main"},
                {"id":3,"conclusion":"failure","name":"KappaForge tests","head_branch":"feature"}]
        comments=[]
        def fake_gh(path, token=None, payload=None):
            if path.endswith("/actions/runs?per_page=12"): return {"workflow_runs":runs}
            if path.endswith("/comments?per_page=100"): return comments
            if path.endswith("/comments"):
                comments.append(payload)
                return {}
            raise AssertionError(path)
        with patch.object(continuous, "get_issue", return_value=issue), patch.object(continuous, "github", side_effect=fake_gh), patch.object(continuous, "run_model", return_value=("flash","Check logs")) as ai:
            continuous.monitor_failures(issue,"token","key")
            continuous.monitor_failures(issue,"token","key")
        self.assertEqual(len(comments),1)
        self.assertEqual(ai.call_count,1)
        self.assertIn("KAPPA_WATCH_RUN:1",comments[0]["body"])

if __name__=="__main__":
    unittest.main()

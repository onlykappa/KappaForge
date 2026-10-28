"""Tests for one-time auto-start of direct owner-created development issues."""
import unittest
from datetime import datetime
from unittest.mock import patch, call
from scripts import task_intake


def issue(**changes):
    value = {
        "number": 274,
        "state": "open",
        "user": {"login": "onlykappa"},
        "created_at": "2026-10-25T18:30:00Z",
        "body": "Repository: onlykappa/KappaForge\nMode: develop\nRun the authorized task.",
        "labels": [{"name": "kappa-task"}],
    }
    value.update(changes)
    return value


class TaskIntakeTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.fromisoformat(issue()['created_at'].replace('Z', '+00:00')).timestamp() + 60
        clock = patch('engine.intent_guard.time.time', return_value=self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def test_expired_owner_issue_is_not_auto_dispatched(self):
        with patch('engine.intent_guard.time.time', return_value=self.now + 86400):
            self.assertFalse(task_intake.eligible(issue(), 'opened'))

    def test_direct_owner_development_task_is_eligible_on_open_or_task_label(self):
        self.assertTrue(task_intake.eligible(issue(), "opened"))
        self.assertTrue(task_intake.eligible(issue(labels=[]), "labeled", "kappa-task"))

    def test_app_created_or_unauthorized_issues_are_not_auto_dispatched(self):
        cases = [
            (issue(body="Approved from KappaForge Chat.\nRepository: onlykappa/KappaForge\nMode: develop"), "opened", ""),
            (issue(user={"login": "not-the-owner"}), "opened", ""),
            (issue(state="closed"), "opened", ""),
            (issue(labels=[]), "opened", ""),
            (issue(body="Repository: onlykappa/KappaForge\nMode: code"), "opened", ""),
            (issue(body="Repository: another/repo\nMode: develop"), "opened", ""),
            (issue(pull_request={"url": "https://example.invalid"}), "opened", ""),
        ]
        for task, action, label in cases:
            with self.subTest(task=task, action=action):
                self.assertFalse(task_intake.eligible(task, action, label))

    def test_dispatch_targets_only_the_trusted_main_agent_workflow_and_deduplicates(self):
        task = issue()
        def api(path, token, payload=None):
            if payload and '/comments' in path:
                return {'id': 42, 'body': payload['body']}
            return [] if payload is None else None
        with patch.object(task_intake, "already_dispatched", return_value=False), \
             patch.object(task_intake, "request", side_effect=api) as request:
            self.assertEqual(task_intake.dispatch(task, "fixture"), "dispatched")
        self.assertEqual(request.call_args_list[-1], call(
            "/repos/onlykappa/KappaForge/actions/workflows/agent.yml/dispatches",
            "fixture", {"ref": "main", "inputs": {"issue_number": "274"}}))
        self.assertEqual(request.call_count, 3, 'read claim, persist debit, then dispatch')
        self.assertIn('KAPPA_INTAKE_V1', request.call_args_list[1].args[2]['body'])

        with patch.object(task_intake, "already_dispatched", return_value=True), \
             patch.object(task_intake, "request") as request:
            self.assertEqual(task_intake.dispatch(task, "fixture"), "already-dispatched")
        request.assert_not_called()

    def test_existing_task_run_is_detected_without_scanning_unbounded_history(self):
        run = {"display_title": "Agent task #274 fix", "created_at": "2026-10-25T18:31:00Z"}
        with patch.object(task_intake, "request", return_value={"workflow_runs": [run]}) as request:
            self.assertTrue(task_intake.already_dispatched(274, "2026-10-25T18:30:00Z", "fixture"))
        request.assert_called_once()


if __name__ == "__main__":
    unittest.main()

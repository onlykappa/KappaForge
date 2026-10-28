"""Exercise intake through an isolated script import and delayed run visibility."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
from scripts import task_intake
from tests.test_task_intake import issue


class TaskIntakeReviewTests(unittest.TestCase):
    def test_isolated_script_import_resolves_engine_without_cwd_or_pythonpath(self):
        script = str(Path('scripts/task_intake.py').resolve())
        code = ('import runpy,sys;from datetime import datetime,timezone;'
                'sys.path.insert(0,' + repr(str(Path(script).parent)) + ');'
                'ns=runpy.run_path(' + repr(script) + ');'
                'task=' + repr(issue()) + ';task["created_at"]=datetime.now(timezone.utc).isoformat();'
                'print(ns["eligible"](task,"opened"))')
        result = subprocess.run([sys.executable, '-I', '-c', code], cwd='/tmp', capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'True')

    def test_trimmed_empty_action_run_name_is_detected(self):
        run = {'display_title':'Agent task #274', 'created_at':'2026-10-25T18:31:00Z'}
        with patch.object(task_intake, 'request', return_value={'workflow_runs':[run]}):
            self.assertTrue(task_intake.already_dispatched(274, issue()['created_at'], 'fixture'))

    def test_old_history_does_not_fail_every_future_intake(self):
        run = {'display_title':'Unrelated', 'created_at':'2026-10-24T18:31:00Z'}
        with patch.object(task_intake, 'request', return_value={'workflow_runs':[run]*100}) as api:
            self.assertFalse(task_intake.already_dispatched(274, issue()['created_at'], 'fixture'))
        self.assertEqual(api.call_count, 1)

    def test_two_serial_events_claim_once_before_run_visibility(self):
        comments, dispatched = [], []
        def api(path, token, payload=None):
            if '/comments' in path:
                if payload:
                    comments.append(dict(id=1, user={'login':'github-actions[bot]'}, body=payload['body']))
                    return comments[-1]
                return comments
            if path.endswith('/dispatches'):
                dispatched.append(payload)
                return None
            return {'workflow_runs':[]}
        with patch.object(task_intake, 'request', side_effect=api):
            self.assertEqual(task_intake.dispatch(issue(), 'fixture'), 'dispatched')
            self.assertEqual(task_intake.dispatch(issue(), 'fixture'), 'already-dispatched')
        self.assertEqual(len(dispatched), 1, 'workflow visibility lag must not duplicate a task')

    def test_unconfirmed_dispatch_is_not_replayed_after_durable_claim(self):
        comments, attempts = [], []
        def api(path, token, payload=None):
            if '/comments' in path:
                if payload:
                    comments.append(dict(id=1, user={'login':'github-actions[bot]'}, body=payload['body']))
                    return comments[-1]
                return comments
            if path.endswith('/dispatches'):
                attempts.append(payload)
                raise TimeoutError('delivery outcome unknown')
            return {'workflow_runs':[]}
        with patch.object(task_intake, 'request', side_effect=api):
            with self.assertRaises(TimeoutError):
                task_intake.dispatch(issue(), 'fixture')
            self.assertEqual(task_intake.dispatch(issue(), 'fixture'), 'already-dispatched')
        self.assertEqual(len(attempts), 1)

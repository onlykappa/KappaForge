"""Behavioral wire contract at the real execution boundary, independent of the UI renderer."""
import json
import re
import unittest
from unittest.mock import patch
from engine import developer


def wire(body):
    return json.loads(re.search(r'<!-- KAPPA_PROGRESS_V1 (.*?) -->', body)[1])


class TaskProgressContractTests(unittest.TestCase):
    def test_actual_transitions_publish_ordered_snapshots_with_persistable_times(self):
        comments = []
        times = iter([1000, 1001, 1005, 1010])
        with patch.object(developer.Progress, 'clock', lambda: next(times)), patch.object(developer, 'gh', side_effect=lambda path, token, payload, **kw: comments.append(payload['body']) or {'id': 77}):
            p = developer.Progress(9, 'not-published', ahead=['Write change'])
            p.now('Reading files')
            p.now('Step 1 of 2: Fix parsing', phase=True)
            p.ok('Step 1 of 2: Fix parsing', status='testing')
        events = [wire(body) for body in comments]
        self.assertEqual([e['revision'] for e in events], [1, 2, 3])
        self.assertEqual(events[0]['steps'][0]['status'], 'running')
        self.assertEqual(events[1]['steps'][0]['id'], events[0]['steps'][0]['id'])
        self.assertEqual(events[1]['steps'][0]['finishedAt'], 1005000)
        self.assertEqual(events[-1]['status'], 'testing')
        self.assertEqual(events[-1]['finishedAt'], 0, 'opening a PR is not task completion')
        self.assertEqual(events[-1]['units'], {'done': 1, 'total': 2, 'label': 'implementation stages'})
        self.assertEqual(events[1]['units']['done'], 0, 'a running stage is not completed work')
        self.assertNotIn('not-published', ''.join(comments))

    def test_failure_freezes_step_time_and_does_not_claim_future_work(self):
        times = iter([1000, 1001, 1009])
        with patch.object(developer.Progress, 'clock', lambda: next(times)), patch.object(developer, 'gh', return_value={'id': 3}):
            p = developer.Progress(4, 'secret', ahead=['Tests'])
            p.now('Writing')
            p.fail('Provider unavailable')
        state = p.snapshot()
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['finishedAt'], 1009000)
        self.assertEqual(state['steps'][0]['status'], 'failed')
        self.assertFalse(any(s['status'] == 'queued' for s in state['steps']))

    def test_comment_terminators_are_escaped_and_planned_ids_survive_advancement(self):
        bodies = []
        with patch.object(developer.Progress, 'clock', lambda: 1000), patch.object(developer, 'gh', side_effect=lambda path, token, payload, **kw: bodies.append(payload['body']) or {'id': 3}):
            p = developer.Progress(4, 'secret', ahead=['Choose files', 'Write change'])
            p.now('Read <!-- comment -->')
            before = p.snapshot()['steps'][-1]['id']
            p.now('Choose files', phase=True)
        self.assertEqual(p.snapshot()['steps'][-1]['id'], before)
        self.assertEqual(wire(bodies[0])['steps'][0]['title'], 'Read <!-- comment -->')


def tearDownModule():
    developer.Progress.latest = None  # Later test modules start without this module's last checklist.

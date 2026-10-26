"""Long-lived PRs receive complete small scope batches, including late files."""
import json
import unittest
from unittest.mock import Mock
from engine import recovery, task_goal, task_state, verify


class LargeScopeReviewTests(unittest.TestCase):
    def setUp(self):
        self.goal = task_goal.from_request('Implement the requested change and its tests')
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(self.goal))
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(None))
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)

    def test_every_file_beyond_forty_is_reviewed_in_small_batches(self):
        changes = {f'file_{n:03}.py': f'return {n}\n' for n in range(43)}
        seen = []
        def model(key, prompt, **kwargs):
            paths = json.JSONDecoder().raw_decode(prompt.split('BATCH PATHS: ')[1])[0]
            self.assertLessEqual(len(paths), 3)
            seen.extend(paths)
            return 'fixture', json.dumps({'file_scope': [dict(path=p, necessary=p != 'file_042.py',
                reason='Unrelated late file' if p == 'file_042.py' else 'Required owner behavior',
                quote=changes[p].strip()) for p in paths]})
        problems = verify.scope_batches(model, 'key', self.goal.request, changes, self.goal, {'free'})
        self.assertEqual(seen, sorted(changes))
        self.assertEqual(len(set(seen)), 43)
        self.assertEqual(problems, ['Unrelated change outside the owner goal: file_042.py: Unrelated late file'])

    def test_missing_late_decision_still_blocks_complete_review(self):
        changes = {f'file_{n:03}.py': f'return {n}\n' for n in range(43)}
        def model(key, prompt, **kwargs):
            paths = json.JSONDecoder().raw_decode(prompt.split('BATCH PATHS: ')[1])[0]
            return 'fixture', json.dumps({'file_scope': [dict(path=p, necessary=True, reason='Required behavior',
                quote=changes[p].strip()) for p in paths if p != 'file_042.py']})
        with self.assertRaisesRegex(verify.ScopeReviewUnavailable, 'file_042.py'):
            verify.scope_batches(model, 'key', self.goal.request, changes, self.goal, {'free'})

    def test_total_inventory_remains_bounded_before_inference(self):
        model = Mock()
        with self.assertRaises(verify.ScopeReviewUnavailable):
            verify.scope_batches(model, 'key', self.goal.request,
                                 {f'file_{n}.py': 'pass' for n in range(1001)}, self.goal, {'free'})
        model.assert_not_called()

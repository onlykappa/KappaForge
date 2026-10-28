"""Large draft PRs retain complete metadata while repair proposals remain bounded."""
import unittest
from unittest.mock import Mock, patch
from engine import developer, task_goal

SHA = 'a' * 40


class RevisionFileTests(unittest.TestCase):
    def files(self, count):
        return [dict(filename=f'docs/file-{i}.md', status='modified', patch='line') for i in range(count)]

    def test_revision_reaches_investigation_for_42_files_without_larger_proposals(self):
        files = self.files(42)
        pr = dict(number=275, changed_files=42, head={'sha': SHA}, body='')
        issue = dict(number=274, title='Audit', body='Audit provenance')
        goal = task_goal.CURRENT.set(task_goal.from_request('Audit provenance'))
        try:
            with patch.object(developer, 'gh', side_effect=lambda path, token: files if '/files?' in path else pr), \
                    patch.object(developer, 'list_tree', side_effect=LookupError('investigation reached')) as tree, \
                    patch.object(developer, 'run_model') as model:
                with self.assertRaisesRegex(LookupError, 'investigation reached'):
                    developer.revise_branch(issue, pr, 'kappa/dev-274', SHA, [], 'token', 'key')
                tree.assert_called_once()
                model.assert_not_called()
                self.assertEqual(developer.LARGE.changed_files, 20)
        finally:
            task_goal.CURRENT.reset(goal)

    def test_paginated_metadata_is_complete_and_bound_to_the_original_head(self):
        rows = self.files(101)
        pr = dict(number=275, changed_files=101, head={'sha': SHA})
        read = Mock(side_effect=[rows[:100], rows[100:], pr])
        with patch.object(developer, 'gh', read):
            self.assertEqual(developer.revision_files(pr, developer.ROOT, SHA, 'token'), rows)
        self.assertIn('page=2', read.call_args_list[1].args[0])

    def test_incomplete_duplicate_changed_or_unsupported_metadata_is_rejected(self):
        rows = self.files(101)
        cases = [([rows[:100], [], dict(head={'sha': SHA}, changed_files=101)], 'incomplete'),
                 ([rows[:100], [rows[0]]], 'duplicate'),
                 ([rows[:42], dict(head={'sha': 'b' * 40}, changed_files=42)], 'changed'),
                 ([[dict(filename='docs/a.md', status='removed')]], 'Unsupported'),
                 ([[dict(filename='../outside.md', status='modified')]], '')]
        for responses, reason in cases:
            with self.subTest(reason=reason), patch.object(developer, 'gh', side_effect=responses):
                with self.assertRaises(ValueError):
                    developer.revision_files(dict(number=275), developer.ROOT, SHA, 'token')

    def test_metadata_limit_fails_before_inference_or_silent_truncation(self):
        with patch.object(developer, 'gh') as read:
            with self.assertRaises(ValueError):
                developer.revision_files(dict(number=275, changed_files=1001), developer.ROOT, SHA, 'token')
            read.assert_not_called()

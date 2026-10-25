"""Fixes for KappaForge's most frequent wasted rounds: whole named functions in large-file excerpts, and
development tasks that build on an owner branch instead of only the default branch."""
import urllib.error
import unittest
from unittest.mock import patch

from engine import developer


def large_module(target_body_lines=40):
    """A module far over the excerpt budget, whose target function's body shares no words with the task."""
    helper = lambda n: f'def helper_{n}(value):\n    """Unrelated helper {n}."""\n    return value + {n}\n\n\n'
    before, after = ''.join(map(helper, range(450))), ''.join(map(helper, range(450, 900)))
    target = ('@cached\ndef produce_report(issue, api_key, token, adopt=None):\n' +
              ''.join(f'    step_{n} = compute(alpha_{n}, beta_{n})\n' for n in range(target_body_lines)) +
              '    return step_0\n\n\n')
    return before + target + after


class WholeDefinitionTests(unittest.TestCase):
    def test_a_named_function_is_shown_whole_with_its_real_signature_and_decorator(self):
        text = large_module()
        self.assertGreater(len(text), developer.MAX_FILE_CHARS)
        shown = developer.excerpt(text, 'Make produce_report skip archived issues', developer.MAX_FILE_CHARS)
        self.assertLessEqual(len(shown), developer.MAX_FILE_CHARS)
        block = '@cached\ndef produce_report(issue, api_key, token, adopt=None):\n' + ''.join(
            f'    step_{n} = compute(alpha_{n}, beta_{n})\n' for n in range(40)) + '    return step_0'
        self.assertIn(block, shown, 'every line from the decorator to the return is shown, in order')
        # The exact signature is now copyable, so an anchor on it matches once.
        self.assertEqual(text.count('def produce_report(issue, api_key, token, adopt=None):'), 1)

    def test_whole_definitions_use_at_most_half_the_budget_and_keyword_hits_still_fit(self):
        text = large_module(target_body_lines=2000)
        shown = developer.excerpt(text, 'Make produce_report skip helper_17 values', 30_000)
        self.assertLessEqual(len(shown), 30_000)
        self.assertNotIn('step_1999', shown, 'a function bigger than half the budget is not forced in')
        self.assertIn('def helper_17(value):', shown)

    def test_unparsable_or_unnamed_sources_keep_the_keyword_excerpt(self):
        self.assertEqual(developer.named_definitions('def broken(:\n', 'broken'), [])
        self.assertEqual(developer.named_definitions('def a():\n    pass\n', 'no names here'), [])
        spans = developer.named_definitions('class C:\n    def inner_method(self):\n        return 1\n\ndef outer_function():\n    pass\n',
                                            'fix inner_method and outer_function')
        self.assertEqual(spans, [(1, 2), (4, 5)])


class BaseBranchTests(unittest.TestCase):
    def tearDown(self):
        # produce_development_pr starts a progress checklist and task scope; later test modules must not inherit them.
        from engine import intent_guard
        developer.Progress.latest = None
        intent_guard.ACTIVE.set(None)

    def issue(self, body):
        return {'number': 9, 'title': 't', 'user': {'login': 'onlykappa'},
                'body': 'Repository: onlykappa/KappaForge\nMode: develop\n' + body}

    def test_an_owner_base_line_names_the_branch_to_build_on(self):
        self.assertIsNone(developer.task_base(self.issue('Add a feature')))
        self.assertEqual(developer.task_base(self.issue('Base: claude/phase2-exploration\nAdd a feature')), 'claude/phase2-exploration')
        for bad in ('Base: kappa/dev-3', 'Base: a/../b', 'Base: x\nBase: y', 'Base: name.lock'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                developer.task_base(self.issue(bad))

    def test_snapshot_reads_the_named_base_and_explains_a_missing_one(self):
        calls = []
        def gh(path, token, payload=None, method=None):
            calls.append(path)
            if path.endswith('/git/ref/heads/claude%2Fphase2'):
                return {'object': {'sha': 'b' * 40}}
            if '/git/ref/heads/' in path:
                raise urllib.error.HTTPError(path, 404, 'missing', {}, None)
            return {'default_branch': 'main'}
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'list_tree', return_value=({'a.py': 1}, {'a.py': '100644'})):
            self.assertEqual(developer.snapshot('onlykappa/KappaForge', 't', 'claude/phase2'),
                             ('claude/phase2', 'b' * 40, {'a.py': 1}, {'a.py': '100644'}))
            with self.assertRaisesRegex(ValueError, 'Base branch gone does not exist'):
                developer.snapshot('onlykappa/KappaForge', 't', 'gone')

    def test_the_development_task_snapshots_the_named_base(self):
        seen = {}
        def snapshot(repo, token, base=None):
            seen['base'] = base
            raise RuntimeError('stop after choosing the base')
        issue = self.issue('Base: claude/phase2-exploration\nAdd a feature')
        def gh(path, token, payload=None, method=None):
            if '/git/ref/' in path:
                raise urllib.error.HTTPError(path, 404, 'missing', {}, None)  # No leftover task branch.
            return []
        with patch.object(developer, 'snapshot', side_effect=snapshot), \
                patch.object(developer, 'gh', side_effect=gh), self.assertRaisesRegex(RuntimeError, 'stop after'):
            developer.produce_development_pr(issue, 'key', 'token')
        self.assertEqual(seen['base'], 'claude/phase2-exploration')


if __name__ == '__main__':
    unittest.main()

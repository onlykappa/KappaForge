"""Reviewer regressions for task 235, staged outside the live agent branch."""
import inspect
import unittest
from engine import developer, repair_guard


class RealSourceExcerptReviewTests(unittest.TestCase):
    def test_actual_precommit_sandbox_gate_reaches_the_repair_payload(self):
        source = inspect.getsource(developer)
        claim = ('engine/developer.py produce_development_pr run_sandbox_repair before commit_changes')
        data = repair_guard.payload({'engine/developer.py': source}, [claim])
        shown = data['sources']['engine/developer.py']
        self.assertFalse(shown['complete'])
        self.assertLessEqual(len(data['shown']['engine/developer.py']), 3000, 'the budget bounds the excerpt; line numbers are extra')
        self.assertIn('run_sandbox_repair(', shown['text'])
        produce = inspect.getsource(developer.produce_development_pr)
        self.assertLess(produce.index('run_sandbox_repair('), produce.index('publish_candidate('))
        self.assertLess(produce.index('run_sandbox_repair('), produce.index('pulls', produce.index('publish_candidate(')))
        self.assertIn('commit_changes(', inspect.getsource(developer.publish_candidate))

    def test_natural_language_clues_prioritize_rare_symbols_over_common_words(self):
        source = '# source tests review\n' * 400 + 'def unusual_boundary():\n    publish_before_tests()\n' + '# tail\n' * 200
        shown = developer.excerpt(source, 'Review source tests: unusual_boundary publishes before tests', 250)
        self.assertIn('def unusual_boundary():', shown)
        self.assertIn('    publish_before_tests()', shown)
        self.assertLessEqual(len(shown), 250)

    def test_oversized_neighbor_does_not_hide_a_short_relevant_function(self):
        source = '#' + 'x' * 5000 + '\ndef repair_boundary():\n    return unsafe_publish()\n' + '# end\n' * 200
        shown = developer.excerpt(source, 'repair_boundary calls unsafe_publish too early', 180)
        self.assertIn('def repair_boundary():', shown)
        self.assertIn('    return unsafe_publish()', shown)
        self.assertLessEqual(len(shown), 180)
        self.assertIn('omitted', shown.lower())

    def test_all_markers_and_fallbacks_stay_within_budget(self):
        source = '# opening\n' * 80 + 'def rare_target():\n    pass\n' + '# tail\n' * 80
        for budget in (-1, 0, 1, 5, 16, 40, 80, 120, 200, 500):
            for clues in ('rare_target', 'No matching identifier'):
                with self.subTest(budget=budget, clues=clues):
                    shown = developer.excerpt(source, clues, budget)
                    self.assertLessEqual(len(shown), max(0, budget))

    def test_keyword_signature_is_preserved(self):
        self.assertEqual(developer.excerpt(text='a = 1\n', task='a', budget=20), 'a = 1\n')

    def test_trailing_marker_newline_is_included_in_the_budget(self):
        source = 'target\n' + '# filler\n' * 100
        shown = developer.excerpt(source, 'target', len('target') + len('... omitted ...'))
        self.assertLessEqual(len(shown), len('target') + len('... omitted ...'))

    def test_unshown_real_quote_cannot_authorize_a_repair(self):
        from tests.test_repair_guard import RepairGuardTests, finding_response
        case = RepairGuardTests()
        case.setUp()
        try:
            sources = {'app.py': 'def add(a, b):\n    return a + b\n' + '# filler\n' * 1000 + 'private_unrelated_line = 42\n'}
            rows, _ = case.assess(lambda prompt: finding_response(prompt, quote='private_unrelated_line = 42'), sources=sources)
            self.assertEqual(rows[0]['verdict'], 'needs_validation')
            self.assertEqual(rows[0]['evidence'], [])
        finally:
            case.tearDown()

    def test_payload_remains_bounded_across_many_large_sources(self):
        sources = {f'file_{i}.py': '# comment\n' * 500 + f'def boundary_{i}():\n    pass\n' for i in range(10)}
        claims = [f'file_{i}.py: boundary_{i} publishes too early' for i in range(10)]
        result = repair_guard.payload(sources, claims)
        total = sum(len(path) + len(row['text']) + 80 for path, row in result['sources'].items())
        self.assertLessEqual(total, repair_guard.MAX_SOURCE_CHARS)
        self.assertEqual(result['omittedFiles'], len(sources) - len(result['sources']))
        self.assertTrue(all(not row['complete'] for row in result['sources'].values()))


if __name__ == '__main__':
    unittest.main()

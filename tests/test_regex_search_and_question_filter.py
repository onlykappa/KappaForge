"""Regex code search allows ordinary patterns again, with a hard timeout as the backstop; and business questions about
quotes reach the owner while quotation-mark style is still decided by convention."""
import time
import unittest
from unittest.mock import patch

from engine import clarification, exploration
from engine.exploration import Budget, Explorer, Repository

SOURCES = {'app/billing.py': 'import os\nimport re\n\ndef total(items):\n    return sum(items)\n\ndef tax_for(amount):\n    return amount * 0.2\n',
           'app/api.py': 'def get_user(uid):\n    pass\n\ndef set_user(uid, value):\n    pass\n'}


class RegexSearchTests(unittest.TestCase):
    def setUp(self):
        self.explorer = Explorer(Repository.from_sources(SOURCES))

    def search(self, pattern, **kwargs):
        return self.explorer.call('search_code', query=pattern, regex=True, **kwargs)

    def test_ordinary_patterns_with_several_repetitions_work_again(self):
        for pattern, total in ((r'def\s+\w+\(', 4), (r'import\s+(\w+)', 2), (r'(?:get|set)_\w+', 2),
                               (r'def\s+\w+\(\w+,\s*\w+\)', 1), (r'\d+\.\d+', 1)):
            with self.subTest(pattern=pattern):
                found = self.search(pattern)
                self.assertEqual((found['status'], found['total']), ('ok', total))
        self.assertEqual(self.search(r'def\s+\w+', path_prefix='app/api')['total'], 2)
        self.assertEqual(self.search(r'def\s+(\w+)\(')['matches'][0], {'path': 'app/api.py', 'line': 1, 'text': 'def get_user(uid):'})

    def test_known_catastrophic_shapes_are_refused_up_front(self):
        for pattern in ('(a+)+b', r'(\w*)*x', r'(a)\1', r'(?P<x>a)(?P=x)', '(a|aa)+$', r'(\d+\.?)*$', '(x{1,9})+y'):
            with self.subTest(pattern=pattern):
                self.assertTrue(exploration._regex_uses_unsafe_backtracking(pattern))
                self.assertEqual(self.search(pattern)['status'], 'invalid')
        for pattern in (r'def\s+\w+', '(ab)+', '(?:get|set)_', r'[(+)]+\w+', r'\(\w+\)+'):
            with self.subTest(pattern=pattern):
                self.assertFalse(exploration._regex_uses_unsafe_backtracking(pattern))

    def test_a_pattern_the_check_misses_is_stopped_by_the_timeout(self):
        hostile = {'bomb.txt': 'x' * 40}
        explorer = Explorer(Repository.from_sources(hostile), Budget(seconds=60))
        started = time.monotonic()
        with patch.object(exploration, '_regex_uses_unsafe_backtracking', return_value=False), \
                patch.object(exploration, 'REGEX_SECONDS', 1.0):
            result = explorer.call('search_code', query='(x+x+)+y', regex=True)
        self.assertLess(time.monotonic() - started, 10, 'the search did not run on')
        self.assertEqual(result['status'], 'invalid')
        self.assertIn('was stopped', result['error'])

    def test_the_child_process_gets_no_environment_and_a_bounded_timeout(self):
        seen = {}
        def run(argv, **kwargs):
            seen.update(argv=argv, **kwargs)
            return type('Done', (), {'returncode': 0, 'stdout': '[]', 'stderr': ''})()
        explorer = Explorer(Repository.from_sources(SOURCES), Budget(seconds=3))
        with patch('subprocess.run', side_effect=run):
            explorer.call('search_code', query=r'def\s+\w+', regex=True)
        self.assertEqual(seen['env'], {}, 'no secrets or tokens reach the regex worker')
        self.assertIn('-I', seen['argv'])
        self.assertLessEqual(seen['timeout'], 3, 'never longer than the investigation time left')

    def test_bad_syntax_is_still_an_invalid_query(self):
        self.assertEqual(self.search('(unclosed')['status'], 'invalid')
        self.assertEqual(self.explorer.call('search_code', query='a' * 201, regex=True)['status'], 'invalid')


class QuestionFilterTests(unittest.TestCase):
    def ask(self, question):
        return clarification.validate(dict(kind='expected_behavior', question=question, why='The request is silent on it'))[0]

    def test_business_questions_about_quotes_reach_the_owner(self):
        for question in ('Should the invoice quote include tax?', 'Should a customer quote expire after 30 days?',
                         'Can a sales quote be converted into an order automatically?'):
            with self.subTest(question=question):
                self.assertIsNotNone(self.ask(question))

    def test_quotation_mark_style_is_still_decided_by_convention(self):
        for question in ('Should strings use single or double quotes?', 'What quote style should the JSON use?',
                         'Should I use curly quotes in the UI copy?', 'Do you want straight quotes in docs?',
                         'Which quotation marks should the README use?'):
            with self.subTest(question=question):
                self.assertIsNone(self.ask(question))


if __name__ == '__main__':
    unittest.main()

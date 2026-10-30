import json
import unittest
from unittest.mock import patch

from engine import developer, export_index

REVIEW = '''import x from "y";
export const instant=v=>v;
export async function reviewPR(env){}
export function unansweredFeedback(items){}
function hidden(){}
export {alpha, beta as gamma};
export default class Panel{}
'''
PY = 'import os\n\ndef public():\n    pass\n\ndef _private():\n    pass\n\nclass Thing:\n    def method(self): pass\n\nasync def later(): pass\n'


class NamesTests(unittest.TestCase):
    def test_javascript_exports_are_listed_and_unexported_helpers_are_not(self):
        listed = export_index.names('chat-backend/src/review.js', REVIEW)
        self.assertEqual(listed, ['instant', 'reviewPR', 'unansweredFeedback', 'Panel', 'alpha', 'gamma'])
        self.assertNotIn('review', listed)
        self.assertNotIn('hidden', listed)

    def test_python_lists_top_level_public_names_only(self):
        self.assertEqual(export_index.names('engine/x.py', PY), ['public', 'Thing', 'later'])

    def test_other_file_types_have_no_names(self):
        self.assertEqual(export_index.names('README.md', 'export const a=1'), [])


class RenderTests(unittest.TestCase):
    def test_lists_files_in_the_order_given_and_skips_tests(self):
        sources = {'a.js': 'export const one=1', 'tests/t.mjs': 'export const hidden=1', 'b.py': 'def two(): pass'}
        text = export_index.render(sources, ['tests/t.mjs', 'b.py', 'a.js', 'missing.js'])
        self.assertIn('b.py: two\na.js: one\n', text)
        self.assertNotIn('hidden', text)
        self.assertTrue(text.startswith('===== NAMES EACH FILE EXPORTS'))

    def test_empty_when_nothing_exports(self):
        self.assertEqual(export_index.render({'a.md': 'x'}, ['a.md']), '')

    def test_stays_within_its_cap(self):
        sources = {f'm{i}.js': f'export const {"n" * 40}{i}=1' for i in range(100)}
        text = export_index.render(sources, list(sources), cap=600)
        self.assertLessEqual(len(text), 600)
        self.assertIn('m0.js', text)


class PromptTests(unittest.TestCase):
    def test_the_coder_is_told_which_names_the_source_really_exports(self):
        sources = {'chat-backend/src/review.js': 'export async function reviewPR(env){}\n' + '// padding\n' * 400}
        existing = {path: len(text) for path, text in sources.items()}
        valid = json.dumps({'files': [{'path': 'chat-backend/src/review.js', 'reason': 'Rename the exported review entry point',
                                       'edits': [{'find': 'export async function reviewPR(env){}', 'replace': 'export async function reviewPR(env,x){}'}]}]})
        prompts = []

        def model(api_key, prompt, max_output_tokens=0, allowed=None, json_mode=False, skip=()):
            prompts.append(prompt)
            return 'm', valid
        with patch.object(developer, 'run_model', side_effect=model):
            developer.generate('key', 'change reviewPR', 'onlykappa/KappaForge', sources, existing)
        self.assertIn('NAMES EACH FILE EXPORTS', prompts[0])
        self.assertIn('chat-backend/src/review.js: reviewPR', prompts[0])


if __name__ == '__main__':
    unittest.main()

"""The owner brief must reach every coding consumer without silent truncation."""
import json
import unittest
from unittest.mock import patch

from engine import coder, developer, recovery, verify


TAIL = '\nFinal requirement: retain manual location entry and never broaden authorization.'
TASK = 'Implement the authorized change.\n' + 'x' * (20000 - len(TAIL) - len('Implement the authorized change.\n')) + TAIL
SOURCES = {'app/main.py': 'def main():\n    return 1\n'}
EXISTING = {path: len(source) for path, source in SOURCES.items()}
PROPOSAL = json.dumps({'summary': 'Change return value', 'files': [
    {'path': 'app/main.py', 'edits': [{'find': 'return 1', 'replace': 'return 2'}]}]})


class LongTaskBriefTests(unittest.TestCase):
    def test_playground_generation_preserves_the_brief_and_sandbox_paths(self):
        proposal = json.dumps({'files': [{'path': 'projects/demo/main.py', 'content': 'print(2)\n'}]})
        with patch.object(coder, 'run_model', return_value=('fixture', proposal)) as model:
            _, files = coder.generate('fixture', TASK)
        self.assertIn(TASK, model.call_args.args[1])
        self.assertEqual(files, [('projects/demo/main.py', 'print(2)\n')])

    def test_file_selection_receives_all_20000_characters(self):
        with patch.object(developer, 'run_model', return_value=('fixture', '{"read":["app/main.py"]}')) as model:
            chosen = developer.select_files('fixture', TASK, EXISTING)
        self.assertEqual(chosen, ['app/main.py'])
        self.assertIn(TASK, model.call_args.args[1])

    def test_generation_receives_the_tail_requirement_and_applies_validated_edits(self):
        with patch.object(developer, 'run_model', return_value=('fixture', PROPOSAL)) as model:
            _, _, changes, _ = developer.generate('fixture', TASK, 'onlykappa/KappaForge', SOURCES, EXISTING)
        self.assertIn(TASK, model.call_args.args[1])
        self.assertEqual(changes['app/main.py'], 'def main():\n    return 2\n')

    def test_independent_review_receives_the_complete_brief(self):
        verdict = json.dumps({'requirements': [{'text': 'Change return value', 'met': True,
            'evidence': {'path': 'app/main.py', 'quote': 'return 2'}}], 'problems': [], 'files_needed': [], 'files_to_inspect': []})
        with patch.object(developer, 'run_model', return_value=('fixture', verdict)) as model:
            result = verify.model_review(model, 'fixture', TASK, SOURCES.get,
                {'app/main.py': 'def main():\n    return 2\n'}, list(SOURCES))
        self.assertIsNotNone(result)
        self.assertIn(TASK, model.call_args.args[1])

    def test_saved_branch_repair_receives_the_original_brief(self):
        current = recovery.CURRENT.set(None)
        self.addCleanup(recovery.CURRENT.reset, current)
        def github(path, _token):
            return [{'filename': 'app/main.py', 'status': 'modified', 'patch': 'fixture'}] if '/files?' in path else []
        with patch.object(developer, 'gh', side_effect=github), \
                patch.object(developer, 'list_tree', return_value=(EXISTING, {})), \
                patch.object(developer, 'project_guide', return_value=''), \
                patch.object(developer, 'read_source', return_value=SOURCES['app/main.py']), \
                patch.object(developer, 'requirements_open', return_value=[]), \
                patch.object(developer, 'is_private', return_value=False), \
                patch.object(developer, 'code_providers', return_value={'groq'}), \
                patch.object(developer, 'run_model', return_value=('fixture', PROPOSAL)) as model:
            _, _, changes, _, _ = developer.revise_branch({'title': 'Authorized task', 'body': TASK},
                {'number': 1, 'body': ''}, 'fixture', 'fixture', [], 'fixture', 'fixture')
        self.assertIn(TASK, model.call_args.args[1])
        self.assertIn('return 2', changes['app/main.py'])

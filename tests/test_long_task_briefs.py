"""Fitting owner briefs reach each consumer; oversized briefs stop before inference."""
from tests.repair_fixtures import response_or
import json
import unittest
from unittest.mock import patch

from engine import coder, developer, gateway, recovery, verify


TAIL = '\nFinal requirement: retain manual location entry and never broaden authorization.'
TASK = 'Implement the authorized change.\n' + 'x' * (1200 - len(TAIL) - len('Implement the authorized change.\n')) + TAIL
SOURCES = {'app/main.py': 'def main():\n    return 1\n'}
EXISTING = {path: len(source) for path, source in SOURCES.items()}
PROPOSAL = json.dumps({'summary': 'Change return value', 'files': [
    {'path': 'app/main.py', 'reason': 'Implement the requested return value', 'edits': [{'find': 'return 1', 'replace': 'return 2'}]}]})


class LongTaskBriefTests(unittest.TestCase):
    def test_playground_generation_preserves_the_brief_and_sandbox_paths(self):
        proposal = json.dumps({'files': [{'path': 'projects/demo/main.py', 'content': 'print(2)\n'}]})
        with patch.object(coder, 'run_model', return_value=('fixture', proposal)) as model:
            _, files = coder.generate('fixture', TASK)
        self.assertIn(TASK, model.call_args.args[1])
        self.assertEqual(files, [('projects/demo/main.py', 'print(2)\n')])

    def test_file_selection_receives_the_complete_fitting_brief(self):
        with patch.object(developer, 'run_model', return_value=('fixture', '{"read":["app/main.py"]}')) as model:
            chosen = developer.select_files('fixture', TASK, EXISTING)
        self.assertEqual(chosen, ['app/main.py'])
        self.assertIn(TASK, model.call_args.args[1])

    def test_brief_that_cannot_fit_the_request_cap_fails_before_inference(self):
        too_long = 'x' * 20000
        with patch.object(developer, 'run_model') as model:
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                developer.generate('fixture', too_long, 'onlykappa/KappaForge', SOURCES, EXISTING)
        model.assert_not_called()

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
            _, _, changes, _, _ = developer.revise_branch({'number': 1, 'title': 'Authorized task', 'body': TASK},
                {'number': 1, 'body': ''}, 'kappa/dev-1', 'a' * 40, [], 'fixture', 'fixture')
        self.assertIn(TASK, model.call_args.args[1])
        self.assertIn('return 2', changes['app/main.py'])


class ResumedBriefTests(unittest.TestCase):
    def test_resumed_repair_is_told_what_progress_md_says_is_done_and_left(self):
        from types import SimpleNamespace
        from engine import progress_notes
        notes = progress_notes.Notes(1, 'onlykappa/KappaForge')
        notes.update(plan=['Change the return value', 'Add a test'], done=['Stage 1 (written by groq:x): changed it'],
                     files=['app/main.py'], stop={'reason': 'HTTP 429 rate-limited'})
        journal = SimpleNamespace(state={}, notes=notes, checkpoint=lambda *a, **k: None, loader=None)
        current = recovery.CURRENT.set(journal)
        self.addCleanup(recovery.CURRENT.reset, current)
        github = lambda path, _token: [{'filename': 'app/main.py', 'status': 'modified', 'patch': 'fixture'}] if '/files?' in path else []
        coding_inputs = []
        def capture_generation(*args, **kwargs):
            coding_inputs.append(args[1] + developer.REPAIR_ADVISORY.get())
            return 'fixture', 'done', {'app/main.py': 'x'}, ''
        with patch.object(developer, 'gh', side_effect=github), \
                patch.object(developer, 'list_tree', return_value=(EXISTING, {})), \
                patch.object(developer, 'project_guide', return_value=''), \
                patch.object(developer, 'read_source', return_value=SOURCES['app/main.py']), \
                patch.object(developer, 'requirements_open', return_value=['Finish the saved checkpoint']), \
                patch.object(developer, 'is_private', return_value=False), \
                patch.object(developer, 'code_providers', return_value={'groq'}), \
                patch.object(developer, 'check_the_work', return_value=({'app/main.py': 'x'}, '', [])), \
                patch.object(developer, 'run_model', side_effect=lambda key, prompt, **kw: response_or(prompt, ('m', '{}'))), \
                patch.object(journal, 'persist', lambda: None, create=True), \
                patch.object(developer, 'generate', side_effect=capture_generation) as generate:
            developer.revise_branch({'number': 1, 'title': 'Authorized task', 'body': TASK}, {'number': 1, 'body': '', 'html_url': 'pr'},
                                    'kappa/dev-1', 'a' * 40, [], 'fixture', 'fixture')
        prompt = coding_inputs[0]
        self.assertIn('SAVED PROGRESS', prompt)
        self.assertIn('1. [done] Change the return value', prompt)
        self.assertIn('2. [not done] Add a test', prompt)
        self.assertIn(TAIL.strip(), prompt, 'the notes never displace the owner brief')

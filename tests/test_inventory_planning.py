"""Inventory planning uses pinned tree facts without another model discovery loop."""
from contextlib import ExitStack
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch
from engine import clarification, developer, exploration, inventory, recovery, requirements, task_goal, task_state, verify

DOC = 'docs/phase3/architecture-inventory.md'
TASK = ('Phase 3.1, next small job: checkpoint 3.1b architecture inventory only.\n'
        'Start a fresh branch from current main.\nCreate only ' + DOC + ': record entry files and responsibilities.\n'
        'Inspect source and cite file paths/commit-pinned GitHub links.\n'
        'Label source inspection separately from tests actually run; record uncertainties instead of guessing.\n'
        'Do not repair code, broaden the audit, merge, deploy, or release.')
SHA = 'a' * 40


class InventoryPlanningTests(unittest.TestCase):
    def files(self):
        root = Path(__file__).resolve().parents[1]
        paths = list(inventory.ENTRY_FILES) + [p.relative_to(root).as_posix() for p in (root / '.github/workflows').glob('*.yml')]
        return {p: (root / p).stat().st_size for p in paths}

    def test_deterministic_plan_reads_startup_config_and_real_workflows_without_model(self):
        files = self.files()
        with ExitStack() as stack:
            for var, value in ((recovery.CURRENT, None), (exploration.REQUEST, ('old question',)),
                               (requirements.ANSWER, ['old']), (clarification.REQUEST, {'old': True})):
                token = var.set(value); stack.callback(var.reset, token)
            model = stack.enter_context(patch.object(developer, 'run_model', side_effect=AssertionError('No discovery call needed')))
            paths, stages, design = developer.plan_change('key', TASK, files)
            model.assert_not_called()
            self.assertTrue(set(inventory.ENTRY_FILES) <= set(paths))
            self.assertFalse(stages)
            for p in files:
                if p.startswith('.github/workflows/'):
                    self.assertIn(p, design)
            self.assertEqual(exploration.REQUEST.get(), ())
            self.assertIsNone(clarification.REQUEST.get())
            rows = requirements.classify(TASK)
            self.assertFalse(any(r.behavioral or 'research' in r.categories or 'testing' in r.categories for r in rows))

    def test_existing_output_incomplete_tree_and_positive_code_ask_use_normal_planner(self):
        files = self.files()
        for task, tree in ((TASK, dict(files, **{DOC: 40})), (TASK, {'preview/index.html': 40}),
                           (TASK + '\nImplement a new feature.', files)):
            self.assertIsNone(inventory.read_plan(task, tree, developer.LARGE.read_files))
        self.assertFalse(inventory.evidence_ask('Create an architecture inventory UI screen with an endpoint.'))

    def test_inventory_does_not_inject_large_unrelated_controller_source(self):
        goal = task_goal.from_request(TASK)
        token = task_goal.CURRENT.set(goal)
        try:
            with patch.object(developer, 'read_source', side_effect=AssertionError('Unrelated source read')):
                sources = {'preview/index.html': '<html>'}
                result = developer._add_engine_developer_source(sources, {'engine/developer.py': 300000}, developer.ROOT, SHA, 'token')
                self.assertEqual(result, sources)
        finally:
            task_goal.CURRENT.reset(token)

    def test_more_than_eight_workflow_citations_can_be_verified_in_one_bounded_review(self):
        task = 'Create a repository inventory of workflow filenames.'
        sources = {f'.github/workflows/work{i}.yml': f'name: Work{i}\non: push\n' for i in range(12)}
        document = 'Workflow inventory\n' + '\n'.join('https://github.com/onlykappa/KappaForge/blob/' + SHA + '/' + p for p in sources)
        goal = task_goal.from_request(task)
        token = task_goal.CURRENT.set(goal)
        calls = []
        try:
            task_state.bind('onlykappa/KappaForge', 298, 'kappa/dev-298', SHA)
            def model(key, prompt, **kwargs):
                calls.append(prompt)
                self.assertLess(len(prompt), 20000)
                for text in sources.values():
                    self.assertIn(text.strip(), prompt)
                return 'scripted', json.dumps(dict(requirements=[dict(text=task, met=True,
                    evidence=dict(path=DOC, quote='Workflow inventory'))], problems=[],
                    file_scope=[dict(path=DOC, necessary=True, reason='Requested inventory', quote='Workflow inventory')],
                    source_checks=[dict(document=DOC, path=p, quote=t.splitlines()[0], supports=True,
                                        reason='Names the workflow in this file') for p, t in sources.items()]))
            result = verify.model_review(model, 'key', task, lambda p: sources.get(p, ''), {DOC: document}, list(sources))
            self.assertEqual(result[1], [])
            self.assertEqual(len(calls), 1)
        finally:
            task_goal.CURRENT.reset(token)

    def test_source_snippets_obey_budget_and_unknown_paths_are_never_read(self):
        sources = {'preview/index.html': '<script src="core.js"></script>' * 100 + '<script src="app-main.js"></script>'}
        complete = set()
        context, _ = inventory.review_context(sources.__getitem__, {DOC: 'Inventory'},
            {DOC: ['unknown/path', 'preview/index.html']}, [], 900, complete, set(sources) | {DOC})
        self.assertLessEqual(len(context), 900)
        self.assertIn('app-main.js', context)
        self.assertNotIn('unknown/path', context)
        self.assertNotIn('preview/index.html', complete)
        self.assertIn('PARTIAL', context)


if __name__ == '__main__':
    unittest.main()

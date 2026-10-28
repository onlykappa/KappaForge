"""Confirmed repairs retain the exact owner request without duplicating it in coding prompts."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import developer, gateway, recovery, task_goal, task_state


class CodegenContextTests(unittest.TestCase):
    def test_scope_rules_survive_deduplication_and_partial_tasks_keep_the_full_request(self):
        goal = task_goal.from_request('Make app.py preserve every required output.')
        goal.paths = ('app.py',)
        full = goal.request + '\nVerified target: app.py'
        rules = goal.prompt(included_in=full)
        self.assertNotIn(goal.request, rules)
        self.assertIn('Only these source files implement this bounded goal: app.py', rules)
        self.assertIn('Each changed file must be necessary for this goal', rules)
        self.assertIn(goal.request, goal.prompt(included_in='Fix app.py'))
        self.assertIn(goal.request, goal.prompt())

    def test_advisory_history_fits_small_allocation_and_retains_design_provenance(self):
        evidence = 'Inspected dependency SHA: ' + 'a' * 40 + '\n'
        history = developer.verified_history(evidence + 'd' * 2000, ['t' * 600] * 3,
                                             'notes ' * 1000, 'native ' * 1000, '+' * 30000, limit=3000)
        self.assertLessEqual(len(history), 3000)
        self.assertIn(evidence, history)
        self.assertIn('shortened', history)

    def test_only_confirmed_literal_current_source_becomes_an_excerpt_anchor(self):
        source = {'app.py': '# header\nreturn wrong\n'}
        rows = [dict(verdict='needs_validation', evidence=[dict(path='app.py', quote='# header')]),
                dict(verdict='confirmed', evidence=[dict(path='../outside', quote='x'),
                                                    dict(path='app.py', quote='invented'),
                                                    dict(path='app.py', quote='return wrong')])]
        self.assertEqual(developer.verified_source_lines(rows, source), {'app.py': [1]})

    def test_long_confirmed_repair_reaches_coder_with_full_goal_and_literal_source(self):
        request = 'Correct app.py numeric output.\n' + '\n'.join(
            'Owner condition ' + str(i) + ': preserve ' + 'required behavior ' * 11 for i in range(25))
        goal = task_goal.from_request(request)
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(goal))
        journal = SimpleNamespace(state={'events': [], 'repairStrategy': 'compact'}, persist=Mock(),
                                  avoid_models=Mock(return_value=set()), rejected=Mock(return_value=False))
        old_paths = [f'old_{i}.py' for i in range(20)]
        journal.state.update(sourcePriority=old_paths, files=old_paths)
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(journal))
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        sources = {p: '# unrelated history\n' * 400 for p in old_paths}
        sources['app.py'] = '# unrelated header\n' * 400 + 'return a + b\n'
        existing = {p: len(text) for p, text in sources.items()}
        anchors = developer.verified_source_lines([dict(verdict='confirmed', evidence=[dict(path='app.py', quote='return a + b')])], sources)
        self.addCleanup(developer.REPAIR_SOURCE_TARGETS.reset, developer.REPAIR_SOURCE_TARGETS.set(('app.py',)))
        self.addCleanup(developer.REPAIR_SOURCE_LINES.reset, developer.REPAIR_SOURCE_LINES.set(anchors))
        self.addCleanup(developer.FOCUSED_REPAIR.reset, developer.FOCUSED_REPAIR.set(True))
        advisory = 'Existing design and attempt history (unverified):\n' + 'old advisory context ' * 1500
        self.addCleanup(developer.REPAIR_ADVISORY.reset, developer.REPAIR_ADVISORY.set(advisory))
        self.assertEqual(developer.source_priorities(sources, existing, task='app.py', journal=journal), ['app.py'])
        task = request + '\nVerified repair targets only: app.py\n' + developer.verified_history(
            'Reviewer-inspected facts\n' + 'd' * 2000, ['t' * 600] * 3, 'n' * 5000, 'b' * 5000, '+' * 30000, limit=3000)
        seen = []
        def model(key, prompt, **kwargs):
            wire = task_state.add_to_prompt(prompt, journal)
            self.assertLessEqual(len(wire.encode('utf-16-le')) // 2, gateway.engine_prompt_cap())
            self.assertEqual(prompt.count(request), 1)
            self.assertIn('return a + b', prompt)
            self.assertIn('(Advisory repair history omitted.)', prompt)
            seen.append(prompt)
            return 'fixture', json.dumps({'files': [{'path': 'app.py', 'reason': 'Convert requested numeric inputs',
                'edits': [{'find': 'return a + b', 'replace': 'return int(a) + int(b)'}]}]})
        with patch.object(gateway, 'engine_prompt_cap', return_value=20000), \
                patch.object(developer, 'run_model', side_effect=model):
            result = developer.generate('key', task, developer.ROOT,
                                        sources, existing)
        self.assertEqual(len(seen), 1)
        self.assertIn('int(a)', result[2]['app.py'])

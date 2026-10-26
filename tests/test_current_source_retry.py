import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from engine import developer, gateway, recovery, repair_guard, task_goal, task_state


class CurrentSourceRetryTests(unittest.TestCase):
    def test_anchor_retry_keeps_current_row_and_original_output_allowance(self):
        path = 'docs/audit.md'
        old = '| 3.1a | Main: a6834a9 |'
        row = '| 3.1a | Main: 3a70287 |'
        source = '# audit\n' + 'unrelated history\n' * 220 + row + '\n' + 'tail\n' * 100
        budget = developer.Budget(2, 1, 4000, 10000, 2000)
        bad = json.dumps({'files': [{'path': path, 'edits': [{'find': old, 'replace': 'wrong'}]}]})
        replacement = row + ' linked provenance' * 80
        good = json.dumps({'files': [{'path': path, 'edits': [{'find': row, 'replace': replacement}]}]})
        prompts = []
        def model(key, prompt, **kwargs):
            prompts.append(prompt)
            self.assertTrue(gateway.prompt_fits(prompt))
            if len(prompts) == 1:
                return 'first', bad
            self.assertIn('CURRENT-SOURCE RETRY', prompt)
            self.assertIn(row, prompt)
            self.assertNotIn(old, prompt)
            return 'second', good
        with patch.object(developer, 'run_model', side_effect=model):
            _, _, changes, _ = developer.generate_with('key', 'Add linked provenance to row 3.1a only.',
                developer.ROOT, {path: source}, {path: len(source)}, '', None, budget, max_attempts=2)
        self.assertEqual(changes[path], source.replace(row, replacement))
        self.assertEqual(len(prompts), 2)

    def test_invalid_anchors_are_still_rejected_without_fuzzy_application(self):
        path = 'docs/audit.md'
        source = '| 3.1a | Main: 3a70287 |\n'
        bad = json.dumps({'files': [{'path': path, 'edits': [{'find': 'PENDING ROW', 'replace': 'changed'}]}]})
        with patch.object(developer, 'run_model', return_value=('fixture', bad)):
            with self.assertRaises(developer.GenerationFailure):
                developer.generate_with('key', 'Add commit links only.', developer.ROOT, {path: source},
                    {path: len(source)}, '', None, developer.SMALL, max_attempts=2)
        self.assertEqual(source, '| 3.1a | Main: 3a70287 |\n')


class SmallResourceEnvelopeTests(unittest.TestCase):
    def test_small_batches_preserve_exact_goal_and_literal_evidence_under_4074(self):
        task = ('Add only missing commit links. Change docs/audit.md only. Keep the PR a draft; stop after this fix. '
                'Do not broaden the audit, merge, deploy or release. ')
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        journal = SimpleNamespace(state=dict(repo=developer.ROOT, task=282, candidate='a' * 40, files=[],
                                             gatewayResourceBudgets={'verify': 4074}), project={}, persist=lambda: None)
        jhandle = recovery.CURRENT.set(journal)
        task_state.bind(developer.ROOT, 282, 'kappa/dev-282', 'a' * 40, journal=journal)
        calls = []
        def model(key, prompt, **kwargs):
            self.assertTrue(gateway.prompt_fits(prompt))
            self.assertLessEqual(gateway.prompt_budget(prompt)['promptChars'], 4074)
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            self.assertEqual(data['owner_goal'], task)
            self.assertTrue(data['sources'])
            calls.append(prompt)
            return 'fixture', json.dumps({'findings': [dict(id=row['id'], verdict='confirmed', in_goal=True,
                reason='Required commit link is absent', owner_quote='Add only missing commit links.',
                evidence=[dict(path='docs/audit.md', quote='Phase 1: abc123')]) for row in data['findings']]})
        try:
            rows = repair_guard.verify_all_findings(model, 'key', task, ['missing link ' + str(n) for n in range(5)],
                                                     {'docs/audit.md': 'Phase 1: abc123\n'})
            self.assertEqual(len(rows), 5)
            self.assertTrue(all(row['verdict'] == 'confirmed' for row in rows))
            self.assertEqual(journal.state['gatewayResourceBudgets']['verify'], 4074)
        finally:
            recovery.CURRENT.reset(jhandle)
            task_goal.CURRENT.reset(handle)

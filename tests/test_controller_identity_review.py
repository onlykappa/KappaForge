"""Controller identity constraints use receipts, not document quotations or extra model votes."""
import json
import os
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from engine import developer, recovery, repair_guard, runner, task_goal, task_state, verify

TASK = 'Do not resume task #274 or reuse its branch/checkpoint.'
SHA = 'a' * 40
REPO = 'onlykappa/KappaForge'


def fixture():
    goal = task_goal.from_request(TASK)
    journal = SimpleNamespace(state=dict(repo=REPO, task=282, candidate=SHA, files=[], requirements=[TASK]),
        scope=SimpleNamespace(repo=REPO, number=282), project={'budgets': {'modelCalls': None}},
        persist=lambda: None, requirements=lambda rows: None)
    return goal, journal


def simulate():
    goal, journal = fixture()
    counts = dict(gateway=0, verification=0, review=0)
    def provider(prompt, *args, **kwargs):
        counts['gateway'] += 1
        if repair_guard.FINDING_MARKER in prompt:
            counts['verification'] += 1
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'simulation', json.dumps({'findings': [dict(id=row['id'], verdict='rejected', in_goal=True,
                reason='The task/checkpoint identity is 282, not 274',
                evidence=['Task state proves this is task282']) for row in data['findings']]})
        counts['review'] += 1
        return 'simulation', json.dumps(dict(requirements=[dict(text=TASK, met=False)],
            problems=['R9: No evidence that task #274 was not resumed or its branch reused.']))
    with ExitStack() as stack:
        handle = task_goal.CURRENT.set(goal); stack.callback(task_goal.CURRENT.reset, handle)
        handle = recovery.CURRENT.set(journal); stack.callback(recovery.CURRENT.reset, handle)
        task_state.bind(REPO, 282, 'kappa/dev-282', SHA)
        stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
        stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=provider))
        stack.enter_context(patch.object(developer, 'run_model', runner.run_model))
        stack.enter_context(patch.object(verify, 'wiring_problems', return_value=[]))
        stack.enter_context(patch.object(developer, 'generate', side_effect=AssertionError('Identity is not a source repair')))
        prior = list(developer.UNFINISHED); developer.UNFINISHED.clear()
        stack.callback(lambda: developer.UNFINISHED.__setitem__(slice(None), prior))
        progress = SimpleNamespace(now=lambda *a, **kw: None, ok=lambda *a, **kw: None)
        _, _, problems = developer.check_the_work('key', TASK, REPO, SHA, 'token',
            {'docs/audit.md': 'Historical task #274 evidence.\n'}, {'docs/audit.md': 40}, {}, '', None, '', False, progress)
        return dict(counts, requirement_verified=not problems, live_http_requests=0)


class ControllerIdentityTests(unittest.TestCase):
    def test_real_review_replay_uses_one_gateway_call_and_no_source_verification(self):
        self.assertEqual(simulate(), dict(gateway=1, verification=0, review=1,
                                         requirement_verified=True, live_http_requests=0))

    def test_receipt_requires_same_authority_candidate_and_task_and_exact_owner_ask(self):
        goal, journal = fixture()
        with ExitStack() as stack:
            handle = task_goal.CURRENT.set(goal); stack.callback(task_goal.CURRENT.reset, handle)
            handle = recovery.CURRENT.set(journal); stack.callback(recovery.CURRENT.reset, handle)
            task_state.bind(REPO, 282, 'kappa/dev-282', SHA)
            row = dict(text=TASK, met=False)
            verify.resolve_controller([row])
            self.assertTrue(row['met'])
            for field, bad in (('task', 274), ('candidate', 'b' * 40), ('repo', 'other/repo')):
                original = journal.state[field]; journal.state[field] = bad
                verify.resolve_controller([row]); self.assertFalse(row['met'])
                journal.state[field] = original
            journal.scope.number = 274
            verify.resolve_controller([row]); self.assertFalse(row['met'])
            journal.scope.number = 282
            other = dict(text='Do not resume task #282 or reuse its branch/checkpoint.', met=True)
            verify.resolve_controller([other]); self.assertFalse(other['met'])
            other = dict(text='Do not resume task #999 or reuse its branch/checkpoint.', met=True)
            verify.resolve_controller([other]); self.assertFalse(other['met'])

    def test_model_cannot_exempt_source_requirements_or_silence_other_findings(self):
        row = dict(text='Implement provenance lookup.', met=True, kind='controller')
        verify.resolve_controller([row])
        self.assertNotIn('kind', row)
        self.assertFalse(verify.controller_problem('docs/audit.md lacks commit links'))
        self.assertFalse(verify.controller_problem('R9: No evidence that task #274 was not resumed or its branch reused.', []))
        output = json.dumps(dict(requirements=[dict(text='Implement provenance lookup.', met=True, kind='controller',
                            evidence=dict(path='docs/audit.md', quote='invented evidence'))]))
        with ExitStack() as stack:
            handle = task_goal.CURRENT.set(None); stack.callback(task_goal.CURRENT.reset, handle)
            result = verify.model_review(lambda *a, **kw: ('simulation', output), 'key',
                'Implement provenance lookup.', lambda p: 'actual source', {}, ['docs/audit.md'])
        self.assertFalse(result[0][0]['met'])
        self.assertTrue(any('does not match' in p for p in result[1]))


if __name__ == '__main__':
    print(json.dumps(simulate(), indent=2))

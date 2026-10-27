"""Execution constraints use real controller receipts; provider responses are scripted."""
from contextlib import ExitStack
import copy
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from engine import developer, intent_guard, recovery, repair_guard, runner, task_goal, task_state, verify
try:
    from engine import operational_review
except ImportError:  # The same controlled replay can run against PR #300's original head.
    operational_review = None

SHA = 'a' * 40
DOC = 'docs/phase3/architecture-inventory.md'
SOURCE = 'Inventory source inspection.\n'
ASKS = [f'Create only {DOC}: architecture inventory.',
        'Start a fresh branch from current main.',
        'Leave task #282 and draft PR #284 untouched for later owner audit.',
        'Do not reuse their branch/checkpoint, edit their audit report, repair code, merge, deploy, release or proceed to 3.1c.',
        'Keep model requests small and retain existing request/provider limits and validation gates.']
TASK = '\n'.join(ASKS)


def context(stack, origin=True):
    issue = dict(number=298, state='open', user={'login': 'onlykappa'}, created_at='2099-01-01T00:00:00Z',
                 body='Repository: onlykappa/KappaForge\nMode: develop\n\n' + TASK)
    scope = intent_guard.ExecutionScope(issue)
    active = intent_guard.ExecutionScope(issue)
    goal = task_goal.from_request(TASK)
    journal = SimpleNamespace(scope=scope, state=dict(repo=scope.repo, task=298, candidate=SHA, digest=scope.digest,
        authorization=scope.identity, files=[], requirements=ASKS, budgets=dict(modelCalls=14, edits=0, fixCycles=0)),
        project={'budgets': {'modelCalls': None}}, persist=lambda: None,
        requirements=lambda rows: None)
    for var, value in ((task_goal.CURRENT, goal), (intent_guard.ACTIVE, active), (recovery.CURRENT, journal)):
        token = var.set(value); stack.callback(var.reset, token)
    task_state.bind(scope.repo, 298, 'kappa/dev-298', SHA, journal)
    if operational_review and origin:
        operational_review.observe_origin('main', SHA, True)
    return goal, journal, active


def simulate(origin=True):
    counts = dict(gateway=0, verification=0, review=0)
    def provider(prompt, *args, **kwargs):
        counts['gateway'] += 1
        if repair_guard.FINDING_MARKER in prompt:
            counts['verification'] += 1
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'scripted', json.dumps({'findings': [dict(id=row['id'], verdict='rejected', in_goal=True,
                reason='A branch/controller constraint cannot be repaired by editing this document',
                evidence=[dict(path=DOC, lines=[1])]) for row in data['findings']]})
        counts['review'] += 1
        return 'scripted', json.dumps(dict(requirements=[dict(text=ask, met=True,
            evidence=dict(path=DOC if i == 0 else 'KAPPA_TASK_STATE_V1', quote='Inventory' if i == 0 else 'task:298'))
            for i, ask in enumerate(ASKS)], problems=[],
            file_scope=[dict(path=DOC, necessary=True, reason='The only requested file', quote='Inventory')]))
    with ExitStack() as stack:
        goal, journal, active = context(stack, origin)
        stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
        stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=provider))
        stack.enter_context(patch.object(developer, 'run_model', runner.run_model))
        stack.enter_context(patch.object(verify, 'wiring_problems', return_value=[]))
        stack.enter_context(patch.object(developer, 'generate', side_effect=AssertionError('No source repair authorized')))
        prior = list(developer.UNFINISHED); developer.UNFINISHED.clear()
        stack.callback(lambda: developer.UNFINISHED.__setitem__(slice(None), prior))
        progress = SimpleNamespace(now=lambda *a, **kw: None, ok=lambda *a, **kw: None)
        _, _, problems = developer.check_the_work('key', TASK, active.repo, SHA, 'token',
            {}, {DOC: len(SOURCE)}, {DOC: SOURCE}, '', None, '', False, progress)
        return dict(counts, completed=not problems, modelCallsUsed=journal.state['budgets']['modelCalls'], liveHTTP=0)


class OperationalReviewTests(unittest.TestCase):
    def test_real_review_pipeline_resolves_constraints_without_finding_votes(self):
        result = simulate()
        self.assertEqual(result, dict(gateway=1, verification=0, review=1, completed=True, modelCallsUsed=15, liveHTTP=0))

    def test_missing_origin_stays_open_without_spending_source_repair_calls(self):
        result = simulate(origin=False)
        self.assertFalse(result['completed'])
        self.assertEqual((result['gateway'], result['verification']), (1, 0))

    def test_receipts_fail_closed_on_source_task_authority_and_goal_changes(self):
        with ExitStack() as stack:
            goal, journal, active = context(stack)
            row = dict(text=ASKS[1], met=False)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
            for key, bad in [('candidate', 'b' * 40), ('task', 282), ('repo', 'other/repo'), ('digest', 'wrong')]:
                old = journal.state[key]; journal.state[key] = bad
                verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])
                journal.state[key] = old
            journal.state['candidate'] = 'b' * 40
            task_state.checkpoint('b' * 40)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])
            operational_review.restore_origin(lambda p: dict(status='diverged', merge_base_commit={'sha': 'c' * 40}))
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])
            operational_review.restore_origin(lambda p: dict(status='ahead', merge_base_commit={'sha': SHA}))
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
            goal.request = 'Write different docs.'
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])

    def test_guard_does_not_allow_deploy_or_foreign_edits_but_keeps_test_dispatch(self):
        with ExitStack() as stack:
            _, _, active = context(stack)
            base = 'https://api.github.com/repos/onlykappa/KappaForge/'
            payload = {'ref': 'main', 'inputs': {'branch': 'kappa/dev-298', 'candidate_sha': SHA}}
            for workflow in ('sandbox-tests.yml', 'review-graph.yml', 'ios-build.yml'):
                active.permit(base + f'actions/workflows/{workflow}/dispatches', payload, 'POST')
            for workflow in ('deploy-chat.yml', 'authorized-completion.yml', 'agent.yml'):
                with self.assertRaises(PermissionError):
                    active.permit(base + f'actions/workflows/{workflow}/dispatches', payload, 'POST')
            row = dict(text=ASKS[2], met=False)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
            active.own_prs.add(284)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])
            bad = copy.deepcopy(payload); bad['inputs']['release'] = 'true'
            with self.assertRaises(PermissionError):
                active.permit(base + 'actions/workflows/ios-build.yml/dispatches', bad, 'POST')

    def test_code_changes_and_forged_model_exemptions_cannot_prove_limits_or_scope(self):
        with ExitStack() as stack:
            _, journal, _ = context(stack)
            operational_review.bounded_request(dict(failedChecks=[], promptChars=1000))
            for ask in ASKS[3:]:
                row = dict(text=ask, met=True, kind='controller', evidence={'receipt': 'invented'})
                verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
                verify.resolve_controller([row], {'engine/runner.py': 'changed'}); self.assertFalse(row['met'])
            row = dict(text='Add a setting for provider limits.', met=True, kind='controller')
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertNotIn('kind', row)
            journal.state['boundedRequests']['maxChars'] = 50000
            operational_review.bounded_request(dict(failedChecks=[], promptChars=1000))
            row = dict(text=ASKS[4], met=True)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])

    def test_origin_survives_verified_publication_without_resetting_counters(self):
        with ExitStack() as stack:
            goal, journal, _ = context(stack)
            child = 'b' * 40
            before = dict(journal.state['budgets'])
            operational_review.published(SHA, child)
            journal.state['candidate'] = child
            task_state.checkpoint(child)
            row = dict(text=ASKS[1], met=False)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
            goal.record.control.clear()
            operational_review.restore_origin(lambda p: self.fail('No ancestry read for the same validated candidate'))
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertTrue(row['met'])
            self.assertEqual(journal.state['budgets'], before)
            journal.state['branchOrigin']['unused'] = False
            goal.record.control.clear()
            operational_review.restore_origin()
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])

    def test_oversized_proposal_is_debited_but_never_becomes_a_request_receipt(self):
        with ExitStack() as stack:
            goal, journal, _ = context(stack)
            stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
            router = stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=AssertionError('Oversized request')))
            from engine import gateway
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                runner.run_model('key', 'x' * 25000)
            router.assert_not_called()
            self.assertEqual(journal.state['budgets']['modelCalls'], 15)
            row = dict(text=ASKS[4], met=True)
            verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])

    def test_missing_active_guard_cannot_be_replaced_by_model_receipts(self):
        with ExitStack() as stack:
            _, _, active = context(stack)
            token = intent_guard.ACTIVE.set(None); stack.callback(intent_guard.ACTIVE.reset, token)
            for text in ASKS[1:]:
                row = dict(text=text, met=True, kind='controller', evidence={'receipt': 'invented'})
                verify.resolve_controller([row], {DOC: SOURCE}); self.assertFalse(row['met'])

    def test_controller_reply_needs_real_receipt_not_a_fabricated_source_quote(self):
        with ExitStack() as stack:
            _, _, _ = context(stack)
            result = verify.model_review(lambda *a, **kw: ('scripted', json.dumps(
                {'requirements': [{'text': ASKS[1], 'met': True}]})), 'key', TASK, lambda p: '', {}, [])
            self.assertTrue(result[0][0]['met'])
            with self.assertRaises(ValueError):
                verify.parse_review(json.dumps({'requirements': [{'text': 'Implement a new setting.',
                                                                  'met': True, 'kind': 'controller'}]}))


if __name__ == '__main__':
    print(json.dumps(simulate(), indent=2))

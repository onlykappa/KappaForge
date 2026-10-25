"""Resource failures rebuild review evidence; they never waive a verdict or owner constraint."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import gateway, recovery, repair_guard, task_goal, task_state, verify


def resource_error():
    error = gateway.GatewayUnavailable('Worker resource limit')
    error.shrink_context = True
    return error


class ReviewResourceTests(unittest.TestCase):
    def setUp(self):
        self.goal = task_goal.from_request('Make add accept numeric strings. Never merge or deploy.')
        self.goal_token = task_goal.CURRENT.set(self.goal)
        self.journal = SimpleNamespace(state={}, persist=Mock())
        self.journal_token = recovery.CURRENT.set(self.journal)
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        self.env = patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        recovery.CURRENT.reset(self.journal_token)
        task_goal.CURRENT.reset(self.goal_token)

    def test_finding_review_rebuilds_smaller_evidence_and_keeps_exact_owner_and_claims(self):
        source = 'def add(a,b):\n    return a + b\n' + '# filler\n' * 3000
        prompts = []
        def model(key, prompt, **kw):
            prompts.append(prompt)
            if len(prompts) == 1:
                raise resource_error()
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertEqual(data['owner_goal'], self.goal.request)
            self.assertEqual(len(data['findings']), 2)
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='Numeric strings concatenate', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[1, 2])]) for r in data['findings']]})
        result = repair_guard.verify_findings(model, 'key', self.goal.request,
            ['Fix add numeric strings', 'Fix add concatenation'], {'app.py': source})
        self.assertEqual([r['verdict'] for r in result], ['confirmed', 'confirmed'])
        self.assertEqual(len(prompts), 2)
        self.assertLess(len(prompts[1]), len(prompts[0]))
        self.assertIn('gatewayResourcePromptChars', self.journal.state)
        self.journal.persist.assert_called()
        self.assertFalse(gateway.prompt_fits(prompts[0]), 'recovery must retain the smaller envelope')

    def test_scope_review_rebuilds_without_losing_any_path(self):
        changes = {f'file{n}.py': 'return int(a) + int(b)\n' + '# filler\n' * 1800 for n in range(3)}
        prompts = []
        def model(key, prompt, **kw):
            prompts.append(prompt)
            if len(prompts) == 1:
                raise resource_error()
            for path in changes:
                self.assertIn('CURRENT SOURCE ' + path, prompt)
            self.assertIn(self.goal.request, prompt)
            return 'fixture', json.dumps({'file_scope': [dict(path=p, necessary=True, reason='Requested conversion',
                quote='return int(a) + int(b)') for p in changes]})
        self.assertEqual(verify.scope_batches(model, 'key', self.goal.request, changes, self.goal, None), [])
        self.assertEqual(len(prompts), 2)
        self.assertLess(len(prompts[1]), len(prompts[0]))

    def test_requirement_review_rebuilds_and_preserves_owner_text(self):
        # No scope phase: exercise the separate requirement reviewer.
        self.goal.record = None
        prompts = []
        source = 'return int(a) + int(b)\n' + '# filler\n' * 12000
        def model(key, prompt, **kw):
            prompts.append(prompt)
            if len(prompts) == 1:
                raise resource_error()
            self.assertIn(self.goal.request, prompt)
            return 'fixture', json.dumps({'requirements': [], 'problems': [], 'files_needed': []})
        result = verify.model_review(model, 'key', self.goal.request, lambda _: source, {'app.py': source}, ['app.py'])
        self.assertIsNotNone(result)
        self.assertEqual(len(prompts), 2)
        self.assertLess(len(prompts[1]), len(prompts[0]))

    def test_resource_failure_is_distinct_from_provider_outage(self):
        self.assertEqual(recovery.diagnose(resource_error()), ('gateway_resource', 'reduce_review_context'))

    def test_repeated_resource_errors_stop_after_three_reductions(self):
        resources, prompts = gateway.ReviewResources(), []
        def build():
            return self.goal.request + '\n' + 'x' * int((resources.ceiling or 60000) * 0.7)
        def model(key, prompt, **kw):
            prompts.append(prompt)
            raise resource_error()
        with self.assertRaises(gateway.GatewayResourceExhausted) as raised:
            resources.call(model, 'key', build)
        self.assertEqual(len(prompts), 4)
        self.assertTrue(all(len(b) < len(a) for a, b in zip(prompts, prompts[1:])))
        self.assertTrue(raised.exception.terminal)
        self.assertEqual(recovery.diagnose(raised.exception), ('gateway_resource', 'stop'))

    def test_fixed_owner_text_that_cannot_fit_stops_without_truncation_or_network(self):
        self.journal.state['gatewayResourcePromptChars'] = 1024
        model = Mock()
        with self.assertRaises(gateway.GatewayResourceExhausted):
            repair_guard.verify_findings(model, 'key', self.goal.request + ' owner condition' * 500,
                ['Fix add'], {'app.py': 'return a + b\n'})
        model.assert_not_called()

    def test_unrelated_outages_and_pinned_limits_are_not_immediately_retried(self):
        for error in (gateway.GatewayUnavailable('ordinary outage'), resource_error()):
            error.terminal = bool(getattr(error, 'shrink_context', False))
            model = Mock(side_effect=error)
            with self.assertRaises(gateway.GatewayUnavailable):
                gateway.ReviewResources().call(model, 'key', lambda: self.goal.request)
            self.assertEqual(model.call_count, 1)

    def test_resource_retry_never_authorizes_invented_evidence(self):
        calls = []
        def model(key, prompt, **kw):
            calls.append(prompt)
            if len(calls) == 1:
                raise resource_error()
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            return 'fixture', json.dumps({'findings': [dict(id=data['findings'][0]['id'],
                verdict='confirmed', in_goal=True, reason='claim', owner_ref='R1',
                evidence=[dict(path='app.py', quote='invented source')])]})
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix add'],
            {'app.py': 'return a + b\n' + '# filler\n' * 2000})
        self.assertEqual(rows[0]['verdict'], 'needs_validation')

    def test_candidate_movement_during_resource_failure_stops_before_retry(self):
        def model(*args, **kwargs):
            task_state.checkpoint('b' * 40)
            raise resource_error()
        model = Mock(side_effect=model)
        with self.assertRaises(task_state.CandidateChanged):
            repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix add'], {'app.py': 'return a + b\n'})
        self.assertEqual(model.call_count, 1)



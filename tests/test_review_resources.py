"""Resource failures rebuild review evidence; they never waive a verdict or owner constraint."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import developer, gateway, recovery, repair_guard, task_goal, task_state, verify


def resource_error():
    error = gateway.GatewayUnavailable('Worker resource limit')
    error.shrink_context = True
    return error


class ReviewResourceTests(unittest.TestCase):
    def test_fitting_search_keeps_a_line_between_halved_source_allocations(self):
        source = '\n'.join(['# common context ' + str(i) for i in range(400)] + ['return wrong_value'])
        def fits(resources, prompt):
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            return sum(len(item['text']) for item in data['sources'].values()) <= 180
        def model(key, prompt, **kwargs):
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertIn('401| return wrong_value', data['sources']['app.py']['text'])
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='The return value violates the requested behavior', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[401, 401])]) for r in data['findings']]})
        with patch.object(gateway.ReviewResources, 'fits', fits):
            rows = repair_guard.verify_findings(model, 'key', self.goal.request,
                                               ['app.py:401 returns the wrong value'], {'app.py': source})
        self.assertEqual(rows[0]['verdict'], 'confirmed')

    def test_long_single_finding_retains_source_with_a_full_owner_request(self):
        task = '\n'.join('- Owner condition ' + str(i) + ': ' + 'preserve required behavior ' * 6 for i in range(18))
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        self.journal.state.update(gatewayResourceBudgets={'verify': 8334},
                                  budgets={'modelCalls': 233, 'edits': 1, 'fixCycles': 22})
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        calls = []
        def model(key, prompt, **kwargs):
            size = len(task_state.add_to_prompt(prompt, self.journal).encode('utf-16-le')) // 2
            self.assertLessEqual(size, 8334)
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertEqual(data['owner_goal'], task)
            self.assertIn('app.py', data['sources'])
            calls.append(size)
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='needs_validation',
                in_goal=True, reason='Behavior still requires investigation') for r in data['findings']]})
        try:
            claim = 'app.py: ' + 'Unverified owner condition; inspect the implementation. ' * 15
            rows = repair_guard.verify_findings(model, 'key', task, [claim], {'app.py': 'return a + b\n'})
            self.assertEqual(len(calls), 1)
            self.assertEqual(rows[0]['verdict'], 'needs_validation')
            self.assertEqual(self.journal.state['gatewayResourceBudgets']['verify'], 8334)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_single_finding_with_full_owner_scope_and_pr_receipt_fits_retained_envelope(self):
        task = '\n'.join('- Owner condition ' + str(i) + ': ' + 'preserve exact behavior ' * 5 for i in range(23))
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        self.journal.state.update(gatewayResourceBudgets={'verify': 8334},
                                  budgets={'modelCalls': 156, 'edits': 1, 'fixCycles': 16})
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        task_state.observe_pr({'html_url': 'https://github.com/onlykappa/KappaForge/pull/10',
            'state': 'open', 'draft': True, 'head': {'sha': 'a' * 40, 'ref': 'kappa/dev-9',
            'repo': {'full_name': 'onlykappa/KappaForge'}}}, 'onlykappa/KappaForge', 'kappa/dev-9')
        calls = []
        def model(key, prompt, **kwargs):
            calls.append(prompt)
            self.assertTrue(gateway.prompt_fits(prompt))
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertEqual(data['owner_goal'], task)
            self.assertIn('app.py', data['sources'])
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='Source lacks the requested conversion', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[1, 1])]) for r in data['findings']]})
        try:
            claims = ['app.py: preserve owner condition ' + str(i) + ' x' * 100 for i in range(4)]
            rows = repair_guard.verify_all_findings(model, 'key', task, claims, {'app.py': 'return a + b\n'})
            self.assertEqual([r['claim'] for r in rows], claims)
            self.assertTrue(all(r['verdict'] == 'confirmed' for r in rows))
            self.assertGreater(len(calls), 1)
            self.assertEqual(self.journal.state['gatewayResourceBudgets']['verify'], 8334)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_resource_reduction_with_receipts_rebuilds_and_splits_without_generic_review_failure(self):
        from copy import deepcopy
        task = '\n'.join('- Owner condition ' + str(i) + ': preserve the exact requested behavior.' for i in range(23))
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        self.journal.state.update(gatewayResourceBudgets={'verify': 12720},
                                  budgets={'modelCalls': 156, 'edits': 1, 'fixCycles': 16})
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        for kind in ('sandbox', 'native'):
            task_state.observe_validation(kind, 'a' * 40,
                {'id': 10, 'status': 'completed', 'conclusion': 'success'})
        goal.record.repair = {'assessment': 'controller evidence ' * 22}
        before = deepcopy((goal.record.checks, self.journal.state['budgets']))
        sizes, batches = [], []
        def model(key, prompt, **kwargs):
            wire = task_state.add_to_prompt(prompt, self.journal)
            sizes.append(len(wire.encode('utf-16-le')) // 2)
            self.assertTrue(gateway.prompt_fits(prompt))
            if len(sizes) == 1:
                raise resource_error()
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            batches.append(len(data['findings']))
            self.assertEqual(data['owner_goal'], task)
            self.assertIn('app.py', data['sources'])
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='Literal source shows the requested conversion is absent', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[1, 1])]) for r in data['findings']]})
        try:
            claims = ['app.py: finding ' + str(i) + ' ' + 'x' * 600 for i in range(4)]
            rows = repair_guard.verify_all_findings(model, 'key', task, claims,
                {'app.py': 'return a + b\n# filler ' + 'x' * 2900 + '\n'})
            self.assertEqual([r['claim'] for r in rows], claims)
            self.assertTrue(all(r['verdict'] == 'confirmed' for r in rows))
            self.assertGreater(len(sizes), 1)
            self.assertTrue(all(size < sizes[0] for size in sizes[1:]))
            self.assertLessEqual(max(batches), 2)
            self.assertEqual((goal.record.checks, self.journal.state['budgets']), before)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_long_owner_request_fits_learned_envelope_without_duplicate_requirement_text(self):
        from engine import requirements
        task = '\n'.join('- Requirement café ' + str(i) + ': keep this owner condition ' + 'precise ' * 75
                         for i in range(10))
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        self.journal.state['gatewayResourceBudgets'] = {'verify': 12720}
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        calls = []
        def model(key, prompt, **kwargs):
            calls.append(prompt)
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertEqual(data['owner_goal'], task)
            expected = requirements.split(task)
            self.assertEqual(len(data['owner_requirements']), len(expected))
            for original in expected:
                span = data['owner_requirements'][original['id']]
                self.assertEqual(task[span[0]:span[1]], original['text'])
            self.assertLessEqual(len(prompt), 12720)
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='The requested conversion is absent', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[1, 1])]) for r in data['findings']]})
        try:
            rows = repair_guard.verify_findings(model, 'key', task, ['Fix numeric strings'],
                                               {'app.py': 'return a + b\n'})
            self.assertEqual(rows[0]['verdict'], 'confirmed')
            self.assertEqual(len(calls), 1)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_resource_blocked_batches_split_without_losing_findings(self):
        batches = []
        claims = ['claim ' + str(i) for i in range(7)]
        def review(model, key, task, items, sources, allowed=None):
            batches.append(list(items))
            if len(items) > 1:
                raise gateway.GatewayResourceExhausted()
            return [dict(id=repair_guard.digest(items[0]), claim=items[0], verdict='needs_validation')]
        with patch.object(repair_guard, 'verify_findings', side_effect=review):
            rows = repair_guard.verify_all_findings(Mock(), 'key', self.goal.request, claims,
                                                    {'app.py': 'return a + b\n'})
        self.assertEqual([r['claim'] for r in rows], claims)
        self.assertEqual(len(batches), 12)
        self.assertEqual(max(map(len, batches)), 4)

    def test_populated_recovery_history_leaves_room_for_owner_findings_and_literal_source(self):
        from copy import deepcopy
        task = '\n'.join('- Condition ' + str(i) + ': ' + 'keep scope ' * 12 for i in range(30))
        goal = task_goal.from_request(task)
        handle = task_goal.CURRENT.set(goal)
        self.journal.state['gatewayResourceBudgets'] = {'verify': 12720}
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        goal.record.files = ['path_' + str(i) + '_' + 'x' * 80 + '.py' for i in range(24)]
        goal.record.attempts = [dict(kind='validation', error='x' * 600, candidate='a' * 40) for _ in range(4)]
        before = deepcopy((goal.record.files, goal.record.attempts))
        sizes = []
        def model(key, prompt, **kwargs):
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            self.assertEqual(data['owner_goal'], task)
            self.assertIn('app.py', data['sources'])
            sizes.append(len(task_state.add_to_prompt(prompt, self.journal).encode('utf-16-le')) // 2)
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='The requested conversion is absent', owner_ref='R1',
                evidence=[dict(path='app.py', lines=[1, 1])]) for r in data['findings']]})
        try:
            claims = ['app.py: finding ' + str(i) + ' ' + 'x' * 700 for i in range(4)]
            rows = repair_guard.verify_all_findings(model, 'key', task, claims, {'app.py': 'return a + b\n'})
            self.assertEqual([r['claim'] for r in rows], claims)
            self.assertTrue(all(r['verdict'] == 'confirmed' for r in rows))
            self.assertTrue(all(size <= 12720 for size in sizes))
            self.assertGreaterEqual(len(sizes), 2)
            self.assertEqual((goal.record.files, goal.record.attempts), before)
            self.assertEqual(self.journal.state['gatewayResourceBudgets']['verify'], 12720)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_available_source_cannot_be_entirely_dropped_to_fit_a_review(self):
        self.journal.state['gatewayResourceBudgets'] = {'verify': 12720}
        model = Mock()
        with patch.object(repair_guard, 'MAX_SOURCE_CHARS', 0), \
                self.assertRaises(gateway.GatewayResourceExhausted):
            repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix numeric strings'],
                                         {'app.py': 'return a + b\n'})
        model.assert_not_called()

    def test_single_finding_resource_failure_stops_without_partial_authorization(self):
        calls = []
        def review(model, key, task, items, sources, allowed=None):
            calls.append(list(items))
            if len(items) > 1 or items == ['second']:
                raise gateway.GatewayResourceExhausted()
            return [dict(id=repair_guard.digest(items[0]), claim=items[0], verdict='confirmed')]
        with patch.object(repair_guard, 'verify_findings', side_effect=review), \
                self.assertRaises(gateway.GatewayResourceExhausted):
            repair_guard.verify_all_findings(Mock(), 'key', self.goal.request, ['first', 'second'],
                                            {'app.py': 'return a + b\n'})
        self.assertEqual(calls, [['first', 'second'], ['first'], ['second']])

    def test_candidate_movement_blocks_subdivision_after_resource_failure(self):
        def review(*args, **kwargs):
            task_state.checkpoint('b' * 40)
            raise gateway.GatewayResourceExhausted()
        with patch.object(repair_guard, 'verify_findings', side_effect=review) as model, \
                self.assertRaises(task_state.CandidateChanged):
            repair_guard.verify_all_findings(Mock(), 'key', self.goal.request, ['first', 'second'],
                                            {'app.py': 'return a + b\n'})
        self.assertEqual(model.call_count, 1)

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
        self.assertIn('verify', self.journal.state['gatewayResourceBudgets'])
        self.journal.persist.assert_called()
        token = task_state.ROUTING_ROLE.set('verify')
        try:
            self.assertFalse(gateway.prompt_fits(prompts[0]), 'recovery must retain the smaller verifier envelope')
        finally:
            task_state.ROUTING_ROLE.reset(token)

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
        self.assertEqual(len(prompts), 3)
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

    def test_legacy_verify_limit_is_migrated_and_does_not_cap_coding(self):
        self.journal.state.update(gatewayResourcePromptChars=25000, gatewayEvidence=[{
            'role': 'verify', 'code': 'worker_resource_limit', 'platformError': {'errorCode': 1102}}])
        with task_state.action('reviewer', 'Verify', '', ''):
            token = task_state.ROUTING_ROLE.set('verify')
            try:
                self.assertEqual(gateway.resource_ceiling(), 25000)
            finally:
                task_state.ROUTING_ROLE.reset(token)
        # History eviction after handoff must not turn the verified hint back into a global ceiling.
        self.journal.state['gatewayEvidence'] = []
        with task_state.action('coder', 'Repair', '', ''):
            self.assertIsNone(gateway.resource_ceiling())
            self.assertTrue(gateway.prompt_fits('fixed owner/project rules\n' + 'x' * 18000))
        self.assertEqual(self.journal.state['gatewayResourceBudgets']['verify'], 25000)

    def test_role_budgets_survive_new_controller_and_never_raise_other_roles(self):
        for role, size in (('review', 18000), ('code', 30000)):
            token = task_state.ROUTING_ROLE.set(role)
            try:
                gateway.remember_resource_limit('x' * size)
            finally:
                task_state.ROUTING_ROLE.reset(token)
        budgets = json.loads(json.dumps(self.journal.state['gatewayResourceBudgets']))
        self.journal.state = {'gatewayResourceBudgets': budgets}
        token = task_state.ROUTING_ROLE.set('review')
        try:
            self.assertEqual(gateway.ReviewResources().ceiling, budgets['review'])
            self.assertLess(budgets['review'], budgets['code'])
        finally:
            task_state.ROUTING_ROLE.reset(token)

    def test_unattributed_legacy_limit_is_preserved_conservatively(self):
        self.journal.state['gatewayResourcePromptChars'] = 25000
        with task_state.action('coder', 'Repair', '', ''):
            self.assertEqual(gateway.resource_ceiling(), 25000)

    def test_orchestrator_splits_even_small_lists_and_preserves_every_decision(self):
        sizes, outputs = [], []
        def model(key, prompt, **kw):
            data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
            sizes.append(len(data['findings']))
            outputs.append(kw['max_output_tokens'])
            return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
                reason='Numeric strings concatenate', owner_ref='R1', evidence=[dict(path='app.py', lines=[1, 1])])
                for r in data['findings']]})
        claims = ['Fix numeric string case ' + str(n) for n in range(11)]
        rows = repair_guard.verify_all_findings(model, 'key', self.goal.request, claims, {'app.py': 'return a + b\n'})
        self.assertEqual(sizes, [4, 4, 3])
        self.assertTrue(all(n <= 1600 for n in outputs))
        self.assertEqual([r['id'] for r in rows], [repair_guard.digest(c) for c in claims])

    def test_repair_round_focuses_three_targets_and_keeps_deferred_findings_open(self):
        handle = recovery.CURRENT.set(None)
        developer.UNFINISHED.clear()
        claims = ['app.py: numeric case ' + str(n) for n in range(7)]
        findings = [dict(id=repair_guard.digest(c), claim=c, verdict='confirmed') for c in claims]
        first = ([dict(text='Numeric strings', met=True)], claims, [])
        final = ([dict(text='Numeric strings', met=True)], [], [])
        progress = SimpleNamespace(now=Mock(), ok=Mock())
        try:
            with patch.object(verify, 'model_review', side_effect=[first, final]), \
                    patch.object(verify, 'wiring_problems', return_value=[]), \
                    patch.object(repair_guard, 'verify_all_findings', return_value=findings), \
                    patch.object(repair_guard.RepairLoop, 'before_repair', return_value=''), \
                    patch.object(developer, 'MAX_CHECK_ROUNDS', 1), \
                    patch.object(developer, 'generate', return_value=('fixture', '', {'app.py': 'return int(a) + int(b)\n'}, '')) as coder:
                _, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, 'a' * 40, 'token',
                    {'app.py': 'return a + b\n'}, {'app.py': 13}, {}, '', None, '', False, progress)
            prompt = coder.call_args.args[1]
            self.assertIn(self.goal.request, prompt)
            for claim in claims[:3]:
                self.assertIn(claim, prompt)
            for claim in claims[3:]:
                self.assertNotIn(claim, prompt)
                self.assertIn(claim, problems, 'deferred work cannot disappear when the reviewer omits it')
        finally:
            recovery.CURRENT.reset(handle)

    def test_generation_preserves_large_owner_rules_after_legacy_verification_hint(self):
        self.journal.state.update(events=[], gatewayResourcePromptChars=25000, gatewayEvidence=[{
            'role': 'verify', 'platformError': {'errorCode': 1102}}])
        self.journal.avoid_models = Mock(return_value=set())
        self.journal.rejected = Mock(return_value=False)
        guide = 'Keep these exact owner project rules.\n' * 850
        proposal = json.dumps({'files': [{'path': 'app.py', 'reason': 'Convert numeric inputs',
            'edits': [{'find': 'return a + b', 'replace': 'return int(a) + int(b)'}]}]})
        with patch.object(developer, 'run_model', return_value=('fixture', proposal)) as model:
            result = developer.generate('key', self.goal.request, developer.ROOT,
                {'app.py': 'return a + b\n'}, {'app.py': 13}, guide)
        self.assertIn('int(a)', result[2]['app.py'])
        self.assertIn('Keep these exact owner project rules.', model.call_args.args[1])
        self.assertLessEqual(len(model.call_args.args[1]), gateway.ENGINE_PROMPT_CHARS)
        self.assertIn(self.goal.request, model.call_args.args[1])

    def test_focused_repair_fallback_never_grows_source_or_output_load(self):
        self.journal.state['events'] = []
        self.journal.project = {}
        budgets = []
        def generate(*args, **kwargs):
            budgets.append(args[7])
            if len(budgets) == 1:
                raise developer.GenerationFailure('split proposal', compact=True, attempts=1)
            return 'fixture', '', {'app.py': 'return int(a) + int(b)\n'}, ''
        token = developer.FOCUSED_REPAIR.set(True)
        try:
            with patch.object(developer, 'generate_with', side_effect=generate):
                developer.generate('key', self.goal.request, developer.ROOT, {'app.py': 'return a + b\n'}, {'app.py': 13})
        finally:
            developer.FOCUSED_REPAIR.reset(token)
        self.assertEqual(len(budgets), 2)
        for budget in budgets:
            self.assertLessEqual(budget.context_chars, 20000)
            self.assertLessEqual(budget.file_chars, 6000)
            self.assertLessEqual(budget.output_tokens, 4096)

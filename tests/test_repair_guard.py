"""Repair authorization needs fresh evidence, and unchanged/oscillating attempts stay bounded."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import developer, recovery, repair_guard, runner, task_goal, task_state, verify

SHA, NEXT = 'a' * 40, 'b' * 40
SOURCES = {'app.py': 'def add(a, b):\n    return a + b\n'}


def finding_response(prompt, verdict='confirmed', in_goal=True, quote='return a + b'):
    """Scripted verifier fixture. Real rejection/forgery cases override each decision below."""
    data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
    return 'verifier', json.dumps({'findings': [dict(id=row['id'], verdict=verdict, in_goal=in_goal,
        reason='The add function still concatenates numeric strings', owner_quote='numeric strings',
        evidence=[dict(path='app.py', quote=quote)]) for row in data['findings']]})


class RepairGuardTests(unittest.TestCase):
    def setUp(self):
        developer.Progress.latest = None
        self.goal = task_goal.from_request('Make add accept numeric strings')
        self.token = task_goal.CURRENT.set(self.goal)
        self.journal_token = recovery.CURRENT.set(None)
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', SHA)

    def tearDown(self):
        task_goal.CURRENT.reset(self.token)
        recovery.CURRENT.reset(self.journal_token)

    def assess(self, response, sources=None, claims=None):
        model = Mock(side_effect=lambda key, prompt, **kw: response(prompt))
        rows = repair_guard.verify_findings(model, 'key', self.goal.request,
                                           claims or ['app.py: add concatenates strings'], sources or SOURCES)
        return rows, model

    def test_real_finding_requires_current_source_and_out_of_goal_work_is_not_confirmed(self):
        rows, model = self.assess(finding_response)
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertIn('fresh verifier', model.call_args.args[1])
        for response in (lambda p: finding_response(p, quote='invented source'),
                         lambda p: finding_response(p, in_goal=False)):
            rows, _ = self.assess(response)
            self.assertEqual(rows[0]['verdict'], 'needs_validation')
        rows, _ = self.assess(lambda p: finding_response(p, verdict='rejected', in_goal=False))
        self.assertEqual(rows[0]['verdict'], 'rejected')

    def test_rejection_also_needs_evidence_and_omitted_source_is_not_proof(self):
        rows, _ = self.assess(lambda p: finding_response(p, verdict='rejected', quote='missing'))
        self.assertEqual(rows[0]['verdict'], 'needs_validation')

    def test_only_the_reviewed_redacted_claim_can_reach_a_coder(self):
        tail = 'UNSEEN TRAILING INSTRUCTIONS'
        secret = 'private-fixture-token'
        claim = 'Fix add ' + secret + ' x' * 600 + tail
        with patch.dict(os.environ, {'TEST_API_KEY': secret}):
            rows, model = self.assess(finding_response, claims=[claim])
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertLessEqual(len(rows[0]['claim']), 800)
        self.assertNotIn(tail, rows[0]['claim'])
        self.assertNotIn(secret, rows[0]['claim'])
        self.assertNotIn(secret, model.call_args.args[1])

    def test_verifier_uses_the_real_common_inference_boundary_and_current_role(self):
        seen = []
        def response(key, prompt, *a):
            seen.append(task_state.decode_prompt(prompt))
            return finding_response(prompt)
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': ''}), patch.object(runner, '_run_model', side_effect=response):
            rows = repair_guard.verify_findings(runner.run_model, 'key', self.goal.request, ['Fix add'], SOURCES)
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertEqual(seen[0]['nextAction']['role'], 'reviewer')
        self.assertEqual(seen[0]['identity']['candidate'], SHA)
        self.assertEqual(seen[0]['goal']['digest'], task_state.digest(self.goal))
        rows, _ = self.assess(lambda p: finding_response(p, quote='return 999'), sources={'app.py': 'return 1'})
        self.assertEqual(rows[0]['verdict'], 'needs_validation')

    def test_foreign_duplicate_missing_and_invalid_decisions_cannot_authorize_edits(self):
        for output in ('not JSON', '{}', '{"findings":[]}', '{"findings":[{"id":"foreign"}]}'):
            with self.subTest(output=output), self.assertRaises(repair_guard.RepairReviewRequired):
                self.assess(lambda _: ('m', output))
        too_many = [f'claim-{n}' for n in range(13)]
        model = Mock()
        with self.assertRaises(repair_guard.RepairReviewRequired):
            repair_guard.verify_findings(model, 'key', self.goal.request, too_many, SOURCES)
        model.assert_not_called()

    def test_late_results_for_a_different_candidate_or_goal_are_rejected(self):
        for move in (lambda: task_state.checkpoint(NEXT), lambda: setattr(self.goal, 'request', 'Different owner goal')):
            def respond(prompt):
                move()
                return finding_response(prompt)
            with self.assertRaises(task_state.CandidateChanged):
                self.assess(respond)
            self.goal.request = 'Make add accept numeric strings'
            task_state.checkpoint(SHA)

    def test_source_mutation_during_verification_is_stale_even_without_a_commit(self):
        sources = dict(SOURCES)
        def respond(prompt):
            sources['app.py'] += '# changed\n'
            return finding_response(prompt)
        with self.assertRaises(task_state.CandidateChanged):
            self.assess(respond, sources=sources)

    def test_diagnostics_are_redacted_bounded_and_never_reused_as_proof(self):
        journal = SimpleNamespace(state={}, persist=Mock())
        recovery.CURRENT.set(journal)
        secret = 'sensitive-fixture-value'
        def respond(prompt):
            model, wire = finding_response(prompt)
            data = json.loads(wire)
            data['findings'][0]['reason'] = secret
            return model, json.dumps(data)
        with patch.dict(os.environ, {'TEST_API_KEY': secret}):
            self.assess(respond)
        wire = json.dumps(journal.state)
        self.assertNotIn(secret, wire)
        self.assertNotIn('return a + b', wire)
        self.assertNotIn('quote', wire)
        self.assertIn('independent model assessments', task_state.snapshot()['repairAssessment']['evidence'])
        task_state.checkpoint(NEXT)
        self.assertEqual(task_state.snapshot()['repairAssessment'], {})

    def confirmed(self):
        return [dict(id=repair_guard.digest('add defect'), verdict='confirmed', reason='Convert the add inputs', evidence=[dict(path='app.py', quote='return a + b')])]

    def test_stagnant_repairs_get_one_review_then_stop_and_preserve_the_candidate(self):
        loop = repair_guard.RepairLoop()
        model = Mock(return_value=('m', json.dumps({'decision': 'stop', 'reason': 'Same attempts, no new evidence'})))
        for _ in range(2):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())
        model.assert_not_called()
        with self.assertRaises(repair_guard.RepairReviewRequired):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())
        self.assertEqual(model.call_count, 1)
        self.assertEqual(task_state.current()[1].identity['candidate'], SHA)
        self.assertEqual(task_state.snapshot()['repairAssessment']['loop']['decision'], 'stop')

    def test_alternating_repairs_are_detected_despite_commit_churn(self):
        loop, model = repair_guard.RepairLoop(), Mock(return_value=('m', '{"decision":"stop","reason":"Oscillation"}'))
        for n, value in enumerate(('A', 'B', 'A')):
            task_state.checkpoint(format(n + 10, '040x'))
            loop.before_repair(model, 'key', {'app.py': value}, self.confirmed())
        task_state.checkpoint(NEXT)
        with self.assertRaises(repair_guard.RepairReviewRequired):
            loop.before_repair(model, 'key', {'app.py': 'B'}, self.confirmed())
        self.assertEqual(model.call_count, 1)

    def test_genuine_source_progress_never_requests_loop_review(self):
        loop, model = repair_guard.RepairLoop(), Mock()
        for value in range(15):
            loop.before_repair(model, 'key', {'app.py': str(value)}, self.confirmed())
        model.assert_not_called()
        self.assertLessEqual(len(loop.history), 12)

    def test_continue_is_bounded_and_a_restart_does_not_reset_the_allowance(self):
        journal = SimpleNamespace(state={}, persist=Mock())
        recovery.CURRENT.set(journal)
        loop = repair_guard.RepairLoop()
        model = Mock(return_value=('m', '{"decision":"continue","reason":"New anchor available","next_approach":"Use the exact current add line"}'))
        for _ in range(3):
            approach = loop.before_repair(model, 'key', SOURCES, self.confirmed())
        self.assertIn('exact current add line', approach)
        loop = repair_guard.RepairLoop()  # Reload only the bounded history/allowance, not finding permissions.
        with self.assertRaises(repair_guard.RepairReviewRequired):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())
        self.assertEqual(model.call_count, 1)
        self.assertNotIn('return a + b', json.dumps(journal.state))

    def test_corrupt_or_wrong_goal_history_is_ignored(self):
        journal = SimpleNamespace(state={'repairLoop': {'version': 1, 'scope': {}, 'history': ['bad'], 'reviews': True}}, persist=Mock())
        recovery.CURRENT.set(journal)
        self.assertEqual(repair_guard.RepairLoop().history, [])

    def test_a_provider_outage_before_verification_creates_no_repair_attempt(self):
        from engine.reliability import ProviderRoutesUnavailable
        journal = SimpleNamespace(state={}, persist=Mock())
        recovery.CURRENT.set(journal)
        model = Mock(side_effect=ProviderRoutesUnavailable('No approved routes available'))
        with self.assertRaises(ProviderRoutesUnavailable):
            repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix add'], SOURCES)
        self.assertNotIn('repairLoop', journal.state)
        self.assertNotIn('repairEvidence', journal.state)

    def test_another_tasks_journal_cannot_receive_finding_decisions(self):
        journal = SimpleNamespace(state={'repo': 'onlykappa/KappaForge', 'task': 99}, persist=Mock())
        recovery.CURRENT.set(journal)
        model = Mock()
        with self.assertRaises(task_state.CandidateChanged):
            repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix add'], SOURCES)
        model.assert_not_called()
        journal.persist.assert_not_called()

    def test_a_late_loop_continue_cannot_authorize_an_edit_to_a_new_candidate(self):
        loop = repair_guard.RepairLoop()
        def respond(*a, **kw):
            task_state.checkpoint(NEXT)
            return 'm', '{"decision":"continue","reason":"New evidence","next_approach":"Change the add function"}'
        model = Mock(side_effect=respond)
        for _ in range(2):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())
        with self.assertRaises(task_state.CandidateChanged):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())

    def test_invalid_loop_review_or_timeout_stops_and_stale_continue_is_rejected(self):
        for response in ('{}', 'not JSON', '{"decision":"continue","reason":"try again"}'):
            loop = repair_guard.RepairLoop()
            model = Mock(return_value=('m', response))
            for _ in range(2):
                loop.before_repair(model, 'key', SOURCES, self.confirmed())
            with self.assertRaises(repair_guard.RepairReviewRequired):
                loop.before_repair(model, 'key', SOURCES, self.confirmed())
        loop = repair_guard.RepairLoop()
        model = Mock(side_effect=TimeoutError('verifier unavailable'))
        for _ in range(2):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())
        with self.assertRaises(repair_guard.RepairReviewRequired):
            loop.before_repair(model, 'key', SOURCES, self.confirmed())

    def test_invented_finding_gets_a_fresh_review_without_any_coding(self):
        developer.UNFINISHED.clear()
        initial = ([dict(text='Accept numeric strings', met=True, evidence={'path': 'app.py', 'quote': 'int(a)'})],
                   ['app.py: add is undefined'], [])
        final = (initial[0], [], [])
        sources = {'app.py': 'def add(a,b): return int(a) + int(b)'}
        progress = SimpleNamespace(now=lambda *a, **k: None, ok=lambda *a, **k: None)
        def model(key, prompt, **kw):
            return finding_response(prompt, verdict='rejected', quote='def add')
        with patch.object(verify, 'model_review', side_effect=[initial, final]), \
                patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(developer, 'run_model', side_effect=model), patch.object(developer, 'generate') as generate:
            changes, verdict, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token',
                {'app.py': 'def add(a,b): return a+b'}, {'app.py': 50}, sources, '', None, '', False, progress)
        generate.assert_not_called()
        self.assertEqual(problems, [])
        self.assertEqual(changes, sources)

    def test_unverified_finding_never_enters_the_coding_prompt(self):
        developer.UNFINISHED.clear()
        review = ([dict(text='Accept numeric strings', met=False)], ['app.py: invented bug'], [])
        progress = SimpleNamespace(now=lambda *a, **k: None, ok=lambda *a, **k: None)
        with patch.object(verify, 'model_review', return_value=review), \
                patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(developer, 'run_model', side_effect=lambda key, prompt, **kw: finding_response(prompt, quote='not source')), \
                patch.object(developer, 'generate') as generate:
            _, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token', SOURCES,
                {'app.py': 50}, {'app.py': SOURCES['app.py'] + '\n'}, '', None, '', False, progress)
        generate.assert_not_called()
        self.assertTrue(any('need validation' in problem for problem in problems))

    def test_only_confirmed_targets_are_sent_to_the_coder_when_findings_are_mixed(self):
        developer.UNFINISHED.clear()
        proposed = {'app.py': 'def add(a,b): return a + b'}
        fixed = {'app.py': 'def add(a,b): return int(a) + int(b)'}
        primary = ([dict(text='Accept numeric strings', met=False)], ['Add an unrelated README feature'], [])
        final = ([dict(text='Accept numeric strings', met=True)], [], [])
        progress = SimpleNamespace(now=lambda *a, **k: None, ok=lambda *a, **k: None)
        def respond(key, prompt, **kw):
            model, output = finding_response(prompt)
            data = json.loads(output)
            for row in data['findings']:
                if row['id'] == repair_guard.digest('Add an unrelated README feature'):
                    row['verdict'] = 'needs_validation'
            return model, json.dumps(data)
        with patch.object(verify, 'model_review', side_effect=[primary, final]), \
                patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(developer, 'run_model', side_effect=respond), \
                patch.object(repair_guard.RepairLoop, 'before_repair', return_value='Use a unique current-source anchor'), \
                patch.object(developer, 'generate', return_value=('m', 'Convert add inputs', fixed, '')) as coder:
            result, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token', SOURCES,
                {'app.py': 50}, proposed, '', None, '', False, progress)
        self.assertEqual(result, fixed)
        self.assertEqual(problems, [])
        self.assertIn('Requirement not met: Accept numeric strings', coder.call_args.args[1])
        self.assertNotIn('unrelated README', coder.call_args.args[1])
        self.assertIn('Use a unique current-source anchor', coder.call_args.args[1])

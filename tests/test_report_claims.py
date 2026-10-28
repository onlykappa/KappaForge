"""Reporting constraints use observed executions, never model-provided proof exemptions."""
import copy
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from types import SimpleNamespace
import unittest
from engine import developer, intent_guard, operational_review, recovery, report_claims, task_goal, task_state, verify

SHA = 'a' * 40
ROOT = 'onlykappa/KappaForge'
ASK = report_claims.ASK + '.'


def fixture(stack, body='No native tests were run.', validation=None):
    issue = dict(number=9, state='open', user={'login': 'onlykappa'},
        created_at=datetime.now(timezone.utc).isoformat(),
        body='Repository: ' + ROOT + '\nMode: develop\n\n' + ASK)
    active, scope = intent_guard.ExecutionScope(issue), intent_guard.ExecutionScope(issue)
    goal = task_goal.from_request(ASK)
    journal = SimpleNamespace(scope=scope, state=dict(repo=ROOT, task=9, candidate=SHA, digest=scope.digest,
        authorization=scope.identity, requirements=[ASK], budgets=dict(modelCalls=7, edits=2, fixCycles=1),
        pr='https://github.com/' + ROOT + '/pull/310'), project={}, persist=lambda: None)
    for var, value in ((intent_guard.ACTIVE, active), (task_goal.CURRENT, goal), (recovery.CURRENT, journal)):
        handle = var.set(value); stack.callback(var.reset, handle)
    task_state.bind(ROOT, 9, 'kappa/dev-9', SHA, journal)
    pr = dict(number=310, state='open', draft=True, html_url=journal.state['pr'], body=body,
              head=dict(ref='kappa/dev-9', sha=SHA, repo=dict(full_name=ROOT)))
    active.own_prs.add(310)
    task_state.observe_pr(pr, ROOT, 'kappa/dev-9')
    if validation:
        task_state.observe_validation('sandbox', SHA, validation)
    return issue, active, goal, journal, pr


def sandbox_run(**changes):
    row = dict(id=42, path='.github/workflows/sandbox-tests.yml', repository=dict(full_name=ROOT),
        event='workflow_dispatch', head_branch='main', status='completed', conclusion='success',
        display_title=developer.test_workflow(ROOT, 'kappa/dev-9', SHA)[1])
    row.update(changes)
    return row


class ReportClaimsTests(unittest.TestCase):
    def test_real_review_resolves_owned_reporting_constraint_from_current_report_and_run(self):
        with ExitStack() as stack:
            _, _, _, journal, _ = fixture(stack, 'Sandbox validation passed.\nNo native tests were run.', sandbox_run())
            before = copy.deepcopy(journal.state['budgets'])
            calls = []
            def model(*args, **kwargs):
                calls.append(1)
                return 'scripted', json.dumps(dict(requirements=[dict(text=ASK, met=True, evidence=None)], problems=[]))
            result = verify.model_review(model, 'fixture', ASK, lambda p: '', {}, [])
            self.assertIsNotNone(result, verify.REVIEW_FAILURE.get())
            self.assertTrue(result[0][0]['met'])
            self.assertEqual(result[0][0]['kind'], 'controller')
            self.assertEqual(len(calls), 1)
            self.assertEqual(journal.state['budgets'], before)

    def test_request_guard_rejects_unperformed_native_claim_before_transport(self):
        with ExitStack() as stack:
            issue, _, _, _, _ = fixture(stack)
            for text in ('Native tests passed.', 'Native passed.', 'Native: passed.'):
                with self.subTest(text=text), self.assertRaisesRegex(PermissionError, 'Unverified validation claim: native'):
                    intent_guard.guard_request('https://api.github.com/repos/' + ROOT + '/issues/9/comments',
                        {'body': text}, 'POST', lambda _: issue)

    def test_claims_require_successful_exact_candidate_trusted_workflow(self):
        for changes in ({'conclusion': 'failure'}, {'status': 'in_progress'}, {'event': 'push'},
                        {'head_branch': 'untrusted'}, {'path': '.github/workflows/fake.yml'},
                        {'repository': {'full_name': 'foreign/repo'}}, {'display_title': 'another candidate'}, {'id': 0}):
            with self.subTest(changes=changes), ExitStack() as stack:
                issue, active, _, _, _ = fixture(stack, 'Sandbox validation passed.', sandbox_run(**changes))
                with self.assertRaises(PermissionError):
                    intent_guard.guard_request('https://api.github.com/repos/' + ROOT + '/issues/9/comments',
                        {'body': 'Sandbox validation passed.'}, 'POST', lambda _: issue)
                self.assertIsNone(report_claims.controller_proof())

    def test_owner_wording_and_explicit_not_run_are_not_assertions(self):
        with ExitStack() as stack:
            issue, active, _, _, _ = fixture(stack)
            for text in (ASK, 'No native tests were run.', 'Live tests were not performed.', 'Native validation not needed.', 'Live progress completed.', 'Native code completed.'):
                report_claims.guard(active, {'body': text})

    def test_foreign_or_compound_constraint_does_not_create_a_proof_exemption(self):
        self.assertIsNone(operational_review.kind(ASK + ' Remove authorization checks.'))
        with ExitStack() as stack:
            _, _, _, journal, _ = fixture(stack)
            journal.state['candidate'] = 'b' * 40
            self.assertIsNone(report_claims.controller_proof())

    def test_untrusted_model_receipt_cannot_approve_an_unsupported_current_report(self):
        with ExitStack() as stack:
            fixture(stack, 'Native tests passed.')
            row = dict(text=ASK, met=True, kind='controller', evidence={'controller_receipt': {'native': 'passed'}})
            verify.resolve_controller([row])
            self.assertFalse(row['met'])

    def test_successful_native_run_is_required_for_native_success_claim(self):
        from engine import native_build
        with ExitStack() as stack:
            issue, active, _, _, _ = fixture(stack, 'Native tests passed.')
            run = sandbox_run(path='.github/workflows/ios-build.yml', display_title=native_build.title('kappa/dev-9', SHA))
            task_state.observe_validation('native', SHA, run)
            intent_guard.guard_request('https://api.github.com/repos/' + ROOT + '/issues/9/comments',
                                       {'body': 'Native tests passed.'}, 'POST', lambda _: issue)
            self.assertIsNotNone(report_claims.controller_proof())
            task_state.bind(ROOT, 9, 'kappa/dev-9', 'b' * 40, recovery.CURRENT.get())
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Native tests passed.'})

    def test_precommit_execution_proof_counts_and_publication_bind_exact_patch(self):
        from engine import execution, sandbox
        with ExitStack() as stack:
            _, active, _, journal, _ = fixture(stack)
            changes = {'app.py': 'value = 2\n'}
            journal.state['executionCheckpoint'] = {'hash': 'actual-checkpoint'}
            data = dict(identity=dict(repo=ROOT, base=SHA, task=9, scope=active.digest),
                        controller=dict(status='success', stop_reason='validated', test_results=[{'status': 'passed'}]),
                        patchRef=dict(hash=execution.digest(changes)))
            result = sandbox.RunResult(['python', '-m', 'unittest'], 'test', 'passed', exit_code=0,
                source='test', stdout='Ran 2 tests in 0.001s\n\nOK\n')
            session = SimpleNamespace(results=[result])
            report_claims.observe_precommit(journal, data, session)
            report_claims.guard(active, {'body': 'Sandbox validation passed.'})
            _, record = task_state.current()
            report_claims.published(SHA, 'b' * 40, {'app.py': 'different unvalidated patch'})
            self.assertEqual(record.control['claim_precommit']['candidate'], SHA)
            report_claims.published(SHA, 'b' * 40, changes)
            journal.state['candidate'] = 'b' * 40
            task_state.bind(ROOT, 9, 'kappa/dev-9', 'b' * 40, journal)
            report_claims.guard(active, {'body': 'Sandbox validation passed.'})
            journal.state['executionCheckpoint'] = {'hash': 'another-checkpoint'}
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Sandbox validation passed.'})

    def test_all_skipped_or_missing_precommit_results_never_prove_execution(self):
        from engine import execution, sandbox
        for rows, output in (([], ''), ([{'status': 'passed'}], 'Ran 2 tests in 0.001s\nOK (skipped=2)\n')):
            with self.subTest(rows=rows), ExitStack() as stack:
                _, active, _, journal, _ = fixture(stack)
                journal.state['executionCheckpoint'] = {'hash': 'actual-checkpoint'}
                data = dict(identity=dict(repo=ROOT, base=SHA, task=9, scope=active.digest),
                    controller=dict(status='success', stop_reason='validated', test_results=rows),
                    patchRef=dict(hash=execution.digest({'app.py': 'value = 2\n'})))
                session = SimpleNamespace(results=[sandbox.RunResult(['test'], 'test', 'passed', stdout=output)])
                report_claims.observe_precommit(journal, data, session)
                with self.assertRaises(PermissionError):
                    report_claims.guard(active, {'body': 'Sandbox validation passed.'})

    def test_http_client_refuses_claim_after_owner_recheck_before_mutation(self):
        import io
        from unittest.mock import patch
        from engine import runner
        with ExitStack() as stack:
            issue, _, _, _, _ = fixture(stack)
            methods = []
            def response(request):
                methods.append(request.get_method())
                self.assertEqual(request.get_method(), 'GET')
                return io.BytesIO(json.dumps(issue).encode())
            with patch.object(runner, 'github_response', side_effect=response):
                with self.assertRaisesRegex(PermissionError, 'Unverified validation claim: native'):
                    runner.request('https://api.github.com/repos/' + ROOT + '/issues/9/comments',
                                   {'body': 'Native tests passed.'}, 'fixture')
            self.assertEqual(methods, ['GET'], 'owner issue read happens; claim never reaches a mutation')

    def test_title_claim_and_expired_authority_cannot_bypass_report_checks(self):
        import time
        with ExitStack() as stack:
            issue, active, _, _, _ = fixture(stack, 'Sandbox validation passed.', sandbox_run())
            with self.assertRaises(PermissionError):
                intent_guard.guard_request('https://api.github.com/repos/' + ROOT + '/pulls/310',
                    {'title': 'Native tests passed'}, 'PATCH', lambda _: issue)
            active.expires = time.time() - 1
            self.assertIsNone(report_claims.controller_proof())
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Sandbox validation passed.'})

    def test_failed_workflow_supports_failure_report_but_not_success_or_execution_claim(self):
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack, validation=sandbox_run(conclusion='failure'))
            report_claims.guard(active, {'body': 'Sandbox workflow failed.'})
            report_claims.guard(active, {'body': 'Sandbox tests failed.'})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Sandbox tests executed and passed.'})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Sandbox tests ran and failed.'})

    def test_real_controller_registers_evidence_before_publishing_passed_progress(self):
        from engine import sandbox_repair_controller
        from tests.test_execution_recovery import session, fixed, CONTEXT, TASK
        from tests.test_recovery_journal import GitHub
        with ExitStack() as stack:
            world = GitHub()
            world.issue['body'] += '\n' + ASK
            journal = world.journal()
            goal = task_goal.from_request(task_goal.owner_request(world.issue))
            for var, value in ((intent_guard.ACTIVE, journal.scope), (task_goal.CURRENT, goal), (recovery.CURRENT, journal)):
                handle = var.set(value); stack.callback(var.reset, handle)
            journal.checkpoint(SHA, base='main')
            task_state.bind(ROOT, 130, 'kappa/dev-130', SHA, journal)
            from unittest.mock import patch
            previous = developer.Progress.latest
            stack.callback(setattr, developer.Progress, 'latest', previous)
            progress = developer.Progress(130, 'fixture')
            original_update = progress.execution_update
            observed = []
            def update(info):
                if info.get('finalValidation') == 'passed':
                    report_claims.guard(journal.scope, {'body': 'Sandbox validation passed.'})
                    observed.append(True)
                return original_update(info)
            def github(path, token, payload=None, method=None):
                return world.read(path) if payload is None else world.write(path, payload, method or 'POST')
            stack.enter_context(patch.object(developer, 'gh', side_effect=github))
            stack.enter_context(patch.object(progress, 'execution_update', side_effect=update))
            controller = sandbox_repair_controller.SandboxRepairController(session(), journal, CONTEXT, progress)
            result = controller.run_repair(goal.request, fixed, 'fixture', {'app.py': 'value=2\n'})
            self.assertEqual(result['status'], 'success', result)
            self.assertTrue(observed)
            self.assertTrue(task_state.current()[1].control.get('claim_precommit'))

    def test_typed_state_logs_are_not_validation_claims_but_result_markers_stay_checked(self):
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack)
            state = '<!-- KAPPA_RECOVERY_V1 ' + json.dumps({'docker': 'image', 'install': 'passed'}) + ' -->'
            report_claims.guard(active, {'body': '### KappaForge recovery checkpoint\nStatus: running\n' + state})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Untrusted report\nDocker tests passed.\n' + state})
            marker = '<!-- KAPPA_VALIDATION_V1 ' + json.dumps({'kind': 'native', 'conclusion': 'success'}) + ' -->'
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': '### KappaForge is working on it\n' + marker})

    def test_native_simulator_success_never_proves_physical_device_testing(self):
        from engine import native_build
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack)
            task_state.observe_validation('native', SHA,
                sandbox_run(path='.github/workflows/ios-build.yml', display_title=native_build.title('kappa/dev-9', SHA)))
            with self.assertRaisesRegex(PermissionError, 'Unverified validation claim: device'):
                report_claims.guard(active, {'body': 'Tests passed on a real iPhone.'})

    def test_fresh_invalid_pr_observation_retires_previous_report_proof(self):
        for changes in ({'state': 'closed'}, {'body': 42}, {'head': {}}):
            with self.subTest(changes=changes), ExitStack() as stack:
                _, _, _, _, pr = fixture(stack)
                self.assertIsNotNone(report_claims.controller_proof())
                task_state.observe_pr(dict(pr, **changes), ROOT, 'kappa/dev-9')
                self.assertIsNone(report_claims.controller_proof())

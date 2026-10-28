"""Independent regressions for the owner-supplied reviews of PRs 309 and 311."""
import ast
from contextlib import ExitStack
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

from engine import developer, execution, report_claims, runtime_engine, task_state, verify, requirements
from tests.test_report_claims import fixture, sandbox_run, ROOT, SHA
from tests import test_runtime_engine as runtime_fixture
from tests import test_execution_recovery as recovery_fixture


class ReviewFollowupTests(unittest.TestCase):
    def setUp(self):
        from engine import task_goal, recovery, intent_guard
        previous = developer.Progress.latest
        developer.Progress.latest = None
        self.addCleanup(setattr, developer.Progress, 'latest', previous)
        for var in (requirements.CURRENT, task_goal.CURRENT, recovery.CURRENT, intent_guard.ACTIVE):
            token = var.set(None)
            self.addCleanup(var.reset, token)

    def test_execution_recovery_definitions_are_unique(self):
        tree = ast.parse(Path('tests/test_execution_recovery.py').read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                names = [n.name for n in node.body if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')]
                self.assertEqual(len(names), len(set(names)), node.name)

    def test_negative_execution_phrasings_do_not_assert_success(self):
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack)
            for text in ['Docker tests could not be executed.', 'Native tests were not actually run.',
                         'Docker tests have not been run.', 'Sandbox tests were never executed.',
                         'Live tests cannot be performed.', 'Docker tests were not able to run.',
                         'Native tests could not run.', 'Docker tests have not yet been executed.',
                         'No Docker tests were executed.', 'No native tests were performed.',
                         'No live tests passed.', 'Docker tests failed to execute.']:
                with self.subTest(text=text):
                    report_claims.guard(active, {'body': text})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Docker tests could not be executed; native tests passed.'})

    def test_failed_sandbox_category_report_is_allowed_only_with_failure_receipt(self):
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack, validation=sandbox_run(conclusion='failure'))
            report_claims.guard(active, {'body': 'Sandbox tests failed.'})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Sandbox tests passed.'})

    def test_missing_progress_does_not_disable_review_on_process_resume(self):
        with patch.object(verify, 'model_review', return_value=([{'text': 'Check', 'met': False}], [], [])), \
             patch.object(verify, 'wiring_problems', return_value=[]), \
             patch('engine.commit_provenance.problems', return_value=[]):
            result = developer.check_the_work('key', 'Check', ROOT, SHA, 'token', {}, {}, {}, '', [], '', False,
                                             None, review_only=True)
        self.assertTrue(result[2], 'missing progress never fabricates completion')

    def test_inventory_routing_preserves_workflow_and_configuration_priority(self):
        paths = ['a/' + 'x' * 60 + str(i) for i in range(100)] + ['.github/workflows/agent.yml', 'config/projects.json']
        shown = verify.review_inventory(paths, 'Inspect repository inventory')
        self.assertIn('config/projects.json', shown)
        self.assertIn('.github/workflows/agent.yml', shown)
        self.assertGreater(len(shown), 2000, 'inventory tasks retain the larger routing budget')

    def test_automatic_trial_cannot_adopt_an_unapproved_new_engine_head(self):
        case = runtime_fixture.RuntimeEngineTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.addCleanup(case.tearDown)
        read, env, _, _ = case.trial()
        with self.assertRaises(PermissionError):
            runtime_engine.attest(case.journal.scope, read, None, dict(env, INPUT_ACTION=''), 'b' * 40)
        prior = runtime_engine.attest(case.journal.scope, read, None, env, 'b' * 40)
        receipt = runtime_engine.attest(case.journal.scope, read, prior, dict(env, INPUT_ACTION=''), 'b' * 40)
        self.assertEqual(receipt, prior)

    def test_explicit_fix_retries_same_tool_once_without_replenishing_action_budget(self):
        import os
        case = recovery_fixture.ExecutionRecoveryTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.addCleanup(case.tearDown)
        stale = lambda *a, **kw: ('scripted', json.dumps(dict(tool='apply_patch', reason='stale',
            args=dict(edits=[dict(path='app.py', find='missing', replace='value=2')]))))
        stopped = case.controller().run_repair(recovery_fixture.TASK, stale, 'fixture', {'app.py': 'value=0\n'})
        self.assertEqual(stopped['stop_reason'], 'repeated_tool_call')
        before = execution.pending(case.reload())['controller']['actions']
        calls = []
        def model(*a, **kw):
            calls.append(1)
            return stale(*a, **kw) if len(calls) == 1 else recovery_fixture.fixed(*a, **kw)
        with patch.dict(os.environ, {'INPUT_ACTION': 'fix'}):
            repaired = case.controller(journal=case.reload()).run_repair(recovery_fixture.TASK, model, 'fixture')
        self.assertEqual(repaired['status'], 'success', repaired)
        self.assertEqual(execution.pending(case.reload())['controller']['actions'], before + 2)

    def test_classification_can_reload_without_a_progress_publisher(self):
        row = SimpleNamespace(categories=('code',), source='rules')
        with patch.object(requirements, 'load', return_value=[row]):
            self.assertEqual(developer.classify_task(None, None, ROOT, 'Check'), [row])

    def test_exploratory_exit_one_does_not_replace_the_test_failure(self):
        from engine import sandbox
        class SearchDocker(recovery_fixture.FakeDocker):
            def call(self, args, **kw):
                if 'grep' in args:
                    return sandbox.Exec(1, '', '')
                return super().call(args, **kw)
        case = recovery_fixture.ExecutionRecoveryTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.addCleanup(case.tearDown)
        calls = []
        def model(key, prompt, **kw):
            calls.append(1)
            if len(calls) == 1:
                return 'fixture', json.dumps(dict(tool='run_command', args=dict(argv=['grep', 'unmatched', 'app.py']), reason='Search'))
            self.assertIn('same assertion', prompt, 'retain the failing regression, not grep output')
            return recovery_fixture.fixed(key, prompt, **kw)
        result = case.controller(work=recovery_fixture.session(docker=SearchDocker())).run_repair(
            recovery_fixture.TASK, model, 'fixture', {'app.py': 'value=0\n'})
        self.assertEqual(result['status'], 'success', result)

    def test_reference_encoding_is_reused_during_same_snapshot_prompt_rebuilds(self):
        from engine import gateway, task_goal
        task = 'Preserve the existing sandbox behavior and the owner requirement evidence across every retry.'
        text = 'Earlier wording: ' + task + ' Evidence pending.'
        calls = []
        def model(*a, **kw):
            calls.append(1)
            return 'fixture', json.dumps(dict(requirements=[dict(text=text, met=False)], problems=[],
                files_to_inspect=['b.py'] if len(calls) == 1 else []))
        def transport(run_model, key, build, **kw):
            build(); build()
            return run_model(key, build())
        handle = task_goal.CURRENT.set(None)
        try:
            with patch.object(gateway.ReviewResources, 'call', side_effect=transport), \
                 patch.object(verify, 'requirement_references', wraps=verify.requirement_references) as encoding:
                result = verify.model_review(model, 'fixture', task, lambda p: 'value=1\n', {'a.py': 'value=2\n'}, ['a.py','b.py'])
            self.assertIsNotNone(result, verify.REVIEW_FAILURE.get())
            self.assertEqual(len(calls), 2)
            self.assertEqual(encoding.call_count, 1)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_publication_proof_accepts_only_a_delta_producing_the_tested_tree(self):
        from engine import sandbox
        for published, accepted in [({'app.py': 'value=2\n'}, True), ({}, False), ({'app.py': 'bad'}, False)]:
            with self.subTest(published=published), ExitStack() as stack:
                _, active, _, journal, _ = fixture(stack)
                work = recovery_fixture.session(sha=SHA)
                work.apply({'app.py': 'value=2\n', 'same.py': 'unchanged\n'})
                work.base.files['same.py'] = b'unchanged\n'
                work.results = [sandbox.RunResult(['test'], 'test', 'passed', stdout='Ran 1 test in 0.001s\nOK\n')]
                journal.state['executionCheckpoint'] = {'hash': 'tested-checkpoint'}
                data = dict(identity=dict(repo=ROOT, base=SHA, task=9, scope=active.digest),
                    controller=dict(status='success', stop_reason='validated', test_results=[{'status':'passed'}]),
                    patchRef=dict(hash=execution.digest(execution.patch(work))))
                run = work.results[0]
                data['commands'] = [dict(status=run.status, result=run.to_dict(), key=execution.digest(dict(
                    revision=execution.revision(work), phase='final', argv=run.argv, profile=run.profile, source=run.source)))]
                report_claims.observe_precommit(journal, data, work)
                report_claims.published(SHA, 'b' * 40, published)
                journal.state['candidate'] = 'b' * 40
                task_state.bind(ROOT, 9, 'kappa/dev-9', 'b' * 40, journal)
                if accepted:
                    report_claims.guard(active, {'body':'Docker tests passed.'})
                else:
                    with self.assertRaises(PermissionError):
                        report_claims.guard(active, {'body':'Docker tests passed.'})

    def test_fix_publishes_validated_deletions_instead_of_dropping_none_values(self):
        from tests import test_developer as dev_fixture
        from engine import native_build
        case = dev_fixture.OwnerRequestedFixTests()
        _, github = case.fake()
        changes = {'obsolete.py': None}
        validation = dict(status='success', stop_reason='validated', summary='validated deletion',
                          candidate_changes=changes, attempts=[], test_results=[{'status':'passed'}])
        with patch.object(developer, 'gh', side_effect=github), patch.object(native_build, 'gh', side_effect=github), \
             patch.object(developer, 'job_log', return_value='FAIL obsolete module'), \
             patch.object(developer, 'revise_branch', return_value=('fixture','Remove obsolete',changes,'Verified removal',{})), \
             patch.object(developer, 'run_sandbox_repair', return_value=validation), \
             patch.object(developer, 'publish_candidate', return_value={'sha':'e'*40}) as publish, \
             patch('engine.commit_provenance.require_valid'):
            developer.fix_pull_request(case.ISSUE, 'fixture', 'fixture')
        self.assertEqual(publish.call_count, 1)
        self.assertEqual(publish.call_args.args[2], changes)

    def test_recovery_test_fixture_restores_its_journal_after_cleanup(self):
        from engine import recovery
        previous = recovery.CURRENT.get()
        case = recovery_fixture.ExecutionRecoveryTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        recovery.CURRENT.set(case.journal)
        case.doCleanups()
        self.assertIs(recovery.CURRENT.get(), previous)

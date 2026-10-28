"""Real controller failures must be reportable without claiming that validation passed."""
from contextlib import ExitStack
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from engine import developer, intent_guard, recovery, report_claims, sandbox_repair_controller, task_goal, task_state
from tests.test_execution_recovery import session, CONTEXT, FakeDocker
from tests.test_recovery_journal import GitHub


class LocalFailureReportTests(unittest.TestCase):
    def setUp(self):
        for var in (intent_guard.ACTIVE, recovery.CURRENT, task_goal.CURRENT):
            token = var.set(None)
            self.addCleanup(var.reset, token)

    def bind(self, stack):
        world = GitHub()
        world.issue['body'] += '\n' + report_claims.ASK + '.'
        journal = world.journal()
        goal = task_goal.from_request(task_goal.owner_request(world.issue))
        for var, value in ((intent_guard.ACTIVE, journal.scope), (task_goal.CURRENT, goal), (recovery.CURRENT, journal)):
            token = var.set(value); stack.callback(var.reset, token)
        journal.checkpoint('a' * 40, base='main')
        task_state.bind(recovery.ROOT, 130, 'kappa/dev-130', 'a' * 40, journal)
        stack.enter_context(patch.object(developer, 'gh', side_effect=lambda p,t,payload=None,method=None:
            world.read(p) if payload is None else world.write(p,payload,method or 'POST')))
        return journal, goal

    def test_real_failed_suite_is_reportable_without_success_or_native_claims(self):
        with ExitStack() as stack:
            journal, goal = self.bind(stack)
            work = session(docker=FakeDocker(always_fail=True))
            model = lambda *a, **kw: ('fixture', json.dumps({'done': 'No speculative edit'}))
            result = sandbox_repair_controller.SandboxRepairController(work, journal, CONTEXT).run_repair(
                goal.request, model, 'fixture', {'app.py': 'value=0\n'})
            self.assertEqual(result['status'], 'failed')
            self.assertTrue(any(r.status == 'failed' for r in work.results))
            report_claims.guard(journal.scope, {'body': 'Sandbox tests failed.'})
            for text in ('Docker tests passed.', 'Native tests failed.'):
                with self.subTest(text=text), self.assertRaises(PermissionError):
                    report_claims.guard(journal.scope, {'body': text})

    def test_changed_untested_patch_cannot_reuse_failure_receipt(self):
        with ExitStack() as stack:
            journal, goal = self.bind(stack)
            work = session(docker=FakeDocker(always_fail=True))
            model = lambda *a, **kw: ('fixture', json.dumps({'done': 'No speculative edit'}))
            sandbox_repair_controller.SandboxRepairController(work, journal, CONTEXT).run_repair(
                goal.request, model, 'fixture', {'app.py': 'value=0\n'})
            work.apply({'app.py': 'value=3\n'})
            with self.assertRaises(PermissionError):
                report_claims.guard(journal.scope, {'body': 'Sandbox tests failed.'})

    def test_zero_discovered_tests_do_not_prove_failed_test_execution(self):
        with ExitStack() as stack:
            journal, goal = self.bind(stack)
            work = session(docker=FakeDocker(zero_tests=True))
            result = sandbox_repair_controller.SandboxRepairController(work, journal, CONTEXT).run_repair(
                goal.request, lambda *a, **kw: ('fixture', '{}'), 'fixture', {'app.py': 'value=0\n'})
            self.assertEqual(result['stop_reason'], 'no_tests_discovered')
            with self.assertRaises(PermissionError):
                report_claims.guard(journal.scope, {'body': 'Sandbox tests failed.'})

    def test_success_receipt_does_not_follow_an_untested_patch_change(self):
        with ExitStack() as stack:
            journal, goal = self.bind(stack)
            work = session()
            result = sandbox_repair_controller.SandboxRepairController(work, journal, CONTEXT).run_repair(
                goal.request, lambda *a, **kw: ('fixture', '{}'), 'fixture', {'app.py': 'value=2\n'})
            self.assertEqual(result['status'], 'success')
            report_claims.guard(journal.scope, {'body': 'Docker tests passed.'})
            work.apply({'app.py': 'value=3\n'})
            with self.assertRaises(PermissionError):
                report_claims.guard(journal.scope, {'body': 'Docker tests passed.'})

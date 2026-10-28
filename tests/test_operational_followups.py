"""Operational evidence must not turn into a request to modify unrelated code."""
from contextlib import ExitStack
import unittest
from engine import report_claims, requirements
from tests.test_report_claims import fixture, sandbox_run


class OperationalFollowupsTests(unittest.TestCase):
    def test_docker_success_does_not_assert_native_success_in_another_sentence(self):
        with ExitStack() as stack:
            _, active, _, _, _ = fixture(stack, validation=sandbox_run())
            report_claims.guard(active, {'body': 'Docker validation passed. Native tests were not run.'})
            with self.assertRaises(PermissionError):
                report_claims.guard(active, {'body': 'Docker validation passed. Native tests passed.'})

    def test_verified_fix_word_does_not_make_foreign_branch_hold_a_code_requirement(self):
        text='Leave its branch untouched so the verified fix can be folded into #279 after independent review.'
        row=requirements.classify(text)[0]
        self.assertFalse(row.behavioral)
        self.assertNotIn('testing',row.categories)
        self.assertIn('housekeeping',row.categories)

    def bind_hold(self, stack):
        from engine import intent_guard, recovery, task_goal, task_state
        from tests.test_recovery_journal import GitHub
        world=GitHub();world.issue['body']+='\n'+HOLD
        journal=world.journal();goal=task_goal.from_request(task_goal.owner_request(world.issue))
        for var,value in ((intent_guard.ACTIVE,journal.scope),(recovery.CURRENT,journal),(task_goal.CURRENT,goal)):
            token=var.set(value);stack.callback(var.reset,token)
        journal.checkpoint('a'*40,base='main')
        task_state.bind(recovery.ROOT,130,'kappa/dev-130','a'*40,journal)
        return journal

    def test_branch_hold_uses_actual_target_metadata_and_active_denial(self):
        from engine import operational_review, verify
        with ExitStack() as stack:
            journal=self.bind_hold(stack)
            calls=[]
            def read(path):calls.append(path);return protected_pr()
            operational_review.observe_branch_holds(read)
            row={'text':HOLD,'met':True}
            verify.resolve_controller([row])
            self.assertTrue(row['met']);self.assertEqual(row['kind'],'controller')
            self.assertEqual(calls,['repos/onlykappa/KappaForge/pulls/279'])
            with self.assertRaises(PermissionError):
                journal.scope.permit('https://api.github.com/repos/onlykappa/KappaForge/git/refs/heads/claude/phase3',{'sha':'a'*40,'force':False},'PATCH')

    def test_missing_foreign_same_branch_and_model_receipts_cannot_approve_hold(self):
        from engine import operational_review, verify
        for change in (None, {'head':None}, {'number':280}, {'head':{'ref':'kappa/dev-130','sha':'f'*40,'repo':{'full_name':'onlykappa/KappaForge'}}},
                       {'head':{'ref':'claude/phase3','sha':'f'*40,'repo':{'full_name':'other/repo'}}}):
            with self.subTest(change=change),ExitStack() as stack:
                self.bind_hold(stack)
                row={'text':HOLD,'met':True,'evidence':{'controller_receipt':'model says untouched'}}
                if change is not None:
                    operational_review.observe_branch_holds(lambda _:dict(protected_pr(),**change))
                verify.resolve_controller([row]);self.assertFalse(row['met'])

    def test_compound_code_ask_is_not_a_branch_hold_exemption(self):
        from engine import operational_review
        self.assertIsNone(operational_review.kind(HOLD+' Remove authentication checks.'))

    def test_branch_hold_is_not_approved_when_guard_allows_target_or_scope_expires(self):
        from engine import operational_review, verify
        from unittest.mock import patch
        for expired in (False,True):
            with self.subTest(expired=expired),ExitStack() as stack:
                journal=self.bind_hold(stack)
                operational_review.observe_branch_holds(lambda _:protected_pr())
                if expired:journal.scope.expires=0
                else:stack.enter_context(patch.object(journal.scope,'permit',return_value=None))
                row={'text':HOLD,'met':True}
                verify.resolve_controller([row]);self.assertFalse(row['met'])


HOLD='Leave its branch untouched so the verified fix can be folded into #279 after independent review.'
def protected_pr():
    return {'number':279,'head':{'ref':'claude/phase3','sha':'f'*40,'repo':{'full_name':'onlykappa/KappaForge'}}}

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

    def bind_hold(self, stack, extra=''):
        from engine import intent_guard, recovery, task_goal, task_state
        from tests.test_recovery_journal import GitHub
        world=GitHub();world.issue['body']+='\n'+HOLD+('\n'+extra if extra else '')
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

    def test_file_restriction_is_operational_not_an_implementation_test(self):
        row=requirements.classify(FILE_SCOPE)[0]
        self.assertFalse(row.behavioral)
        self.assertNotIn('testing',row.categories)

    def test_owned_file_scope_uses_fresh_complete_candidate_paths(self):
        from engine import operational_review,task_goal,verify
        with ExitStack() as stack:
            self.bind_hold(stack,FILE_SCOPE)
            task_goal.CURRENT.get().receipt={'url':'https://github.com/onlykappa/KappaForge/pull/133'}
            pr=dict(number=133,state='open',changed_files=2,base=dict(sha='c'*40,ref='main'),head=dict(sha='a'*40,ref='kappa/dev-130',repo=dict(full_name='onlykappa/KappaForge')))
            files=[dict(filename=p,status='modified') for p in FILES]
            operational_review.observe_file_scope(lambda path:files if '/files?' in path else pr)
            row=dict(text=FILE_SCOPE,met=False);verify.resolve_controller([row])
            self.assertTrue(row['met']);self.assertEqual(row['kind'],'controller')

    def test_file_scope_refuses_missing_stale_renamed_or_incomplete_metadata(self):
        from engine import operational_review,task_goal,verify
        cases=[('missing',None),('wrong-sha','b'*40),('wrong-count',3),('rename','outside.py'),('outside','other.py')]
        for case,value in cases:
            with self.subTest(case=case),ExitStack() as stack:
                self.bind_hold(stack,FILE_SCOPE)
                task_goal.CURRENT.get().receipt={'url':'https://github.com/onlykappa/KappaForge/pull/133'}
                pr=dict(number=133,state='open',changed_files=2,base=dict(sha='c'*40,ref='main'),head=dict(sha='a'*40,ref='kappa/dev-130',repo=dict(full_name='onlykappa/KappaForge')))
                files=[dict(filename=p,status='modified') for p in FILES]
                if case=='wrong-sha':pr['head']['sha']=value
                if case=='wrong-count':pr['changed_files']=value
                if case=='rename':files[0].update(status='renamed',previous_filename=value)
                if case=='outside':files[0]['filename']=value
                if case!='missing':operational_review.observe_file_scope(lambda path:files if '/files?' in path else pr)
                row=dict(text=FILE_SCOPE,met=True,evidence={'model':'only these files'});verify.resolve_controller([row])
                self.assertFalse(row['met'])

    def test_file_scope_does_not_exempt_compound_work_and_checks_proposals(self):
        from engine import operational_review,task_goal,verify
        self.assertIsNone(operational_review.kind(FILE_SCOPE+' Remove authentication.'))
        with ExitStack() as stack:
            self.bind_hold(stack,FILE_SCOPE)
            task_goal.CURRENT.get().receipt={'url':'https://github.com/onlykappa/KappaForge/pull/133'}
            pr=dict(number=133,state='open',changed_files=2,base=dict(sha='c'*40,ref='main'),head=dict(sha='a'*40,ref='kappa/dev-130',repo=dict(full_name='onlykappa/KappaForge')))
            operational_review.observe_file_scope(lambda path:[dict(filename=p,status='modified') for p in FILES] if '/files?' in path else pr)
            row=dict(text=FILE_SCOPE,met=True)
            operational_review.resolve([row],{'outside.py':'unrelated change'})
            self.assertFalse(row['met'])


    def test_fresh_unpublished_task_checks_actual_proposal_paths(self):
        import urllib.error
        from engine import operational_review
        with ExitStack() as stack:
            self.bind_hold(stack,FILE_SCOPE)
            def missing(path):
                raise urllib.error.HTTPError(path,404,'Not Found',None,None)
            operational_review.observe_file_scope(missing)
            row=dict(text=FILE_SCOPE,met=False)
            operational_review.resolve([row],{FILES[0]:'actual proposal'})
            self.assertTrue(row['met'])
            operational_review.resolve([row],{'outside.py':'unrelated'})
            self.assertFalse(row['met'])

    def test_unpublished_pr_uses_fresh_complete_origin_comparison_after_stage_publication(self):
        from engine import operational_review,task_state
        for outside in (False,True):
            with self.subTest(outside=outside),ExitStack() as stack:
                journal=self.bind_hold(stack,FILE_SCOPE)
                journal.checkpoint('c'*40);task_state.checkpoint('c'*40)
                operational_review.observe_origin('main','c'*40,True)
                journal.checkpoint('a'*40);task_state.checkpoint('a'*40)
                operational_review.published('c'*40,'a'*40)
                def read(path):
                    if '/git/ref/' in path:return {'object':{'sha':'a'*40}}
                    return dict(status='ahead',merge_base_commit={'sha':'c'*40},files=[dict(filename='outside.py' if outside else FILES[0],status='modified')])
                operational_review.observe_file_scope(read)
                row=dict(text=FILE_SCOPE,met=False);operational_review.resolve([row],{})
                self.assertEqual(row['met'],not outside)


    def test_file_scope_is_also_enforced_before_any_proposed_source_edit(self):
        from engine import task_goal
        goal=task_goal.from_request('Fix the publication guard. '+FILE_SCOPE)
        goal.validate_paths(FILES)
        with self.assertRaisesRegex(ValueError,'outside'):
            goal.validate_paths(('outside.py',))



HOLD='Leave its branch untouched so the verified fix can be folded into #279 after independent review.'
def protected_pr():
    return {'number':279,'head':{'ref':'claude/phase3','sha':'f'*40,'repo':{'full_name':'onlykappa/KappaForge'}}}

FILES=('engine/developer.py','tests/test_execution_recovery.py')
FILE_SCOPE='Keep this task to '+FILES[0]+' and '+FILES[1]+'.'

"""Old review diagnostics and labels cannot prevent a fresh, scoped verification."""
from contextlib import ExitStack
import copy
from dataclasses import replace
import json
import unittest
from unittest.mock import patch
from engine import developer, execution, intent_guard, recovery, repair_guard, requirements, task_goal, verify
from tests.test_recovery_journal import GitHub

HOLD = 'Leave its branch untouched so the verified fix can be folded into #279 after independent review.'
DIAGNOSTIC = 'Requirement untested: R21 '+HOLD+' (add or cite a test that exercises it)'
SHA = 'a'*40


class ReviewRenewalRoutingTests(unittest.TestCase):
    def setUp(self):
        for variable in (task_goal.CURRENT, recovery.CURRENT, requirements.CURRENT, intent_guard.ACTIVE):
            self.addCleanup(variable.reset, variable.set(None))
        task_goal.CURRENT.set(task_goal.from_request(HOLD))
        previous=developer.Progress.latest;developer.Progress.latest=None
        self.addCleanup(setattr,developer.Progress,'latest',previous)

    def test_old_operational_test_diagnostic_rechecks_unchanged_source_without_edit_permission(self):
        pr=dict(number=50,html_url='https://github.com/onlykappa/KappaForge/pull/50',base={'sha':SHA},
                head={'sha':SHA,'ref':'kappa/dev-9','repo':{'full_name':developer.ROOT}},title='Draft: Hold',body='Plan')
        issue=dict(number=9,title='Hold',body=HOLD)
        for failed in (False,True):
            with self.subTest(failed=failed),ExitStack() as stack:
                for name,value in [('revision_files',[dict(filename='app.py',status='modified')]),('list_tree',({'app.py':40},{})),
                    ('project_guide',''),('read_source','value = 1\n'),('gh',[]),('requirements_open',['Requirement verification is incomplete',DIAGNOSTIC]),('repair_branch_observation',None)]:
                    stack.enter_context(patch.object(developer,name,return_value=value))
                stack.enter_context(patch.object(developer,'anchor_pr_goal'))
                stack.enter_context(patch.object(developer,'_add_engine_developer_source',side_effect=lambda sources,*a:sources))
                stack.enter_context(patch.object(repair_guard,'enabled',return_value=True))
                checker=stack.enter_context(patch.object(repair_guard,'verify_all_findings',side_effect=repair_guard.RepairReviewRequired('needs source validation')))
                stack.enter_context(patch.object(developer,'generate',side_effect=AssertionError('no speculative edit')))
                review=stack.enter_context(patch.object(developer,'check_the_work',return_value=({},'Still incomplete',[DIAGNOSTIC])))
                if failed:
                    with self.assertRaises(repair_guard.RepairReviewRequired):
                        developer.revise_branch(issue,pr,'kappa/dev-9',SHA,[],'token','key',allowed={'free'},checks_failed=True)
                    checker.assert_called_once();review.assert_not_called()
                else:
                    result=developer.revise_branch(issue,pr,'kappa/dev-9',SHA,[],'token','key',allowed={'free'})
                    checker.assert_not_called();review.assert_called_once()
                    self.assertTrue(review.call_args.kwargs['review_only']);self.assertEqual(result[2],{})
                    self.assertIn(DIAGNOSTIC,result[3],'routing does not silently retire the missing proof')

    def test_typed_diagnostic_requires_exact_operational_ask_and_fresh_controller_proof(self):
        self.assertTrue(verify.controller_problem(DIAGNOSTIC))
        self.assertFalse(verify.controller_problem(DIAGNOSTIC,[]))
        row=dict(text=HOLD,met=True,kind='controller')
        self.assertTrue(verify.controller_problem(DIAGNOSTIC,[row]))
        self.assertFalse(verify.controller_problem(DIAGNOSTIC,[dict(row,met=False)]))
        for bad in (DIAGNOSTIC+' Remove authentication.',DIAGNOSTIC.replace(HOLD,'Fix the authentication code.'),DIAGNOSTIC.replace('R21','R0')):
            self.assertFalse(verify.controller_problem(bad))

    def test_cached_labels_revalidate_and_rebind_through_successive_explicit_renewals(self):
        world=GitHub();journal=world.journal();journal.checkpoint(SHA,base='main')
        classified=[replace(requirements.classify(HOLD)[0],categories=('bug_fix','testing'))]
        requirements.save(journal,classified,recovery.ROOT,HOLD)
        for n in (1,2):
            previous=journal.scope
            grant=dict(id='fresh-owner-'+str(n),requestId='fresh-owner-'+str(n),conversationId='chat',repo=recovery.ROOT,mode='develop',
                       expiresAt=(world.now+86400)*1000,resumeFrom=dict(digest=previous.digest,authorization=previous.identity))
            world.issue['body']='Repository: onlykappa/KappaForge\nMode: develop\n\n'+HOLD+'\n\nApproved from KappaForge Chat.\n<!-- kappa-authorization:'+json.dumps(grant)+' -->'
            intent_guard.activate(world.issue);journal=world.journal()
            loaded=requirements.load(journal,recovery.ROOT,HOLD,journal.scope)
            self.assertFalse(loaded[0].behavioral)
            record=execution._read_blob(journal,journal.state['requirementClassification'])
            self.assertEqual(record['scope'],journal.scope.digest)
            with self.assertRaises(execution.CheckpointMismatch):
                requirements.load(journal,recovery.ROOT,HOLD+' Add another source change.',journal.scope)

    def test_wrong_renewal_link_cannot_admit_old_cached_labels(self):
        world=GitHub();journal=world.journal();journal.checkpoint(SHA,base='main')
        requirements.save(journal,requirements.classify(HOLD),recovery.ROOT,HOLD)
        other=copy.copy(journal.scope);other.digest='f'*64;other.resume_from=dict(digest='e'*64,authorization='wrong')
        journal.scope=other
        with self.assertRaises(execution.CheckpointMismatch):
            requirements.load(journal,recovery.ROOT,HOLD,other)

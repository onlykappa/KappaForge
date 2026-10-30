"""#322 closed-draft repair must reconcile before model calls or source side effects."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from engine import developer, recovery, task_goal

class ClosedDraftTests(unittest.TestCase):
    def journal(self):
        return SimpleNamespace(state=dict(pr='https://github.com/onlykappa/KappaForge/pull/323',candidate='a'*40,status='running'),
            persist=Mock(),publish=Mock(),clock=lambda:1234)

    def test_saved_closed_draft_has_precise_durable_stop_and_no_retry(self):
        j=self.journal();read=Mock(return_value=dict(state='closed',head=dict(ref='kappa/dev-322',repo=dict(full_name='onlykappa/KappaForge'))))
        self.assertTrue(recovery.reconcile_closed_draft(j,'onlykappa/KappaForge','kappa/dev-322',read))
        self.assertEqual(j.state['objectiveReceipt']['state'],'blocked_closed_draft')
        self.assertEqual(j.state['status'],'blocked')
        j.persist.assert_called_once();j.publish.assert_called_once()
        recovery.finalize_attempt(j,None)
        j.persist.assert_called_once()

    def test_foreign_open_or_mismatched_draft_cannot_be_adopted(self):
        for pr in [dict(state='open'),dict(state='closed',head=dict(ref='kappa/dev-999',repo=dict(full_name='onlykappa/KappaForge')))]:
            j=self.journal()
            self.assertFalse(recovery.reconcile_closed_draft(j,'onlykappa/KappaForge','kappa/dev-322',Mock(return_value=pr)))
            j.persist.assert_not_called()

    def test_real_fix_entry_stops_before_questions_models_or_tests(self):
        j=self.journal()
        issue=dict(number=322,title='Fix',user=dict(login='onlykappa'),body='Repository: onlykappa/KappaForge\nMode: develop\nFix the saved task')
        closed=dict(state='closed',head=dict(ref='kappa/dev-322',repo=dict(full_name='onlykappa/KappaForge')))
        def read(path,*args,**kwargs):
            if '/pulls?state=open' in path:return []
            if path.endswith('/pulls/323'):return closed
            raise AssertionError('Unexpected operation '+path)
        token=recovery.CURRENT.set(j)
        try:
            with patch.object(developer,'gh',side_effect=read),patch.object(developer,'question_replies') as questions, \
                 patch.object(developer,'run_model') as model,patch.object(developer,'sandbox_result') as tests:
                self.assertIsNone(developer.fix_pull_request(issue,'fixture','fixture'))
                questions.assert_not_called();model.assert_not_called();tests.assert_not_called()
        finally:recovery.CURRENT.reset(token)

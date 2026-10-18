import copy
import unittest
from engine.intent_guard import ExecutionScope, ACTIVE, activate, guard_request


def issue(mode='develop'):
    return {'number':98,'state':'open','user':{'login':'onlykappa'},'created_at':'2099-01-01T00:00:00Z',
            'body':f'Repository: onlykappa/KappaForge\nMode: {mode}\n\nFix keyboard'}


class IntentGuardTests(unittest.TestCase):
    def tearDown(self):
        ACTIVE.set(None)

    def test_no_authority_from_model_or_repository(self):
        with self.assertRaises(PermissionError):
            guard_request('https://api.github.com/repos/onlykappa/KappaForge/issues', {'body':'Fix everything'}, 'POST', lambda n: issue())
        bad=issue();bad['user']['login']='bot'
        with self.assertRaises(PermissionError): activate(bad)

    def test_read_only_investigation_blocks_mutations(self):
        scope=ExecutionScope(issue('audit'))
        with self.assertRaises(PermissionError):scope.permit('https://api.github.com/repos/onlykappa/KappaForge/git/blobs',{},'POST')
        scope.permit('https://api.github.com/repos/onlykappa/KappaForge/issues/98/comments',{'body':'Observed keyboard issue'},'POST')

    def test_scope_and_child_tasks_and_merge(self):
        scope=ExecutionScope(issue())
        scope.permit('https://api.github.com/repos/onlykappa/KappaForge/git/blobs',{},'POST')
        scope.permit('https://api.github.com/repos/onlykappa/KappaForge/pulls',{'draft':True,'head':'kappa/dev-98'},'POST')
        for path,payload in [('issues',{'body':'Fix unrelated error'}),('git/refs/heads/main',{'sha':'x'}),('pulls/4/merge',{}),('pulls',{'draft':True,'head':'kappa/dev-99'})]:
            with self.assertRaises(PermissionError):scope.permit('https://api.github.com/repos/onlykappa/KappaForge/'+path,payload,'POST')

    def test_cancellation_checked_before_every_queued_mutation(self):
        original=issue();activate(original)
        guard_request('https://api.github.com/repos/onlykappa/KappaForge/git/blobs',{},'POST',lambda n: original)
        cancelled=copy.deepcopy(original);cancelled['state']='closed'
        with self.assertRaises(PermissionError):guard_request('https://api.github.com/repos/onlykappa/KappaForge/git/blobs',{},'POST',lambda n: cancelled)

    def test_expiry_and_interrupted_scope_change(self):
        old=issue();old['created_at']='2020-01-01T00:00:00Z'
        with self.assertRaises(PermissionError):ExecutionScope(old)
        scope=ExecutionScope(issue());changed=issue();changed['body']+='\nMode: code'
        with self.assertRaises(PermissionError):scope.check_current(changed)
        bad=issue();bad['body']+='\nApproved from KappaForge Chat.'
        with self.assertRaises(PermissionError):ExecutionScope(bad)

    def test_lifecycle_and_bounded_autonomous_recovery(self):
        scope=ExecutionScope(issue());scope.transition('planning');scope.transition('executing')
        for i in range(5):scope.recover(str(i))
        with self.assertRaises(PermissionError):scope.recover('six')
        with self.assertRaises(PermissionError):scope.recover('0')
        scope.transition('verifying');scope.transition('completed')
        with self.assertRaises(PermissionError):scope.transition('executing')

    def test_tool_boundary_drives_lifecycle_and_persists_provenance(self):
        from engine.intent_guard import record_success, report_provenance
        task=issue('audit');scope=activate(task)
        url='https://api.github.com/repos/onlykappa/KappaForge/issues/98/comments'
        payload={'body':'### KappaForge run completed\nRead-only findings'}
        guard_request(url,payload,'POST',lambda n:task)
        self.assertEqual(scope.state,'executing')
        persisted=report_provenance(url,payload)
        self.assertIn('"state":"completed"',persisted['body'])
        self.assertIn('authorizationId',persisted['body'])
        record_success(url,payload)
        self.assertEqual(scope.state,'completed')
        with self.assertRaises(PermissionError):guard_request(url,payload,'POST',lambda n:task)

    def test_scheduled_selection_skips_expired_or_unauthorized_tasks(self):
        from unittest.mock import patch
        from engine import runner
        expired=issue('audit');expired['number']=14;expired['created_at']='2020-01-01T00:00:00Z'
        legacy=issue('audit');legacy['number']=20;legacy['body']+='\nApproved from KappaForge Chat.'
        current=issue('audit')
        tasks={14:expired,20:legacy,98:current}
        def github(path,token=None,payload=None):
            if '/comments' in path:return []
            return [{'number':n} for n in tasks]
        with patch.dict('os.environ',{'INPUT_ISSUE_NUMBER':''}),patch.object(runner,'github',github),patch.object(runner,'get_issue',lambda n,t:tasks[int(n)]):
            self.assertEqual(runner.choose_issue('fixture',{'audit'})['number'],98)

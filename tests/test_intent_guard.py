import copy
import json
import unittest
from engine.intent_guard import ExecutionScope, ACTIVE, activate, guard_request
from engine.reliability import RecoveryBudgetExceeded


def issue(mode='develop'):
    return {'number':98,'state':'open','user':{'login':'onlykappa'},'created_at':'2099-01-01T00:00:00Z',
            'body':f'Repository: onlykappa/KappaForge\nMode: {mode}\n\nFix keyboard'}


class IntentGuardTests(unittest.TestCase):
    def tearDown(self):
        ACTIVE.set(None)

    def test_saved_owner_restrictions_block_incompatible_development_and_survive_reload(self):
        def saved(restrictions, mode='develop'):
            task = issue(mode)
            record = {'id': 'scope', 'requestId': 'request', 'conversationId': 'chat',
                      'repo': 'onlykappa/KappaForge', 'mode': mode, 'expiresAt': 4102444800000,
                      'restrictions': restrictions}
            task['body'] += '\nApproved from KappaForge Chat.\n<!-- kappa-authorization:' + json.dumps(record) + ' -->'
            return task
        for key in ('noPR', 'noTests', 'noCode'):
            with self.assertRaisesRegex(PermissionError, 'Owner restrictions'):
                ExecutionScope(saved({key: True}))
        scope = ExecutionScope(saved({'noMerge': True}))
        reloaded = ExecutionScope(copy.deepcopy(saved({'noMerge': True})))
        self.assertEqual(scope.restrictions, reloaded.restrictions)
        reloaded.state = 'verifying'
        reloaded.release_pr = 99
        reloaded.release_sha = 'a' * 40
        with self.assertRaisesRegex(PermissionError, 'prohibited merging'):
            reloaded.permit('https://api.github.com/repos/onlykappa/KappaForge/pulls/99/merge',
                            {'sha': 'a' * 40, 'merge_method': 'squash'}, 'PUT')
        self.assertEqual(ExecutionScope(saved({'noCode': True}, 'audit')).restrictions, {'noCode': True})
        for invalid in ({'noPR': 'false'}, {'allowCode': True}, []):
            with self.assertRaisesRegex(PermissionError, 'Invalid owner restrictions'):
                ExecutionScope(saved(invalid))

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

    def test_pinned_inference_route_is_an_exact_owner_task_restriction(self):
        task=issue();task['body']+='\nInference route: groq:openai/gpt-oss-120b'
        scope=ExecutionScope(task)
        self.assertEqual(scope.inference_route,'groq:openai/gpt-oss-120b')
        changed=copy.deepcopy(task);changed['body']=changed['body'].replace('gpt-oss-120b','qwen3.8-27b')
        with self.assertRaisesRegex(PermissionError,'cancelled or scope changed'):
            scope.check_current(changed)
        duplicate=copy.deepcopy(task);duplicate['body']+='\nInference route: groq:openai/gpt-oss-120b'
        with self.assertRaisesRegex(PermissionError,'Pinned inference route'):
            ExecutionScope(duplicate)
        unsupported=copy.deepcopy(task);unsupported['body']=unsupported['body'].replace('groq:openai/gpt-oss-120b','mistral:paid-model')
        with self.assertRaisesRegex(PermissionError,'Pinned inference route'):
            ExecutionScope(unsupported)
        read_only=copy.deepcopy(task);read_only['body']=read_only['body'].replace('Mode: develop','Mode: audit')
        with self.assertRaisesRegex(PermissionError,'Pinned inference route'):
            ExecutionScope(read_only)

    def test_new_document_path_is_bound_to_pinned_authorization(self):
        task=issue();task['body']+='\nInference route: groq:openai/gpt-oss-120b\nEdit path: docs/integration/PHASE4-NOTE.md'
        scope=ExecutionScope(task)
        self.assertEqual(scope.edit_path,'docs/integration/PHASE4-NOTE.md')
        changed=copy.deepcopy(task);changed['body']=changed['body'].replace('PHASE4-NOTE.md','OTHER.md')
        with self.assertRaises(PermissionError):scope.check_current(changed)
        for path in ['README.md','docs/integration/../README.md','docs/integration/source.py']:
            bad=copy.deepcopy(task);bad['body']=bad['body'].replace('docs/integration/PHASE4-NOTE.md',path)
            with self.assertRaises(PermissionError):ExecutionScope(bad)

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
        with self.assertRaises(RecoveryBudgetExceeded):scope.recover('six')
        with self.assertRaises(RecoveryBudgetExceeded):scope.recover('0')
        scope.transition('verifying');scope.transition('completed')
        with self.assertRaises(PermissionError):scope.transition('executing')

    def test_each_stage_gets_its_own_retries_within_a_task_wide_cap(self):
        """Task #125 died in its last stage: one budget of 5 retries was shared by all four stages and the test."""
        from engine import intent_guard
        scope=ExecutionScope(issue());scope.transition('planning');scope.transition('executing')
        for stage in range(1,5):
            for i in range(5):scope.recover('same-answer-'+str(i),round_id=stage)
        with self.assertRaises(RecoveryBudgetExceeded):scope.recover('one more',round_id=4)
        with self.assertRaises(RecoveryBudgetExceeded):scope.recover('same-answer-0',round_id=4)
        scope.recover('same-answer-0',round_id=5)
        scope.recoveries=intent_guard.TOTAL_RECOVERIES
        with self.assertRaises(RecoveryBudgetExceeded):scope.recover('x',round_id=6)

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

    def test_task_maintains_its_own_progress_comment_and_pull_request(self):
        from engine.intent_guard import record_success
        task=issue();scope=activate(task)
        root='https://api.github.com/repos/onlykappa/KappaForge/'
        record_success(root+'issues/98/comments',{'body':'Working'},{'id':555})
        scope.permit(root+'issues/comments/555',{'body':'Done'},'PATCH')
        with self.assertRaises(PermissionError):scope.permit(root+'issues/comments/556',{'body':'Edit someone else'},'PATCH')
        record_success(root+'pulls?state=open&head=onlykappa:kappa/dev-98',None,[{'number':120,'head':{'ref':'kappa/dev-98','repo':{'full_name':'onlykappa/KappaForge'}}},
                                                                            {'number':121,'head':{'ref':'kappa/dev-12','repo':{'full_name':'onlykappa/KappaForge'}}}])
        scope.permit(root+'pulls/120',{'body':'## Latest fix'},'PATCH')
        scope.permit(root+'issues/120/comments',{'body':'### Fix applied'},'POST')
        for path,payload,method in [('pulls/121',{'body':'x'},'PATCH'),('issues/121/comments',{'body':'x'},'POST'),
                                    ('pulls/120',{'state':'closed'},'PATCH'),('issues/120/comments',{'body':'Guidance: do more'},'POST')]:
            with self.assertRaises(PermissionError):scope.permit(root+path,payload,method)

    def test_long_running_modes_stay_authorized_for_a_week(self):
        import time
        week=issue('watch');week['created_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()-3*86400))
        ExecutionScope(week)
        day=issue('develop');day['created_at']=week['created_at']
        with self.assertRaises(PermissionError):ExecutionScope(day)

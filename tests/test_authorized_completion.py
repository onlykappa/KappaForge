import json
import unittest
from engine.authorized_completion import complete
from engine.intent_guard import ACTIVE

SHA='a'*40

def fixture(merge=True,conclusion='success'):
    record={'id':'scope','requestId':'turn','conversationId':'chat','repo':'onlykappa/KappaForge','mode':'develop','expiresAt':4102444800000,'allowMerge':merge}
    issue={'number':98,'state':'open','user':{'login':'onlykappa'},'body':'Repository: onlykappa/KappaForge\nMode: develop\n\nFix keyboard\nApproved from KappaForge Chat.\n<!-- kappa-authorization:'+json.dumps(record)+' -->'}
    run={'event':'workflow_dispatch','conclusion':'success','head_branch':'main','repository':{'full_name':'onlykappa/KappaForge'},'path':'.github/workflows/sandbox-tests.yml','display_title':'Sandbox validation kappa/dev-98 @ '+SHA}
    pr={'number':99,'mergeable':True,'node_id':'PR1','draft':True,'head':{'sha':SHA,'repo':{'full_name':'onlykappa/KappaForge'}},'base':{'repo':{'full_name':'onlykappa/KappaForge'}}}
    writes=[]
    def api(path,payload=None,method=None):
        if payload is not None:writes.append((path,payload));return {'merged':True}
        if path.endswith('/issues/98'):return issue
        if '/pulls?' in path:return [pr]
        if path.endswith('/pulls/99'):return pr
        if '/files?' in path:return []
        if '/check-runs?' in path:return {'total_count':1,'check_runs':[{'status':'completed','conclusion':conclusion}]}
        if path.endswith('/status'):return {'total_count':0,'statuses':[]}
        raise AssertionError(path)
    return run,api,writes,issue,pr

class CompletionTests(unittest.TestCase):
    def tearDown(self):ACTIVE.set(None)
    def test_owner_no_merge_limit_overrides_a_stale_allow_merge_flag(self):
        run, api, writes, issue, _ = fixture(True)
        record = json.loads(issue['body'].split('<!-- kappa-authorization:')[1].split(' -->')[0])
        record['restrictions'] = {'noMerge': True}
        issue['body'] = issue['body'].split('<!-- kappa-authorization:')[0] + '<!-- kappa-authorization:' + json.dumps(record) + ' -->'
        self.assertEqual(complete(run, api), 'merge_not_authorized')
        self.assertEqual(writes, [])
    def test_merge_requires_original_user_permission(self):
        run,api,writes,_,_=fixture(False)
        self.assertEqual(complete(run,api),'merge_not_authorized');self.assertEqual(writes,[])
    def test_a_verified_merge_request_waits_for_the_owner_and_writes_nothing(self):
        # #217: only the owner merges (KAPPA.md section 6). The execution scope refuses the merge and ready calls, so
        # completion must stop before them instead of failing on a PermissionError.
        run,api,writes,_,_=fixture()
        self.assertEqual(complete(run,api),'owner_merge_required');self.assertEqual(writes,[])
    def test_the_execution_scope_refuses_the_merge_completion_used_to_make(self):
        from engine.intent_guard import activate
        _,_,_,issue,_=fixture()
        scope=activate(issue)
        for url,payload,method in [('https://api.github.com/repos/onlykappa/KappaForge/pulls/99/merge',{'sha':SHA,'merge_method':'squash'},'PUT'),
                                   ('https://api.github.com/graphql',{'query':'mutation($id:ID!){mergePullRequest(input:{pullRequestId:$id}){pullRequest{merged}}}','variables':{'id':'PR1'}},'POST')]:
            with self.assertRaisesRegex(PermissionError,'owner'):scope.permit(url,payload,method)
    def test_failed_check_blocks_merge(self):
        run,api,writes,_,_=fixture(conclusion='failure')
        self.assertEqual(complete(run,api),'checks_pending_or_failed');self.assertEqual(writes,[])
    def test_stale_test_commit_cannot_merge_new_head(self):
        run,api,writes,_,pr=fixture();pr['head']['sha']='b'*40
        self.assertEqual(complete(run,api),'superseded');self.assertEqual(writes,[])
    def test_foreign_or_untrusted_verification_cannot_release(self):
        for changes in [{'event':'pull_request'},{'path':'.github/workflows/untrusted.yml'},{'conclusion':'failure'},{'repository':{'full_name':'attacker/repo'}}]:
            run,api,writes,_,_=fixture();run.update(changes)
            self.assertNotEqual(complete(run,api),'merged');self.assertEqual(writes,[])
    def test_waits_for_github_to_compute_mergeability(self):
        run,api,writes,_,pr=fixture();pr['mergeable']=None;waits=[]
        def wait(seconds):
            waits.append(seconds)
            if len(waits)==2:pr['mergeable']=True
        self.assertEqual(complete(run,api,wait),'owner_merge_required');self.assertEqual(len(waits),2)
    def test_waits_for_checks_still_running_such_as_the_native_build(self):
        run,api,writes,_,_=fixture();state={'status':'in_progress','conclusion':None}
        def checks(path,payload=None,method=None):
            if '/check-runs?' in path:return {'total_count':1,'check_runs':[{'name':'native',**state}]}
            return api(path,payload,method)
        def wait(seconds):state.update(status='completed',conclusion='success')
        self.assertEqual(complete(run,checks,wait),'owner_merge_required')
    def test_gives_up_on_checks_that_never_finish_without_merging(self):
        run,api,writes,_,_=fixture()
        def checks(path,payload=None,method=None):
            if '/check-runs?' in path:return {'total_count':1,'check_runs':[{'name':'native','status':'in_progress'}]}
            return api(path,payload,method)
        self.assertEqual(complete(run,checks,lambda s:None),'checks_pending_or_failed');self.assertEqual(writes,[])
    def native(self, states):
        """App changes plus the agent's dispatched native build of the exact head commit, one state per lookup."""
        run,api,writes,_,_=fixture()
        def with_native(path,payload=None,method=None):
            if '/files?' in path:return [{'filename':'preview/ui.js'}]
            if 'ios-build.yml/runs' in path:
                status,conclusion=states.pop(0) if len(states)>1 else states[0]
                return {'workflow_runs':[{'display_title':'iOS build kappa/dev-98 @ '+SHA,'event':'workflow_dispatch','head_branch':'main','status':status,'conclusion':conclusion}]}
            return api(path,payload,method)
        return run,with_native,writes
    def test_app_changes_wait_for_the_dispatched_native_build_before_reporting(self):
        run,api,writes=self.native([('in_progress',None),('completed','success')]);waits=[]
        self.assertEqual(complete(run,api,waits.append),'owner_merge_required');self.assertTrue(waits);self.assertEqual(writes,[])
    def test_a_failed_native_build_blocks_the_merge(self):
        run,api,writes=self.native([('completed','failure')])
        self.assertEqual(complete(run,api,lambda s:None),'native_verification_required');self.assertEqual(writes,[])

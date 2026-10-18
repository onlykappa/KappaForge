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
        if '/check-runs?' in path:return {'total_count':1,'check_runs':[{'status':'completed','conclusion':conclusion}]}
        if path.endswith('/status'):return {'total_count':0,'statuses':[]}
        raise AssertionError(path)
    return run,api,writes,issue,pr

class CompletionTests(unittest.TestCase):
    def tearDown(self):ACTIVE.set(None)
    def test_merge_requires_original_user_permission(self):
        run,api,writes,_,_=fixture(False)
        self.assertEqual(complete(run,api),'merge_not_authorized');self.assertEqual(writes,[])
    def test_explicit_merge_runs_after_checks_with_exact_sha(self):
        run,api,writes,_,_=fixture()
        self.assertEqual(complete(run,api),'merged')
        self.assertEqual(writes[-1],('repos/onlykappa/KappaForge/pulls/99/merge',{'sha':SHA,'merge_method':'squash'}))
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

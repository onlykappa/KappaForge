"""Regression coverage for cloud-only recovery, verification and immutable evidence."""
import base64
import json
import unittest
from unittest.mock import patch
from engine import developer, verify, continuous, full_reader, project_index, self_repair, intent_guard


class CloudAuditTests(unittest.TestCase):
    def tearDown(self):
        developer.UNFINISHED.clear()
        developer.Progress.latest = None
        intent_guard.ACTIVE.set(None)

    def test_long_minified_find_feedback_reaches_the_actual_divergence(self):
        actual = 'submit(async e=>{' + 'x=1;' * 1000 + 'sendActual();});'
        wanted = actual.replace('sendActual()', 'sendInvented()')
        evidence = developer.repair_evidence(developer.EditMismatch('app.js', wanted, actual, 0))
        self.assertIn('sendActual()', evidence)
        self.assertLess(len(evidence), 4000)

    def test_both_legacy_and_persisted_incomplete_verdicts_block_auto_merge(self):
        from test_authorized_completion import fixture
        from engine.authorized_completion import complete
        for data in ({'title':'Draft (incomplete): task'}, {'body':verify.review_record(['Missing API'])},
                     {'body':'<!-- KAPPA_REVIEW_V1 broken -->'}):
            run, api, writes, _, pr = fixture()
            pr.update(data)
            self.assertEqual(complete(run, api), 'requirements_incomplete')
            self.assertEqual(writes, [])
        self.assertFalse(verify.open_problems({'body':verify.review_record([])}))

    def test_unavailable_review_cannot_erase_failed_stages_or_unmet_requirements(self):
        class Progress:
            def now(self,*a,**k): pass
            def ok(self,*a,**k): pass
        sources = {'app.py':'value = 1\n'}
        developer.UNFINISHED[:] = ['Step 2 was not done: add the API client']
        reviews = [([{'text':'API client','met':False}], [], []), None]
        with patch.object(verify,'wiring_problems',return_value=[]), patch.object(verify,'model_review',side_effect=reviews), \
             patch.object(developer,'generate',side_effect=[('model','docs',{'README.md':'notes'},''),ValueError('cannot repair')]):
            _, _, problems = developer.check_the_work('key','Add API','onlykappa/KappaForge','a'*40,'token',sources,
                {'app.py':10}, {'app.py':'value = 2\n'}, '',None,'',True,Progress())
        self.assertTrue(any('Step 2' in p for p in problems))
        self.assertTrue(any('API client' in p for p in problems))
        self.assertTrue(any('unavailable' in p for p in problems))
        self.assertTrue(any('No test' in p for p in problems))

    def test_requirement_repair_rechecks_before_clearing_incomplete_state(self):
        from test_developer import OwnerRequestedFixTests
        case = OwnerRequestedFixTests()
        calls, gh = case.fake(run_conclusion='success')
        def incomplete_gh(path, token, payload=None, method=None):
            result = gh(path,token,payload,method)
            if '/pulls?state=open' in path:
                result[0].update(title='Draft (incomplete): Add feature',body=verify.review_record(['Missing feature']))
            return result
        def answer(key,prompt,**kwargs):
            if 'You are reviewing a change' in prompt:
                return 'model', json.dumps({'requirements':[{'text':'Add feature','met':True}], 'problems':[]})
            return case.answer()
        with patch.object(developer,'gh',side_effect=incomplete_gh),patch.object(developer.native_build if hasattr(developer,'native_build') else __import__('engine.native_build',fromlist=['gh']),'gh',side_effect=incomplete_gh), \
             patch.object(developer,'run_model',side_effect=answer):
            developer.fix_pull_request(case.ISSUE,'key','token')
        edits = [c[1] for c in calls if c[0].endswith('/pulls/50') and c[2]=='PATCH']
        self.assertEqual(edits[0]['title'],'Draft: Add feature')
        self.assertFalse(verify.open_problems(edits[0]))
        self.assertTrue(any(c[0].endswith('/dispatches') for c in calls))

    def test_audit_resumes_the_original_sha_when_main_moves(self):
        current = ['a'*40]
        read = []
        def get(path):
            if path=='repos/onlykappa/KappaForge': return {'default_branch':'main'}
            if '/commits/' in path:return {'sha':current[0]}
            if '/git/trees/' in path:return {'tree':[{'type':'blob','path':f'src/{i:02}.py'} for i in range(25)]}
            if '/contents/' in path:
                read.append(path)
                return {'encoding':'base64','content':base64.b64encode(b'x=1').decode()}
            raise AssertionError(path)
        state,note,_=full_reader.inspect_batch('onlykappa/KappaForge',1,None,'token','key',get,lambda *_:('model','report'),[])
        current[0]='b'*40
        state,_,complete=full_reader.inspect_batch('onlykappa/KappaForge',1,None,'token','key',get,lambda *_:('model','report'),[{'body':note}])
        self.assertEqual(state['sha'],'a'*40)
        self.assertEqual(state['next'],25)
        self.assertTrue(complete)
        self.assertTrue(all(p.endswith('?ref='+'a'*40) for p in read))

    def test_continuous_audit_binds_the_read_token(self):
        seen=[]
        def gh(path,token=None,payload=None):
            if '/comments' in path:return []
            seen.append(token)
            if path.endswith('/KappaForge'):return {'default_branch':'main'}
            if '/commits/' in path:return {'sha':'a'*40}
            return {'tree':[]}
        with patch.object(continuous,'github',side_effect=gh),patch.object(continuous,'is_private',return_value=False):
            continuous.continuous_audit({'number':1,'body':'Repository: onlykappa/KappaForge\nMode: continuous'},'read-token','key')
        self.assertEqual(seen,['read-token']*3)

    def test_project_map_reads_its_claimed_commit(self):
        refs=[]
        def gh(path,token):
            return {'commit':{'sha':'a'*40}} if '/branches/' in path else {'tree':[{'type':'blob','path':'app.py'}]}
        report=project_index.index_repository('onlykappa/KappaForge','token',gh,lambda r,p,ref:refs.append(ref) or 'x=1')
        self.assertEqual(refs,[report['commit']])

    def test_activity_advances_updated_at_without_finishing_the_step(self):
        with patch.object(developer.Progress,'clock',return_value=100),patch.object(developer.Progress,'_write'):
            p=developer.Progress(1,'token');p.now('Writing')
            with patch.object(developer.Progress,'clock',return_value=200):p.act('model','Asking next model')
            snap=p.snapshot()
        self.assertEqual(snap['updatedAt'],200000)
        self.assertEqual(snap['steps'][0]['status'],'running')

    def test_legacy_repair_handles_large_sources_and_keeps_its_path_allowlist(self):
        path='engine/runner.py'
        source='#'+('x'*20000)+'\nvalue = 1\n'
        proposal=json.dumps({'files':[{'path':path,'edits':[{'find':'value = 1','replace':'value = 2'}]}]})
        issue={'title':'Fix value','body':'Repair files: '+path}
        with patch.object(developer,'read_source',return_value=source) as read,patch.object(developer,'run_model',return_value=('model',proposal)):
            _,files=self_repair.repair_proposal('key',issue,'token','a'*40)
        self.assertIn('value = 2',files[0][1])
        self.assertEqual(read.call_args.args[2],'a'*40)
        with self.assertRaises(ValueError):self_repair.repair_proposal('key',{'body':'Repair files: engine/intent_guard.py'})

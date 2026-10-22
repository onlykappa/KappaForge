"""Task #191 regression: the production retry boundary, policy and progress contract."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from engine import runner, recovery, developer, gateway, verify
from engine.edit_errors import GenerationFailure
from test_recovery_journal import GitHub

class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self): return json.dumps({'route':'gemini:gemini-2.5-flash','text':'verified fixture'}).encode()

class Task191Tests(unittest.TestCase):
    def tearDown(self):
        developer.Progress.latest = None
        from engine.intent_guard import ACTIVE
        ACTIVE.set(None)

    def test_skip_reaches_integrated_gateway_and_excluded_answers_are_rejected(self):
        seen=[]
        def send(request,timeout):
            seen.append(json.loads(request.data));return Response()
        with patch.dict(os.environ,{'KAPPA_ROUTER_REQUIRED':'true','KAPPA_ROUTER_URL':'https://router.example','KAPPA_ROUTER_TOKEN':'t'*40}), patch.object(runner.urllib.request,'urlopen',side_effect=send):
            self.assertEqual(runner.run_model('key','task',100,allowed=['gemini'],skip=('ollama:gpt-oss:120b',))[0],'gemini:gemini-2.5-flash')
            self.assertEqual(seen[0]['excludedRoutes'],['ollama:gpt-oss:120b'])
            with self.assertRaisesRegex(gateway.GatewayUnavailable,'excluded route'):
                runner.run_integrated_router('task',100,['gemini'],skip=('gemini:gemini-2.5-flash',))

    def test_pinned_excluded_route_never_broadens_authority_or_sends(self):
        journal=SimpleNamespace(scope=SimpleNamespace(repo=runner.ROOT,inference_route='groq:openai/gpt-oss-120b'))
        token=recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ,{'KAPPA_ROUTER_URL':'https://router.example','KAPPA_ROUTER_TOKEN':'t'*40}),patch.object(runner.urllib.request,'urlopen') as send:
                with self.assertRaisesRegex(gateway.GatewayUnavailable,'no alternative route'):
                    runner.run_integrated_router('task',100,['groq'],skip=('groq:openai/gpt-oss-120b',))
                send.assert_not_called()
        finally: recovery.CURRENT.reset(token)

    def test_aggregate_generation_source_cannot_choose_authorization_state(self):
        error=GenerationFailure('Edits failed: authorization expired in source /authorization',compact=True)
        self.assertEqual(recovery.diagnose(error),('validation','smaller_stages'))
        world=GitHub();journal=world.journal();journal.begin()
        journal.event(error,outcome='blocked')
        self.assertEqual(journal.state['executionState'],'paused')
        self.assertEqual(recovery.diagnose(GenerationFailure('Protected path',blocked=True)),('authorization','stop'))

    def test_warning_uses_warning_in_plain_report_and_progress_snapshot(self):
        bodies=[]
        with patch.object(developer,'gh',side_effect=lambda path,token,payload,**kw:bodies.append(payload['body']) or {'id':1}):
            progress=developer.Progress(191,'fixture');progress.now('Check the work');progress.ok('Found 3 problems',warn=True)
            progress.fail('Saved draft is incomplete')
        self.assertIn('⚠️ Found 3 problems',bodies[-1]);self.assertNotIn('✅ Found 3 problems',bodies[-1])
        self.assertEqual(progress.snapshot()['status'],'failed')
        self.assertEqual(progress.snapshot()['steps'][0]['status'],'blocked')

    def test_review_failure_keeps_diagnostic_and_never_becomes_verified(self):
        result=verify.model_review(lambda *a,**kw:('writer','bad json'),'key','weather',lambda p:'',{'value.py':'x=1'},['value.py'])
        self.assertIsNone(result);self.assertIn('JSONDecodeError',verify.REVIEW_FAILURE.get())

    def test_pre_auth_duplicate_weather_handlers_get_accurate_diagnosis(self):
        old='if (!["/chat"].includes(pathname)) return;\nif (!auth.startsWith("Bearer ")) return;\n'
        route='if (pathname === "/weather") { return weather(); }\n'
        findings=verify.worker_problems({verify.WORKER:old},{verify.WORKER:route+route+old})
        self.assertTrue(any('before app authorization' in p for p in findings))
        self.assertTrue(any('duplicate handlers' in p for p in findings))
        self.assertFalse(any('every request to it gets 404' in p for p in findings))


    def test_failure_note_preserves_original_cause_candidate_and_incomplete_plan(self):
        world=GitHub();journal=world.journal();journal.begin()
        journal.checkpoint('b'*40,pr='https://github.com/onlykappa/KappaForge/pull/133')
        error=GenerationFailure('Missing edit anchor quoting /authorization')
        journal.stop(error)
        restored=world.journal()
        self.assertEqual(restored.state['events'][-1]['kind'],'validation')
        self.assertEqual(restored.state['executionState'],'paused')
        self.assertIn('Missing edit anchor',restored.notes.render())
        self.assertIn('b'*40,restored.notes.render())
        self.assertIn('Stopped before completion',restored.notes.render())
        with patch.object(journal,'event',side_effect=RuntimeError('storage failed')),patch.object(journal,'publish',side_effect=RuntimeError('offline')):
            journal.stop(error)  # Diagnostic failures never replace the original error.

    def test_incomplete_checkpoint_summary_labels_generated_claims_unverified(self):
        body=developer.review_body(191,'writer','Feature works and tests pass','Added weather',{'value.py':'x=1'},problems=['Review unavailable'])
        self.assertIn('Not finished: saved implementation checkpoint',body)
        self.assertIn('Agent-reported changes (not verified)',body)
        self.assertIn('Review unavailable', verify.open_problems({'body': body}))

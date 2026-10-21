import json
import os
import io
import urllib.error
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine import runner
from engine import continuous
from engine import gateway, developer, verify


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"route": "gemini:gemini-2.5-flash", "text": "fixture result"}).encode()


class GroqResponse(Response):
    def read(self):
        return json.dumps({"route": "groq:openai/gpt-oss-120b", "text": "fixture result"}).encode()


class WrongRouteResponse(Response):
    def read(self):
        return json.dumps({"route": "groq:qwen/qwen3.8-27b", "text": "fixture result"}).encode()


class IntegratedRouterTests(unittest.TestCase):
    def setUp(self):
        probe = patch.object(gateway, 'probe', return_value={'provider': 'groq', 'model': 'openai/gpt-oss-120b', 'failedCondition': 'eligible'})
        self.probe = probe.start()
        self.addCleanup(probe.stop)

    def test_coding_uses_scoped_gateway_and_returns_actual_route(self):
        captured = {}

        def open_request(request, timeout):
            captured["url"] = request.full_url
            captured["authorization"] = request.get_header("Authorization")
            captured["body"] = json.loads(request.data.decode())
            captured["timeout"] = timeout
            return Response()

        with patch.dict(os.environ, {
            "KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40,
        }, clear=False), patch.object(runner.urllib.request, "urlopen", side_effect=open_request):
            route, text = runner.run_integrated_router("exact edit instruction", 1200, ["gemini"])

        self.assertEqual((route, text), ("gemini:gemini-2.5-flash", "fixture result"))
        self.assertEqual(captured["url"], "https://router.example/router/infer")
        self.assertEqual(captured["authorization"], "Bearer " + "t" * 40)
        self.assertTrue(captured["body"]["privateCode"])
        self.assertEqual(captured["body"]["providers"], ["gemini"])
        self.assertEqual(captured["body"]["messages"][0]["content"], "exact edit instruction")
        self.assertEqual(captured["body"]["maxTokens"], 1200)

    def test_missing_gateway_fails_closed_without_direct_provider_fallback(self):
        with patch.dict(os.environ, {"KAPPA_ROUTER_URL": "", "KAPPA_ROUTER_TOKEN": ""}, clear=False), \
                patch.object(runner, "_run_model", side_effect=AssertionError("direct provider fallback")):
            with self.assertRaisesRegex(RuntimeError, "no direct provider fallback"):
                runner.run_integrated_router("fixture", 100, ["gemini"])

    def test_task_pinned_groq_model_disables_all_fallback_and_checks_actual_route(self):
        from engine import recovery
        captured = {}

        def open_request(request, timeout):
            captured["body"] = json.loads(request.data.decode())
            return GroqResponse()

        journal = SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge",
                                                        inference_route="groq:openai/gpt-oss-120b"))
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ, {
                "KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40,
            }, clear=False), patch.object(runner.urllib.request, "urlopen", side_effect=open_request):
                route, text = runner.run_integrated_router("exact documentation change", 8000, ["gemini", "groq"], True)
        finally:
            recovery.CURRENT.reset(handle)

        self.assertEqual((route, text), ("groq:openai/gpt-oss-120b", "fixture result"))
        self.assertEqual(captured["body"]["providers"], ["groq"])
        self.assertEqual(captured["body"]["model"], "groq:openai/gpt-oss-120b")
        self.assertFalse(captured["body"]["fallback"])
        self.assertEqual(captured["body"]["reasoningEffort"], "low")
        self.assertEqual(captured["body"]["maxTokens"], 768)

    def test_gateway_error_codes_and_retry_deadlines_are_preserved_without_raw_error_text(self):
        for status, code, label in [(429, 'daily_limit', 'gateway daily limit'),
                                    (429, 'minute_limit', 'gateway minute limit'),
                                    (429, 'free_capacity_cooldown', 'source not reported'),
                                    (503, 'free_route_unavailable', 'upstream cause not reported')]:
            body = {'code': code, 'retryAt': 1900000000000, 'error': 'secret-prompt-must-not-be-logged'}
            failure = gateway.error(status, body)
            self.assertIn(label, str(failure))
            self.assertEqual(failure.retry_at, 1900000000)
            self.assertNotIn(body['error'], str(failure))
            self.assertEqual(failure.code, code)

    def test_failed_pinned_inference_is_not_retried_by_generation_or_review(self):
        failure = gateway.error(503, {'code': 'free_route_unavailable'}, pinned=True)
        with patch.object(developer, 'run_model', side_effect=failure) as model:
            with self.assertRaises(gateway.GatewayUnavailable):
                developer.generate('unused', 'add a note', runner.ROOT, {'note.md': '# Note'}, {'note.md': 6})
        self.assertEqual(model.call_count, 1)
        with patch.object(runner, 'run_model', side_effect=failure):
            with self.assertRaises(gateway.GatewayUnavailable):
                verify.model_review(runner.run_model, 'unused', 'add a note', lambda p: '', {'note.md': '# Note'}, ['note.md'])

    def test_pinned_503_records_status_code_and_stops_after_one_post(self):
        from engine import recovery
        journal = SimpleNamespace(scope=SimpleNamespace(repo=runner.ROOT, inference_route='groq:openai/gpt-oss-120b'))
        handle = recovery.CURRENT.set(journal)
        try:
            failed = urllib.error.HTTPError('https://router.example/router/infer', 503, 'unavailable', {},
                                           io.BytesIO(b'{"code":"free_route_unavailable","error":"secret-fixture"}'))
            with patch.dict(os.environ, {'KAPPA_ROUTER_URL': 'https://router.example', 'KAPPA_ROUTER_TOKEN': 't'*40}), \
                    patch.object(runner.urllib.request, 'urlopen', side_effect=failed) as network:
                with self.assertRaises(gateway.GatewayUnavailable) as raised:
                    runner.run_integrated_router('fixture task', 8000, ['groq'])
            self.assertTrue(raised.exception.terminal)
            self.assertEqual(network.call_count, 1)
            self.assertNotIn('secret-fixture', str(raised.exception))
        finally:
            recovery.CURRENT.reset(handle)

    def test_pinned_provider_must_already_be_authorized_for_code(self):
        from engine import recovery
        journal = SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge",
                                                        inference_route="groq:openai/gpt-oss-120b"))
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ, {
                "KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40,
            }, clear=False), patch.object(runner.urllib.request, "urlopen", side_effect=AssertionError("network call")):
                with self.assertRaisesRegex(RuntimeError, "outside the authorized free coding policy"):
                    runner.run_integrated_router("fixture", 100, ["gemini"])
        finally:
            recovery.CURRENT.reset(handle)

    def test_runner_rejects_a_gateway_response_for_a_different_pinned_model(self):
        from engine import recovery
        journal = SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge",
                                                        inference_route="groq:openai/gpt-oss-120b"))
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ, {
                "KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40,
            }, clear=False), patch.object(runner.urllib.request, "urlopen", return_value=WrongRouteResponse()):
                with self.assertRaisesRegex(RuntimeError, "did not honor the task-pinned route"):
                    runner.run_integrated_router("fixture", 100, ["groq"])
        finally:
            recovery.CURRENT.reset(handle)

    def test_continuous_job_accepts_router_without_a_direct_gemini_key(self):
        env = {
            "GITHUB_TOKEN": "fixture", "KAPPA_ROUTER_REQUIRED": "true",
            "KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40,
            "CONTINUOUS_ISSUE_NUMBER": "", "KAPPA_TASK_SCOPE": "read",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(continuous, "github", return_value=[]):
            continuous.main()


if __name__ == "__main__":
    unittest.main()

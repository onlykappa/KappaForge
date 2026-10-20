import json
import os
import unittest
from unittest.mock import patch

from engine import runner
from engine import continuous


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"route": "gemini:gemini-2.5-flash", "text": "fixture result"}).encode()


class IntegratedRouterTests(unittest.TestCase):
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

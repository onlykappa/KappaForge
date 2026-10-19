import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch, MagicMock
from engine import runner

KEYS = ("GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "NVIDIA_API_KEY",
        "OLLAMA_API_KEY", "ZAI_API_KEY", "LLM7_API_KEY")

def response(data):
    result = MagicMock()
    result.__enter__.return_value = result
    result.__exit__.return_value = False
    result.read.return_value = json.dumps(data).encode()
    return result

class ModelRoutingTests(unittest.TestCase):
    def test_approved_models_only(self):
        available = {"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash", "other"}
        self.assertEqual(runner.select_models(available), ["gemini-3-flash", "gemini-2.5-flash"])

    def test_new_flash_models_are_found_without_a_hard_coded_name(self):
        # Task #111 ran on the weakest model because the named 2.5 models had gone; discovery now finds the current ones.
        available = {"gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3-pro-preview",
                     "gemini-2.5-flash-image", "gemini-2.0-flash-exp", "gemini-3-flash-live"}
        self.assertEqual(runner.select_models(available), ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"])

    def test_no_unapproved_fallback(self):
        self.assertEqual(runner.select_models({"gemini-2.5-pro"}), [])

    @patch("engine.runner.urllib.request.urlopen")
    def test_discovery_filters_methods_and_paginates(self, urlopen):
        def response(data):
            result = MagicMock()
            result.__enter__.return_value = result
            result.__exit__.return_value = False
            result.read.return_value = __import__("json").dumps(data).encode()
            return result
        urlopen.side_effect = [
            response({"models":[
                {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},
                {"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}
            ],"nextPageToken":"next"}),
            response({"models":[{"name":"models/gemini-3-flash","supportedGenerationMethods":["generateContent"]}]})
        ]
        self.assertEqual(runner.discover_models("test-key"), {"gemini-2.5-flash", "gemini-3-flash"})
        self.assertEqual(urlopen.call_count, 2)
    def test_free_providers_take_over_when_gemini_is_exhausted(self):
        def response(data):
            result = MagicMock()
            result.__enter__.return_value = result
            result.__exit__.return_value = False
            result.read.return_value = json.dumps(data).encode()
            return result
        requests = []
        def urlopen(req, timeout=None):
            url = req.full_url
            requests.append((url, req.get_header("Authorization")))
            if "generativelanguage" in url and "/models?" in url:
                return response({"models": [{"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]}]})
            if "generativelanguage" in url:
                raise urllib.error.HTTPError(url, 429, "quota", {}, io.BytesIO(b""))
            if url == "https://api.groq.com/openai/v1/models":
                return response({"data": [{"id": "whisper-large-v3"}, {"id": "llama-3.3-70b-versatile"}]})
            if url == "https://api.groq.com/openai/v1/chat/completions":
                return response({"choices": [{"message": {"content": "fallback answer"}}]})
            raise urllib.error.HTTPError(url, 404, "missing", {}, io.BytesIO(b""))
        keys = {k: "" for k in KEYS if k != "GROQ_API_KEY"}
        with patch.dict(os.environ, {"GROQ_API_KEY": "groq-key", **keys}), \
                patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), patch("engine.runner.time.sleep"):
            model, output = runner.run_model("gemini-key", "Write code")
        self.assertEqual((model, output), ("groq:llama-3.3-70b-versatile", "fallback answer"))
        self.assertIn(("https://api.groq.com/openai/v1/chat/completions", "Bearer groq-key"), requests)

    def test_without_provider_keys_gemini_errors_are_reported(self):
        empty = {k: "" for k in KEYS}
        offline = urllib.error.URLError("offline")
        with patch.dict(os.environ, empty), patch.object(runner, "discover_models", return_value=set()), \
                patch("engine.runner.urllib.request.urlopen", side_effect=offline):
            with self.assertRaisesRegex(RuntimeError, "No approved Flash model"):
                runner.run_model("gemini-key", "x")

    def test_keyless_providers_answer_without_credentials(self):
        requests = []
        def urlopen(req, timeout=None):
            url = req.full_url
            requests.append((url, req.get_header("Authorization")))
            if url == "https://api.kilo.ai/api/gateway/models":
                return response({"data": [{"id": "paid/model"}, {"id": "kilo-auto/free"}, {"id": "poolside/laguna-s-2.1:free"}]})
            if url == "https://api.kilo.ai/api/gateway/chat/completions":
                return response({"choices": [{"message": {"content": "free pool answer"}}]})
            raise urllib.error.HTTPError(url, 404, "missing", {}, io.BytesIO(b""))
        with patch.dict(os.environ, {k: "" for k in KEYS}), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            self.assertEqual(runner.provider_models("kilo"), ["kilo-auto/free", "poolside/laguna-s-2.1:free"])
            self.assertEqual(runner.provider_models("zai"), [], "keyed providers stay off without a key")
            self.assertEqual(runner.run_fallback_providers("Write code", 100, []), ("kilo:kilo-auto/free", "free pool answer"))
        self.assertTrue(all(auth is None for _, auth in requests))

    def test_fixed_free_list_and_optional_keys(self):
        with patch.dict(os.environ, {"ZAI_API_KEY": "zai-key", "LLM7_API_KEY": "llm7-key"}), \
                patch("engine.runner.urllib.request.urlopen") as urlopen:
            self.assertEqual(runner.provider_models("zai"), ["glm-4.7-flash"])
            urlopen.assert_not_called()
            self.assertEqual(runner.provider_headers(runner.PROVIDERS["providers"]["llm7"])["Authorization"], "Bearer llm7-key")
    def test_code_only_goes_to_providers_allowed_for_the_repository(self):
        keys = {k: "" for k in ("CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "NVIDIA_API_KEY",
                                "OLLAMA_API_KEY", "ZAI_API_KEY", "LLM7_API_KEY", "KAPPA_CODE_PROVIDERS", "KAPPA_PRIVATE_CODE_PROVIDERS")}
        with patch.dict(os.environ, {**keys, "GROQ_API_KEY": "k"}):
            everything = set(runner.PROVIDERS["order"])
            self.assertEqual(runner.code_providers(False), everything, "owner allows every provider by default")
            self.assertEqual(runner.code_providers(True), everything)
        with patch.dict(os.environ, {**keys, "KAPPA_PRIVATE_CODE_PROVIDERS": "groq, cerebras", "KAPPA_CODE_PROVIDERS": "kilo"}):
            self.assertEqual(runner.code_providers(True), {"groq", "cerebras"})
            self.assertEqual(runner.code_providers(False), {"kilo"})

    def test_fallback_skips_disallowed_providers_and_retries_with_a_smaller_reply_limit(self):
        def response(data):
            result = MagicMock()
            result.__enter__.return_value = result
            result.__exit__.return_value = False
            result.read.return_value = json.dumps(data).encode()
            return result
        sent = []
        def urlopen(req, timeout=None):
            url = req.full_url
            if url.endswith("/models"):
                return response({"data": [{"id": "llama-3.3-70b-versatile"}]})
            body = json.loads(req.data)
            sent.append((url, body["max_tokens"]))
            if body["max_tokens"] > runner.FALLBACK_MAX_TOKENS:
                raise urllib.error.HTTPError(url, 400, "max_tokens too large", {}, io.BytesIO(b""))
            return response({"choices": [{"message": {"content": "ok"}}]})
        with patch.dict(os.environ, {"GROQ_API_KEY": "k"}), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            self.assertIsNone(runner.run_fallback_providers("x", 16384, [], allowed=set()))
            self.assertEqual(sent, [])
            self.assertEqual(runner.run_fallback_providers("x", 16384, [], allowed={"groq"}), ("groq:llama-3.3-70b-versatile", "ok"))
        self.assertEqual([limit for _, limit in sent], [16384, runner.FALLBACK_MAX_TOKENS])

if __name__ == "__main__":
    unittest.main()


class CutOffAnswerTests(unittest.TestCase):
    def test_strongest_flash_model_goes_first(self):
        available = {"gemini-3.1-flash-lite", "gemini-3-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"}
        self.assertEqual(runner.select_models(available)[:2], ["gemini-3-flash", "gemini-2.5-flash"])

    def test_an_answer_cut_off_at_the_limit_is_asked_again_with_more_room(self):
        sent = []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]}]})
            limit = json.loads(req.data)["generationConfig"]["maxOutputTokens"]
            sent.append(limit)
            if len(sent) == 1:
                return response({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"read": ['}]}}]})
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"read": []}'}]}}]})
        with patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            model, output = runner.run_model("key", "plan", max_output_tokens=8000)
        self.assertEqual((model, output), ("gemini-3-flash", '{"read": []}'))
        self.assertEqual(sent, [8000, 32000])


class FailureReportTests(unittest.TestCase):
    def test_the_task_gets_the_real_reason_and_next_step_without_secrets(self):
        posted = []
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "77", "GEMINI_API_KEY": "secret-key-123"}), \
                patch.object(runner, "github", side_effect=lambda path, token, payload: posted.append((path, payload))), \
                patch.object(runner, "notify"):
            runner.report_failure(9, "t", "Stage 2 failed: bad edit (key secret-key-123)", "reply with guidance")
        path, payload = posted[0]
        self.assertEqual(path, "repos/onlykappa/KappaForge/issues/9/comments")
        self.assertIn("**Why:** Stage 2 failed: bad edit", payload["body"])
        self.assertIn("**What to do:** reply with guidance.", payload["body"])
        self.assertIn("<!-- KAPPA_FAILED:77 -->", payload["body"])
        self.assertNotIn("secret-key-123", payload["body"])

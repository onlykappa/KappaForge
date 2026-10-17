import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch, MagicMock
from engine import runner

class ModelRoutingTests(unittest.TestCase):
    def test_approved_models_only(self):
        available = {"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash", "other"}
        self.assertEqual(runner.select_models(available), ["gemini-3-flash", "gemini-2.5-flash"])

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
        keys = {k: "" for k in ("CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "NVIDIA_API_KEY")}
        with patch.dict(os.environ, {"GROQ_API_KEY": "groq-key", **keys}), \
                patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), patch("engine.runner.time.sleep"):
            model, output = runner.run_model("gemini-key", "Write code")
        self.assertEqual((model, output), ("groq:llama-3.3-70b-versatile", "fallback answer"))
        self.assertIn(("https://api.groq.com/openai/v1/chat/completions", "Bearer groq-key"), requests)

    def test_without_provider_keys_gemini_errors_are_reported(self):
        empty = {k: "" for k in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "NVIDIA_API_KEY")}
        with patch.dict(os.environ, empty), patch.object(runner, "discover_models", return_value=set()):
            with self.assertRaisesRegex(RuntimeError, "No approved Flash model"):
                runner.run_model("gemini-key", "x")

if __name__ == "__main__":
    unittest.main()

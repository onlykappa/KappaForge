import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch, MagicMock
from engine import runner

KEYS = ("GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "NVIDIA_API_KEY",
        "OLLAMA_API_KEY", "ZAI_API_KEY", "LLM7_API_KEY", "UNOROUTER_API_KEY", "REQUESTY_API_KEY")

def response(data):
    result = MagicMock()
    result.__enter__.return_value = result
    result.__exit__.return_value = False
    result.read.return_value = json.dumps(data).encode()
    return result

class ModelRoutingTests(unittest.TestCase):
    def setUp(self):
        runner._lists.clear()  # Model lists are cached per run; each test brings its own.
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()

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

    def test_gemini_full_catalog_opt_in_routes_other_chat_models_after_flash(self):
        available = {"gemini-2.5-pro", "gemini-3-flash", "gemini-2.5-flash-image", "gemini-2.5-flash-preview-tts", "other"}
        with patch.dict(os.environ, {"KAPPA_ALL_MODEL_PROVIDERS": "gemini"}):
            self.assertEqual(runner.select_models(available), ["gemini-3-flash", "gemini-2.5-pro", "other"])

    def test_star_opts_every_provider_into_its_full_catalog(self):
        with patch.dict(os.environ, {"KAPPA_ALL_MODEL_PROVIDERS": "*"}):
            self.assertTrue(runner.full_catalog("groq"))
            self.assertFalse(runner.full_catalog("kilo"), "free-model gateways keep free routes unless named")
        with patch.dict(os.environ, {"KAPPA_ALL_MODEL_PROVIDERS": "*,kilo"}):
            self.assertTrue(runner.full_catalog("kilo"))
            self.assertEqual(runner.select_models({"gemini-2.5-pro", "gemini-3-flash"}), ["gemini-3-flash", "gemini-2.5-pro"])

    def test_provider_full_catalog_opt_in_lifts_free_filter_and_cap(self):
        def urlopen(req, timeout=None):
            return response({"data": [{"id": "paid/model"}, {"id": "kilo-auto/free"}, {"id": "poolside/laguna-s-2.1:free"}, {"id": "other/free"}]})
        with patch.dict(os.environ, {**{k: "" for k in KEYS}, "KAPPA_ALL_MODEL_PROVIDERS": "kilo"}), \
                patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            self.assertEqual(runner.provider_models("kilo"), ["poolside/laguna-s-2.1:free", "kilo-auto/free", "other/free", "paid/model"])

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
            self.assertEqual(runner.provider_models("kilo"), ["poolside/laguna-s-2.1:free", "kilo-auto/free"], "coding models first")
            self.assertEqual(runner.provider_models("zai"), [], "keyed providers stay off without a key")
            self.assertEqual(runner.run_fallback_providers("Write code", 100, []), ("kilo:poolside/laguna-s-2.1:free", "free pool answer"))
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
        with patch.dict(os.environ, {"GROQ_API_KEY": "k"}), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), \
                patch.dict(runner.PROVIDERS["providers"]["groq"], {"maxOutput": 65536}):
            self.assertIsNone(runner.run_fallback_providers("x", 16384, [], allowed=set()))
            self.assertEqual(sent, [])
            self.assertEqual(runner.run_fallback_providers("x", 16384, [], allowed={"groq"}), ("groq:llama-3.3-70b-versatile", "ok"))
        self.assertEqual([limit for _, limit in sent], [16384, runner.FALLBACK_MAX_TOKENS])

if __name__ == "__main__":
    unittest.main()


class CutOffAnswerTests(unittest.TestCase):
    def setUp(self):
        runner._lists.clear()  # Model lists are cached per run; each test brings its own.
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()

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
            model, output = runner.run_model("key", "plan", max_output_tokens=8000, allowed=set())  # Gemini only.
        self.assertEqual((model, output), ("gemini-3-flash", '{"read": []}'))
        self.assertEqual(sent, [8000, 32000])

    def test_a_dropped_connection_mid_answer_is_retried_not_fatal(self):
        # Task #119 failed after 13 minutes on "Remote end closed connection without response".
        import http.client
        calls = []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]}]})
            calls.append(1)
            if len(calls) == 1:
                raise http.client.RemoteDisconnected("Remote end closed connection without response")
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "done"}]}}]})
        with patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), patch("engine.runner.time.sleep"):
            self.assertEqual(runner.run_model("key", "write"), ("gemini-3-flash", "done"))
        self.assertEqual(len(calls), 2)


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


class RateLimits(unittest.TestCase):
    """Task #123 spent ~15 s on each of five rate-limited models on every call; they now rest instead."""

    def setUp(self):
        runner._lists.clear()
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()
        runner.COOLDOWN.clear()
        self.addCleanup(runner.EXHAUSTED.clear)
        self.addCleanup(runner.COOLDOWN.clear)

    def run_calls(self, body, calls=2, skip=()):
        asked = []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/" + m, "supportedGenerationMethods": ["generateContent"]}
                                            for m in ("gemini-3-flash", "gemini-3-flash-lite")]})
            if "generativelanguage" not in req.full_url:  # Keyless free providers are out of this test.
                raise urllib.error.HTTPError(req.full_url, 404, "missing", {}, io.BytesIO(b""))
            model = req.full_url.split("/models/")[1].split(":")[0]
            asked.append(model)
            if model == "gemini-3-flash":
                raise urllib.error.HTTPError(req.full_url, 429, "quota", {}, io.BytesIO(body))
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "ok"}]}}]})
        with patch.dict(os.environ, {k: "" for k in KEYS}), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), \
                patch("engine.runner.time.sleep"):
            results = [runner.run_model("key", "p", skip=skip) for _ in range(calls)]
        return asked, results

    def test_a_daily_quota_skips_the_model_for_the_rest_of_the_run(self):
        asked, results = self.run_calls(b'{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}]}}')
        self.assertEqual(results, [("gemini-3-flash-lite", "ok")] * 2)
        self.assertEqual(asked.count("gemini-3-flash"), 3, "retried on the first call only")
        self.assertIn("gemini-3-flash", runner.EXHAUSTED)

    def test_a_per_minute_limit_rests_for_a_minute(self):
        asked, _ = self.run_calls(b"{}")
        self.assertEqual(asked.count("gemini-3-flash"), 3)
        self.assertGreater(runner.COOLDOWN["gemini-3-flash"], 0)
        with patch("engine.runner.time.time", return_value=__import__("time").time() + 61):
            asked, _ = self.run_calls(b"{}", calls=1)
        self.assertEqual(asked.count("gemini-3-flash"), 3, "asked again once the minute is over")

    def test_skipped_models_are_not_asked(self):
        asked, results = self.run_calls(b"{}", calls=1, skip=("gemini-3-flash",))
        self.assertEqual(asked, ["gemini-3-flash-lite"])


class StrongModelsBeforeLite(unittest.TestCase):
    """Task #123 ran entirely on Flash-Lite while strong free coding models sat unused; they now come first."""

    CONFIG = {"order": ["strongp", "weakp"], "maxModelsPerProvider": 1, "exclude": "embed", "providers": {
        "strongp": {"kind": "openai", "base": "https://strong.example/v1", "strong": True, "context": 1000, "maxOutput": 200,
                    "models": ["coder-1"]},
        "weakp": {"kind": "openai", "base": "https://weak.example/v1", "context": 100000, "models": ["small-1"]}}}

    def setUp(self):
        runner._lists.clear()
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()
        runner.COOLDOWN.clear()
        self.addCleanup(runner.EXHAUSTED.clear)
        self.addCleanup(runner.COOLDOWN.clear)

    def route(self, prompt, max_output_tokens=100):
        asked, bodies = [], []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/" + m, "supportedGenerationMethods": ["generateContent"]}
                                            for m in ("gemini-3-flash", "gemini-3-flash-lite")]})
            if "generativelanguage" in req.full_url:
                model = req.full_url.split("/models/")[1].split(":")[0]
                asked.append(model)
                if model == "gemini-3-flash":
                    raise urllib.error.HTTPError(req.full_url, 429, "quota", {}, io.BytesIO(b""))
                return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "lite"}]}}]})
            asked.append(req.full_url.split("/v1")[0])
            bodies.append(json.loads(req.data))
            return response({"choices": [{"message": {"content": "strong"}}]})
        with patch.dict(runner.PROVIDERS, self.CONFIG), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen), \
                patch("engine.runner.time.sleep"):
            answer = runner.run_model("key", prompt, max_output_tokens=max_output_tokens)
        return answer, asked, bodies

    def test_a_strong_provider_answers_before_flash_lite(self):
        answer, asked, bodies = self.route("short prompt", max_output_tokens=5000)
        self.assertEqual(answer, ("strongp:coder-1", "strong"))
        self.assertNotIn("gemini-3-flash-lite", asked)
        self.assertEqual(bodies[0]["max_tokens"], 200, "capped at the provider's output limit")

    def test_a_prompt_too_big_for_the_strong_provider_goes_to_flash_lite(self):
        answer, asked, _ = self.route("x" * 5000)
        self.assertEqual(answer, ("gemini-3-flash-lite", "lite"))
        self.assertNotIn("https://strong.example", asked)


class BestModelsFirst(StrongModelsBeforeLite):
    """The owner's order (2.2.8): the best free coding models first, then Gemini, falling down the list mid-task."""

    def test_the_strong_provider_answers_before_gemini(self):
        answer, asked, _ = self.route("short prompt", max_output_tokens=150)
        self.assertEqual(answer, ("strongp:coder-1", "strong"))
        self.assertEqual(asked, ["https://strong.example"], "Gemini is not asked while the best model answers")

    def test_a_rate_limited_strong_provider_hands_over_to_gemini(self):
        runner.COOLDOWN["strongp:coder-1"] = runner.time.time() + 60
        answer, asked, _ = self.route("short prompt")
        self.assertEqual(answer, ("gemini-3-flash-lite", "lite"))
        self.assertEqual(asked[0], "gemini-3-flash", "full-size Flash is next, then Flash-Lite")


class ProviderCheck(unittest.TestCase):
    """The "Check AI providers" workflow: which models really answer, without printing keys."""

    def setUp(self):
        runner._lists.clear()  # Model lists are cached per run; each test brings its own.
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()

    def test_missing_keys_answers_and_failures_are_reported(self):
        from engine import provider_check

        def urlopen(req, timeout=None):
            if req.full_url.endswith("/models"):
                return response({"data": [{"id": "deepseek-v4-pro"}]})
            if "ollama" in req.full_url:
                return response({"choices": [{"message": {"content": "OK"}}]})
            raise urllib.error.HTTPError(req.full_url, 429, "quota", {}, io.BytesIO(b""))
        env = {k: "" for k in KEYS}
        env.update({"OLLAMA_API_KEY": "secret-ollama", "NVIDIA_API_KEY": "secret-nvidia"})
        with patch.dict(os.environ, env), patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            rows = provider_check.check_provider("ollama") + provider_check.check_provider("nvidia") + provider_check.check_provider("groq")
            text = provider_check.report(rows + provider_check.check_gemini(""))
        self.assertIn("| ollama (strong) | `deepseek-v4-pro` | ✅ ok |", text)
        self.assertIn("| nvidia (strong) | `deepseek-v4-pro` | ❌ failed | HTTP 429 (rate-limited) |", text)
        self.assertIn("add the GROQ_API_KEY secret", text)
        self.assertIn("GEMINI_API_KEY is not set", text)
        self.assertIn("1 model answered", text)
        self.assertNotIn("secret-", text)


class ModelListsAndRetiredModels(unittest.TestCase):
    """Model lists are fetched once per run, and a retired model (404) is not asked again on every call."""

    def setUp(self):
        runner._lists.clear()
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        runner.EXHAUSTED.clear()
        runner.COOLDOWN.clear()
        self.addCleanup(runner._lists.clear)
        self.addCleanup(runner.EXHAUSTED.clear)

    def test_one_list_per_run_and_404_models_rest(self):
        asked = []
        def urlopen(req, timeout=None):
            asked.append(req.full_url)
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/" + m, "supportedGenerationMethods": ["generateContent"]}
                                            for m in ("gemini-2.5-flash", "gemini-3-flash-lite")]})
            if "gemini-2.5-flash:" in req.full_url:
                raise urllib.error.HTTPError(req.full_url, 404, "gone", {}, io.BytesIO(b""))
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "ok"}]}}]})
        with patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            for _ in range(3):
                self.assertEqual(runner.run_model("key", "p", allowed=set()), ("gemini-3-flash-lite", "ok"))
        self.assertEqual(sum("/models?" in u for u in asked), 1, "the model list is fetched once")
        self.assertEqual(sum("gemini-2.5-flash:" in u for u in asked), 1, "a retired model is asked once, not every call")


class ProviderDenialRecoveryTests(unittest.TestCase):
    def setUp(self):
        runner.PROVIDER_PAUSES.clear()
        runner.COOLDOWN.clear()
        runner.EXHAUSTED.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        self.addCleanup(runner.COOLDOWN.clear)
        self.addCleanup(runner.EXHAUSTED.clear)
        self.config = {'order': ['first', 'second'], 'providers': {
            name: {'key': name.upper() + '_API_KEY', 'base': 'https://' + name,
                   'context': 100000, 'maxOutput': 8192, 'strong': True} for name in ('first', 'second')}}

    def exercise(self, code):
        calls = []
        def urlopen(req, timeout=None):
            model = json.loads(req.data)['model']
            calls.append((req.full_url, model))
            if 'first' in req.full_url and model == 'bad':
                raise urllib.error.HTTPError(req.full_url, code, 'denied', {}, io.BytesIO(b''))
            return response({'choices': [{'message': {'content': 'valid'}}]})
        with patch.object(runner, 'PROVIDERS', self.config), \
                patch.object(runner, 'provider_models', side_effect=lambda pid: ['bad', 'good'] if pid == 'first' else ['ok']), \
                patch.dict(os.environ, {'FIRST_API_KEY': 'old-key', 'SECOND_API_KEY': 'free-key'}), \
                patch.object(runner.urllib.request, 'urlopen', side_effect=urlopen):
            first = runner.run_fallback_providers('prompt', 1000, [])
            second = runner.run_fallback_providers('prompt', 1000, [])
            with patch.dict(os.environ, {'FIRST_API_KEY': 'new-key'}):
                third = runner.run_fallback_providers('prompt', 1000, [])
        return first, second, third, calls

    def test_payment_or_auth_denial_skips_provider_until_key_changes(self):
        for code in (401, 402):
            with self.subTest(code=code):
                runner.PROVIDER_PAUSES.clear()
                first, second, third, calls = self.exercise(code)
                self.assertEqual(first, ('second:ok', 'valid'))
                self.assertEqual(second, first)
                self.assertEqual(third, first)
                self.assertEqual(sum('first' in url for url, _ in calls), 2)
                self.assertNotIn(('https://first/chat/completions', 'good'), calls)

    def test_model_403_tries_other_approved_models_and_does_not_repeat_denial(self):
        first, second, third, calls = self.exercise(403)
        self.assertEqual(first, ('first:good', 'valid'))
        self.assertEqual(second, first)
        self.assertEqual(third, first)
        self.assertEqual(sum(model == 'bad' for _, model in calls), 2)

    def test_quarantine_survives_worker_restart(self):
        from engine import recovery
        journal = MagicMock()
        journal.state = {}
        journal.project = {}
        journal.scope.repo = 'onlykappa/KappaForge'
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.object(runner, 'PROVIDERS', self.config):
                runner.provider_denied('first', 'bad', 402)
                identity = runner.provider_identity('first')
                self.assertIn(identity, journal.state['providerPauses'])
                runner.PROVIDER_PAUSES.clear()
                with patch.object(runner, 'provider_models') as models:
                    runner.run_fallback_providers('prompt', 1000, [], allowed={'first'})
                models.assert_not_called()
        finally:
            recovery.CURRENT.reset(handle)


    def test_gemini_model_denial_switches_and_key_rotation_retries(self):
        calls = []
        def urlopen(req, timeout=None):
            model = req.full_url.split('/models/')[1].split(':')[0]
            calls.append(model)
            if model == 'gemini-3-flash':
                raise urllib.error.HTTPError(req.full_url, 403, 'denied', {}, io.BytesIO(b''))
            return response({'candidates': [{'content': {'parts': [{'text': 'valid'}]}}]})
        with patch.object(runner.urllib.request, 'urlopen', side_effect=urlopen):
            self.assertIsNone(runner.ask_gemini('old-key', 'gemini-3-flash', 'p', 1000, False, []))
            self.assertEqual(runner.ask_gemini('old-key', 'gemini-3-flash-lite', 'p', 1000, False, []),
                             ('gemini-3-flash-lite', 'valid'))
            self.assertIsNone(runner.ask_gemini('old-key', 'gemini-3-flash', 'p', 1000, False, []))
            self.assertIsNone(runner.ask_gemini('new-key', 'gemini-3-flash', 'p', 1000, False, []))
        self.assertEqual(calls, ['gemini-3-flash', 'gemini-3-flash-lite', 'gemini-3-flash'])

    def test_gemini_discovery_denial_is_not_repeated_on_next_call(self):
        runner._lists.clear()
        with patch.object(runner.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('gemini', 403, 'denied', {}, None)) as network, \
                patch.object(runner, 'provider_models', return_value=['free-model']), \
                patch.object(runner, 'run_fallback_providers', return_value=('first:free-model', 'valid')):
            for _ in range(2):
                self.assertEqual(runner.run_model('denied-gemini-key', 'prompt'), ('first:free-model', 'valid'))
        self.assertEqual(network.call_count, 1)

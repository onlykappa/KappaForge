"""The weekly comparison with the community free LLM API list."""
import json
from pathlib import Path
import unittest

from engine import free_list_check, runner

ROOT = Path(__file__).resolve().parents[1]


def provider(name, base, models):
    return {"name": name, "baseUrl": base, "description": name + " is free.", "models": models}


class FreeListCheckTests(unittest.TestCase):
    def test_reports_new_providers_and_pinned_models_that_left_a_complete_list(self):
        data = {"providers": [
            provider("Brand New", "https://api.brand.new/v1", [{"id": "x"}]),
            provider("Cohere", "https://api.cohere.com/v2", [{"id": "command-a"}]),
            provider("Z AI (Zhipu AI)", "https://open.bigmodel.cn/api/paas/v4", [{"id": "glm-4.7-flash"}]),
            provider("Groq", "https://api.groq.com/openai/v1", [{"id": "openai/gpt-oss-120b"}]),
            provider("Mistral AI", "https://api.mistral.ai/v1", [{"id": "mistral-small-2603"}]),
            provider("NVIDIA NIM", "https://integrate.api.nvidia.com/v1", [{"id": "other"}, {"id": None}]),
        ]}
        rows = free_list_check.compare(data, runner.PROVIDERS)
        self.assertIn(("new", "Brand New", "Brand New is free. Base URL: https://api.brand.new/v1"), rows)
        self.assertFalse(any(name == "Cohere" for _, name, _ in rows), "reviewed and ignored on purpose")
        self.assertFalse(any(name == "zai" for _, name, _ in rows), "China endpoint of the configured Z AI")
        self.assertIn(("pinned", "groq", "`qwen/qwen3.8-27b` is pinned as free but is no longer on the list"), rows)
        self.assertFalse(any(name == "mistral" for _, name, _ in rows), "-latest matches the dated model")
        self.assertFalse(any(name == "nvidia" for _, name, _ in rows), "a partial list proves nothing")

    def test_metered_chat_models_are_not_reported_as_missing_free_models(self):
        data = {'providers': [provider('Hugging Face', 'https://router.huggingface.co/v1', [{'id': 'other'}])]}
        self.assertEqual(free_list_check.compare(data, runner.PROVIDERS), [])

    def test_no_report_when_kappaforge_matches(self):
        self.assertEqual(free_list_check.report([], "2026-10-05"), "")
        text = free_list_check.report([("new", "A|B", "x|y")], "2026-10-05")
        self.assertIn("| Not used by KappaForge yet | A/B | x/y |", text, "a pipe never breaks the table")

    def test_hugging_face_is_matched_and_skipped_providers_stay_quiet(self):
        hosts = free_list_check.configured_hosts(runner.PROVIDERS)
        self.assertIn("huggingface", hosts.values())
        data = {"providers": [provider("ModelScope", "https://api-inference.modelscope.cn/v1", [{"id": "q"}]),
                              provider("SiliconFlow", "https://api.siliconflow.cn/v1", [{"id": "q"}])]}
        self.assertEqual(free_list_check.compare(data, runner.PROVIDERS), [], "skipped on purpose: English-language providers only")

    def test_workflow_reads_no_secrets_and_only_writes_issues(self):
        text = (ROOT / ".github/workflows/free-llm-drift.yml").read_text()
        self.assertNotIn("secrets.", text)
        self.assertIn("permissions:\n  contents: read\n  issues: write\n", text)
        self.assertIn("persist-credentials: false", text)


if __name__ == "__main__":
    unittest.main()

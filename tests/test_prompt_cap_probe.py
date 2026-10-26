"""The manual probe tests only the configured free gateway at fixed prompt sizes."""
import contextlib
import io
import json
import unittest
from unittest.mock import patch

from scripts import prompt_cap_probe


class PromptCapProbeTests(unittest.TestCase):
    def setUp(self):
        self.sleep_patch = patch('time.sleep')
        self.sleep = self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    def test_steps_up_by_five_thousand_and_stops_at_worker_resource_limit(self):
        calls = []

        def request(prompt, **kwargs):
            calls.append((len(prompt), kwargs))
            if len(prompt) == 35000:
                error = RuntimeError("resource limit")
                error.code = "worker_resource_limit"
                raise error
            return "groq:free", "OK"

        output = io.StringIO()
        with patch.dict("os.environ", {"KAPPA_ROUTER_REQUIRED": "true", "KAPPA_ROUTER_URL": "https://router.example",
                                        "KAPPA_ROUTER_TOKEN": "t" * 40}), \
                patch.object(prompt_cap_probe.runner, "run_integrated_router", side_effect=request), \
                contextlib.redirect_stdout(output):
            result = prompt_cap_probe.main()

        self.assertEqual(result, 0)
        self.assertEqual([chars for chars, _ in calls], [20000, 25000, 30000, 35000])
        self.assertTrue(all(kwargs == {"max_output_tokens": 64, "allowed": ["groq"]} for _, kwargs in calls))
        self.assertEqual(self.sleep.call_count, 3)
        self.assertTrue(all(call.args == (65,) for call in self.sleep.call_args_list))
        report = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(report["highestSuccessfulChars"], 30000)
        self.assertEqual(report["conclusion"], "resource_limit")

    def test_non_resource_failure_is_inconclusive_and_stops_the_probe(self):
        calls = []
        error = RuntimeError("quota")
        error.code = "provider_quota"
        error.details = {"source": "normalization", "category": "output_limit", "upstreamStatus": 200,
                         "model": "private-route", "message": "secret", "attempted": True}
        output = io.StringIO()
        with patch.dict("os.environ", {"KAPPA_ROUTER_REQUIRED": "true", "KAPPA_ROUTER_URL": "https://router.example",
                                        "KAPPA_ROUTER_TOKEN": "t" * 40}), \
                patch.object(prompt_cap_probe.runner, "run_integrated_router", side_effect=lambda *a, **k: calls.append(1) or (_ for _ in ()).throw(error)), \
                contextlib.redirect_stdout(output):
            result = prompt_cap_probe.main()
        self.assertEqual(result, 1)
        self.assertEqual(calls, [1])
        report = json.loads(output.getvalue())
        self.assertEqual(report["conclusion"], "inconclusive")
        self.assertEqual(report['tested'][0]['failure'], {
            'source': 'normalization', 'category': 'output_limit', 'upstreamStatus': 200, 'attempted': True})
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('private-route', output.getvalue())


if __name__ == "__main__":
    unittest.main()

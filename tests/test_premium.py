import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from engine import developer, recovery, runner


class PremiumResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"route": "openrouter:deepseek/deepseek-v4", "text": "fixture result",
                           "premium": {"mode": "now", "model": "deepseek/deepseek-v4", "usd": 0.08, "taskUsd": 0.08, "taskCapUsd": 1}}).encode()


class PremiumModeTests(unittest.TestCase):
    def ask(self, journal):
        captured = {}

        def open_request(request, timeout):
            captured["body"] = json.loads(request.data.decode())
            return PremiumResponse()

        handle = recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ, {"KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40}, clear=False), \
                 patch.object(runner.urllib.request, "urlopen", side_effect=open_request):
                runner.run_integrated_router("exact edit instruction", 1200, ["gemini"])
        finally:
            recovery.CURRENT.reset(handle)
        return captured["body"]

    def journal(self, premium=None):
        return SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge", number=42), premium=premium)

    def test_gateway_calls_carry_the_task_premium_mode_only_when_it_is_on(self):
        self.assertNotIn("premium", self.ask(self.journal()))
        self.assertEqual(self.ask(self.journal("now"))["premium"], {"task": 42, "mode": "now"})
        self.assertEqual(self.ask(self.journal("rescue"))["premium"], {"task": 42, "mode": "rescue"})
        # No task, no premium: the gateway's caps are per task.
        handle = recovery.CURRENT.set(None)
        try:
            self.assertFalse(developer.premium_rescue("test"))
        finally:
            recovery.CURRENT.reset(handle)

    def test_feed_shows_the_premium_model_and_the_task_spend(self):
        lines = []
        developer._PREMIUM_SEEN.clear()
        with patch.object(developer, "note", side_effect=lambda kind, text: lines.append(text)):
            self.ask(self.journal("now"))
            self.ask(self.journal("now"))
            developer._premium({"refused": "task cap", "model": "deepseek/deepseek-v4"})
        self.assertEqual([line for line in lines if not line.startswith("Asking ")], ["Using premium: deepseek/deepseek-v4 · $0.08 so far (cap $1.00)",
                                 "Premium skipped (task cap); carrying on with the free models"])

    def test_rescue_turns_premium_on_once_per_task(self):
        journal = self.journal()
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.object(developer, "note"):
                self.assertTrue(developer.premium_rescue("3 problems after 3 fix rounds"))
                self.assertEqual(journal.premium, "rescue")
                self.assertFalse(developer.premium_rescue("again"), "a rescue is tried only once")
                journal.premium = "now"
                self.assertFalse(developer.premium_rescue("switch on"), "a premium task needs no rescue")
        finally:
            recovery.CURRENT.reset(handle)

    def test_check_rounds_end_with_one_premium_fix_round(self):
        class Progress:
            def now(self, *a, **k): pass
            def ok(self, *a, **k): pass
        from engine import verify
        journal = SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge", number=42), premium=None,
                                  state={"requirements": []}, issue={}, requirements=lambda *_: None)
        seen = []

        def generate(*_args, **_kwargs):
            seen.append(journal.premium)
            raise ValueError("cannot repair")

        handle = recovery.CURRENT.set(journal)
        developer.UNFINISHED[:] = []
        try:
            with patch.object(verify, "wiring_problems", return_value=["Broken wiring in app.py"]), \
                 patch.object(verify, "model_review", return_value=None), patch.object(developer, "note"), \
                 patch.object(developer, "generate", side_effect=generate):
                developer.check_the_work("key", "Fix", "onlykappa/KappaForge", "a" * 40, "token", {"app.py": "x\n"},
                                         {"app.py": 2}, {"app.py": "y\n"}, "", None, "", False, Progress())
        finally:
            recovery.CURRENT.reset(handle)
        self.assertEqual(seen, [None] * developer.MAX_CHECK_ROUNDS + ["rescue"])


if __name__ == "__main__":
    unittest.main()

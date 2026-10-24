"""The $0 rule on the engine side: KappaForge never asks for a paid rescue. Blocked steps stay on free models, and the
coding request never carries a premium field. The gateway is mocked; it refuses paid rescues independently."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from engine import developer, recovery, runner

ROUTER = {"KAPPA_ROUTER_URL": "https://router.example", "KAPPA_ROUTER_TOKEN": "t" * 40, "KAPPA_ROUTER_REQUIRED": "true"}


class Reply:
    status = 200

    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, *_args):
        return json.dumps(self.data).encode()


def journal(**extra):
    return SimpleNamespace(scope=SimpleNamespace(repo="onlykappa/KappaForge", number=42), state={"requirements": []}, issue={},
                           requirements=lambda *_: None, persist=lambda: None, **extra)


class PremiumEngineTests(unittest.TestCase):
    def setUp(self):
        developer._PREMIUM_SEEN.clear()

    def call(self, current, quote=None, answer=None):
        """One gateway call under `current`; returns (dispatched payloads, quote payloads)."""
        sent, quotes = [], []

        def urlopen(request, timeout):
            sent.append(json.loads(request.data.decode()))
            return Reply(answer or {"route": "groq:llama", "text": "free answer"})

        def post(path, payload, timeout=30):
            quotes.append(payload)
            return 200, {"premium": quote or {"refused": "premium_off"}}

        handle = recovery.CURRENT.set(current)
        try:
            with patch.dict(os.environ, ROUTER, clear=False), patch.object(runner.urllib.request, "urlopen", side_effect=urlopen), \
                 patch.object(runner, "_router_post", side_effect=post):
                try:
                    runner.run_integrated_router("exact edit instruction", 1200, ["openrouter"])
                except runner.PremiumNotUsed:
                    pass
        finally:
            recovery.CURRENT.reset(handle)
        return sent, quotes

    def test_every_task_call_carries_its_number_and_never_premium_unless_a_step_asks(self):
        sent, quotes = self.call(journal())
        self.assertEqual(sent[0]["task"], 42)
        self.assertNotIn("premium", sent[0])
        self.assertEqual(quotes, [])

    def test_a_step_that_asks_for_a_rescue_still_sends_only_a_free_request(self):
        current = journal(premium_request={"step": "check", "reason": "check_rounds_exhausted"})
        sent, quotes = self.call(current, quote={"eligible": True, "quote": True, "step": "check", "model": "qwen/qwen3-coder", "maxUsd": 0.05})
        self.assertEqual(quotes, [], "no paid quote is ever requested")
        self.assertEqual(len(sent), 1)
        self.assertNotIn("premium", sent[0], "the coding request never carries a paid rescue")
        self.assertIsNone(current.premium_request, "the stray request is dropped, not kept for later")
        self.assertEqual(developer._PREMIUM_SEEN, [])

    def test_paid_rescue_is_never_possible(self):
        self.assertFalse(developer.PAID_INFERENCE_ALLOWED)
        for current in (None, journal(), journal(premium_steps=set())):
            handle = recovery.CURRENT.set(current)
            try:
                with patch.dict(os.environ, ROUTER, clear=False):
                    for step in ("check", "proposal"):
                        self.assertFalse(developer.premium_possible(step))
                        self.assertEqual(developer.premium_rescue_step(step, "no_validated_proposal", lambda: self.fail("no paid attempt")),
                                         (None, False))
            finally:
                recovery.CURRENT.reset(handle)

    def check(self, current, review, generate, problems_after=None):
        class Progress:
            def now(self, *a, **k): pass
            def ok(self, *a, **k): pass
        from engine import verify
        outcomes = []
        wiring = iter(problems_after or [])
        handle = recovery.CURRENT.set(current)
        developer.UNFINISHED[:] = []
        try:
            with patch.dict(os.environ, ROUTER, clear=False), \
                 patch.object(verify, "wiring_problems", side_effect=lambda *a, **k: list(next(wiring, ["Broken wiring in app.py"]))), \
                 patch.object(verify, "model_review", side_effect=review), patch.object(developer, "note"), \
                 patch.object(developer, "generate", side_effect=generate), \
                 patch.object(runner, "premium_outcome", side_effect=lambda *a: outcomes.append(a)):
                _, _, problems = developer.check_the_work("key", "Fix", "onlykappa/KappaForge", "a" * 40, "token", {"app.py": "x\n"},
                                                          {"app.py": 2}, {"app.py": "y\n"}, "", None, "", False, Progress())
        finally:
            recovery.CURRENT.reset(handle)
        return problems, outcomes

    def test_exhausted_free_check_rounds_stop_without_any_paid_rescue(self):
        current = journal()
        asked = []

        def generate(*_args, **_kwargs):
            asked.append(getattr(current, "premium_request", None))
            raise ValueError("cannot repair")

        reviews = lambda *a, **k: ([{"text": "works", "met": True}], [], [])
        rounds = [["Broken wiring in app.py"]] * (developer.MAX_CHECK_ROUNDS + 2)
        problems, outcomes = self.check(current, reviews, generate, rounds)
        self.assertEqual(asked, [None] * developer.MAX_CHECK_ROUNDS, "only the free rounds run")
        self.assertTrue(problems, "the unresolved problem is reported honestly")
        self.assertEqual(outcomes, [], "nothing paid was sent, so there is no outcome to report")

    def test_no_rescue_when_the_free_review_was_unavailable(self):
        current = journal()
        calls = []

        def generate(*_args, **_kwargs):
            calls.append(getattr(current, "premium_request", None))
            raise ValueError("cannot repair")

        self.check(current, lambda *a, **k: None, generate)
        self.assertEqual(calls, [None] * developer.MAX_CHECK_ROUNDS, "a capacity problem is not a reason for premium")


if __name__ == "__main__":
    unittest.main()

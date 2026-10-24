"""Premium rescue on the engine side: free first, a quote before any dispatch, one rescue per blocked step, the
re-check that decides whether it solved the step, and every later call free. The gateway is mocked."""
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

    def test_a_refused_quote_sends_nothing_and_the_rescue_is_one_shot(self):
        current = journal(premium_request={"step": "check", "reason": "check_rounds_exhausted"})
        sent, quotes = self.call(current, quote={"refused": "premium_off", "step": "check", "model": "qwen/qwen3-coder", "maxUsd": 0.05, "taskLeftUsd": 1})
        self.assertEqual(sent, [], "nothing is sent when the gateway does not allow the rescue")
        self.assertTrue(quotes[0]["premium"]["quote"])
        self.assertIsNone(current.premium_request, "the rescue request is used once")
        self.assertIn("Premium rescue recommended", developer._PREMIUM_SEEN[-1])
        self.assertIn("Nothing was charged", developer._PREMIUM_SEEN[-1])
        self.assertLessEqual(len(developer._PREMIUM_SEEN[-1]), 200, "fits one feed line")

    def test_an_eligible_quote_dispatches_the_rescue_once_and_then_calls_are_free(self):
        current = journal(premium_request={"step": "check", "reason": "check_rounds_exhausted"})
        answer = {"route": "openrouter:qwen/qwen3-coder", "text": "premium answer",
                  "premium": {"dispatched": True, "model": "qwen/qwen3-coder", "usd": 0.0123, "billing": "confirmed"}}
        sent, quotes = self.call(current, quote={"eligible": True, "quote": True, "step": "check", "model": "qwen/qwen3-coder", "maxUsd": 0.05}, answer=answer)
        self.assertEqual(sent[0]["premium"], {"task": 42, "step": "check", "reason": "check_rounds_exhausted"})
        self.assertEqual(developer._PREMIUM_SEEN[-2], "Premium rescue for fixing what the check found (free models could not finish it): qwen/qwen3-coder, at most $0.05")
        self.assertEqual(developer._PREMIUM_SEEN[-1], "Premium rescue answered: qwen/qwen3-coder · $0.0123 charged")
        sent, quotes = self.call(current)
        self.assertNotIn("premium", sent[0])
        self.assertEqual(quotes, [])

    def test_a_stale_context_before_the_quote_keeps_the_rescue_for_the_reconciled_retry(self):
        from engine import task_state
        current = journal(premium_request={"step": "check", "reason": "check_rounds_exhausted"})
        stale = task_state.CandidateChanged("Inference context changed")
        with patch("engine.task_state.inference_attempt", side_effect=stale):
            with self.assertRaises(task_state.CandidateChanged):
                self.call(current)
        self.assertEqual(current.premium_request, {"step": "check", "reason": "check_rounds_exhausted"},
                         "nothing was sent, so the step keeps its one rescue")

    def test_no_rescue_outside_a_gateway_task_or_twice_for_a_step(self):
        handle = recovery.CURRENT.set(None)
        try:
            with patch.dict(os.environ, ROUTER, clear=False):
                self.assertFalse(developer.premium_possible("check"))
        finally:
            recovery.CURRENT.reset(handle)
        current = journal(premium_steps={"check"})
        handle = recovery.CURRENT.set(current)
        try:
            with patch.dict(os.environ, ROUTER, clear=False):
                self.assertFalse(developer.premium_possible("check"))
                self.assertTrue(developer.premium_possible("proposal"))
            with patch.dict(os.environ, {"KAPPA_ROUTER_REQUIRED": "false"}, clear=False):
                self.assertFalse(developer.premium_possible("proposal"), "only the gateway path can carry a rescue")
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

    def test_free_rounds_first_then_one_rescue_whose_free_recheck_decides_the_outcome(self):
        current = journal()
        asked = []

        def generate(*_args, **_kwargs):
            asked.append(getattr(current, "premium_request", None))
            if getattr(current, "premium_request", None):
                current.premium_request = None  # The runner takes it on the first call.
                current.premium_last = {"dispatched": True}
                return "openrouter:qwen", "fixed", {"app.py": "fixed\n"}, ""
            raise ValueError("cannot repair")

        reviews = lambda *a, **k: ([{"text": "works", "met": True}], [], [])
        rounds = [["Broken wiring in app.py"]] * (developer.MAX_CHECK_ROUNDS + 1) + [[]]
        problems, outcomes = self.check(current, reviews, generate, rounds)
        self.assertEqual(asked[:developer.MAX_CHECK_ROUNDS], [None] * developer.MAX_CHECK_ROUNDS, "every free round runs first")
        self.assertEqual(asked[-1], {"step": "check", "reason": "check_rounds_exhausted"})
        self.assertEqual(problems, [])
        self.assertEqual(outcomes, [(42, "check", "solved")], "solved only because the free re-check passed")

    def test_a_refused_rescue_ends_the_step_without_more_calls(self):
        current = journal()
        calls = []

        def generate(*_args, **_kwargs):
            calls.append(getattr(current, "premium_request", None))
            if getattr(current, "premium_request", None):
                current.premium_request = None
                current.premium_last = {"refused": "premium_off"}
                raise runner.PremiumNotUsed({"refused": "premium_off"})
            raise ValueError("cannot repair")

        reviews = lambda *a, **k: ([{"text": "works", "met": True}], [], [])
        problems, outcomes = self.check(current, reviews, generate)
        self.assertEqual(len(calls), developer.MAX_CHECK_ROUNDS + 1)
        self.assertTrue(problems)
        self.assertEqual(outcomes, [], "nothing was sent, so there is no outcome to report")

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

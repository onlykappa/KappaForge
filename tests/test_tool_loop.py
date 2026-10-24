import unittest
import json
from engine.tool_loop import run_tool_loop


class FakeModel:
    """Simple callable that yields predefined responses for each call."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, prompt, api_key):
        # Record the prompt for potential debugging (not used in assertions)
        self.calls.append(prompt)
        if not self._responses:
            raise AssertionError("No more fake responses available")
        return self._responses.pop(0)


def echo_tool(args):
    return {"status": "ok", "output": args.get("msg", "")}


def unavailable_tool(args):
    return {"status": "unavailable"}


def error_tool(args):
    raise RuntimeError("boom")


class TestToolLoop(unittest.TestCase):
    def test_done_immediately(self):
        model = FakeModel([json.dumps({"done": True, "summary": "All done"})])
        result = run_tool_loop(model, "key", "test task", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "done")
        self.assertEqual(result["summary"], "All done")
        self.assertEqual(result["steps"], [])
        self.assertEqual(len(result["models"]), 1)

    def test_invalid_json_three_times(self):
        model = FakeModel(["not json", "{bad", "{\"tool\": \"echo\", \"args\": 123}"])
        result = run_tool_loop(model, "k", "t", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "invalid_limit")
        self.assertEqual(len(result["steps"]), 3)
        for step in result["steps"]:
            self.assertEqual(step["result"]["status"], "invalid")

    def test_unknown_tool(self):
        reply = json.dumps({"tool": "unknown", "args": {}, "reason": "test"})
        model = FakeModel([reply, reply, reply])
        result = run_tool_loop(model, "k", "t", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "invalid_limit")
        self.assertTrue(all(s["result"]["status"] == "invalid" for s in result["steps"]))

    def test_args_not_object(self):
        reply = json.dumps({"tool": "echo", "args": "not a dict", "reason": "test"})
        model = FakeModel([reply, reply, reply])
        result = run_tool_loop(model, "k", "t", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "invalid_limit")

    def test_unavailable_stops(self):
        reply = json.dumps({"tool": "unavail", "args": {}, "reason": "test"})
        model = FakeModel([reply])
        result = run_tool_loop(model, "k", "t", {"unavail": unavailable_tool})
        self.assertEqual(result["stop_reason"], "unavailable")
        self.assertEqual(len(result["steps"]), 1)
        self.assertEqual(result["steps"][0]["result"]["status"], "unavailable")

    def test_repeated_tool_stops(self):
        reply = json.dumps({"tool": "echo", "args": {"msg": "hi"}, "reason": "test"})
        model = FakeModel([reply, reply, reply])
        result = run_tool_loop(model, "k", "t", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "repeated")
        self.assertEqual(len(result["steps"]), 3)
        self.assertTrue(all(s["result"]["status"] == "ok" for s in result["steps"]))

    def test_tool_exception_becomes_error(self):
        reply = json.dumps({"tool": "boom", "args": {}, "reason": "test"})
        model = FakeModel([reply, json.dumps({"done": True, "summary": "finished"})])
        result = run_tool_loop(model, "k", "t", {"boom": error_tool})
        self.assertEqual(result["stop_reason"], "done")
        self.assertEqual(result["steps"][0]["result"]["status"], "error")
        self.assertIn("boom", result["steps"][0]["result"]["error"])

    def test_max_steps(self):
        # Provide a valid echo reply many times; loop should stop after max_steps (default 20)
        reply = json.dumps({"tool": "echo", "args": {"msg": "x"}, "reason": "test"})
        model = FakeModel([reply] * 25)
        result = run_tool_loop(model, "k", "t", {"echo": echo_tool})
        self.assertEqual(result["stop_reason"], "max_steps")
        self.assertEqual(len(result["steps"]), 20)

if __name__ == "__main__":
    unittest.main()

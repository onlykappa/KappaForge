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


class GatewayScript:
    """The engine's actual run_model protocol: key first, (route, text) returned."""

    def __init__(self, replies):
        self.replies = iter(replies)
        self.prompts = []
        self.options = []

    def __call__(self, api_key, prompt, **kwargs):
        if api_key != 'review-key':
            raise AssertionError('run_model requires api_key first and prompt second')
        self.prompts.append(prompt)
        self.options.append(kwargs)
        reply = next(self.replies)
        return 'scripted:review', reply if isinstance(reply, str) else json.dumps(reply)


def tool_reply(name, args=None):
    return {'tool': name, 'args': {} if args is None else args, 'reason': 'review the candidate'}


class ToolLoopReviewerTests(unittest.TestCase):
    def test_engine_model_protocol_and_provider_allowlist_are_preserved(self):
        model = GatewayScript([{'done': True, 'summary': 'checked'}])
        result = run_tool_loop(model, 'review-key', 'task', {}, allowed=['ollama', 'mistral'])
        self.assertEqual(result['stop_reason'], 'done')
        self.assertEqual(result['summary'], 'checked')
        self.assertIn('scripted:review', result['models'])
        self.assertEqual(model.options[0]['allowed'], ['ollama', 'mistral'])
        self.assertTrue(model.options[0]['json_mode'])
        self.assertNotIn('review-key', model.prompts[0])

    def test_only_the_seven_sandbox_tools_can_be_invoked(self):
        calls = []
        model = GatewayScript([tool_reply('delete_everything')] * 3)
        result = run_tool_loop(model, 'review-key', 'task', {
            'delete_everything': lambda **args: calls.append(args) or {'status': 'ok'},
        })
        self.assertEqual(calls, [])
        self.assertEqual(len(model.prompts), 3)
        self.assertTrue(all(row['result']['status'] == 'invalid' for row in result['steps']))

    def test_invalid_feedback_is_in_the_next_prompt_and_resets_after_valid_calls(self):
        model = GatewayScript([
            'not json', tool_reply('unknown'), tool_reply('inspect_diff'),
            'not json', tool_reply('inspect_diff', []), {'done': True, 'summary': 'recovered'},
        ])
        result = run_tool_loop(model, 'review-key', 'repair the candidate', {
            'inspect_diff': lambda **args: {'ok': True, 'status': 'ok', 'diff': '+fixed'},
        })
        self.assertEqual(result['stop_reason'], 'done')
        self.assertIn('invalid', model.prompts[1])
        self.assertIn('inspect_diff', model.prompts[3])
        self.assertIn('+fixed', model.prompts[3])
        self.assertIn('JSON', model.prompts[0])
        self.assertIn('summary', model.prompts[0])
        self.assertTrue(all('repair the candidate' in p for p in model.prompts))

    def test_real_sandbox_methods_receive_keyword_arguments_and_edit_the_candidate(self):
        from engine import sandbox
        from engine.sandbox_tools import SandboxTools
        from tests.test_sandbox import FakeDocker
        session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, {'app.py': b'x = 1\n'}),
                                  FakeDocker(), versions=('3.12', '22'))
        tools = SandboxTools(session)
        model = GatewayScript([
            tool_reply('apply_patch', {'edits': [{'path': 'app.py', 'find': 'x = 1', 'replace': 'x = 2'}]}),
            tool_reply('inspect_diff'), {'done': True, 'summary': 'edited'},
        ])
        result = run_tool_loop(model, 'review-key', 'change x', {
            'apply_patch': tools.apply_patch, 'inspect_diff': tools.inspect_diff,
        })
        self.assertEqual(result['stop_reason'], 'done')
        self.assertEqual(session.current()['app.py'], b'x = 2\n')
        self.assertEqual(result['steps'][0]['result']['status'], 'applied')
        self.assertIn('+x = 2', model.prompts[2])

    def test_provider_names_do_not_filter_tool_names(self):
        model = GatewayScript([tool_reply('inspect_diff'), {'done': True, 'summary': 'read'}])
        calls = []
        result = run_tool_loop(model, 'review-key', 'task', {
            'inspect_diff': lambda **args: calls.append(args) or {'status': 'ok'},
        }, allowed=['ollama'])
        self.assertEqual(result['stop_reason'], 'done')
        self.assertEqual(calls, [{}])

    def test_canonical_args_repeat_but_changing_status_breaks_the_streak(self):
        statuses = iter(['failed', 'passed', 'passed', 'passed'])
        model = GatewayScript([tool_reply('read_execution_log', a) for a in (
            {'offset': 0, 'limit': 10}, {'limit': 10, 'offset': 0},
            {'offset': 0, 'limit': 10}, {'limit': 10, 'offset': 0},
        )])
        result = run_tool_loop(model, 'review-key', 'task', {
            'read_execution_log': lambda **args: {'status': next(statuses)},
        })
        self.assertEqual(result['stop_reason'], 'repeated')
        self.assertEqual(len(result['steps']), 4)

    def test_unavailable_stops_without_another_model_call_and_exceptions_are_errors(self):
        def broken(**args):
            raise RuntimeError('review tool error')
        model = GatewayScript([tool_reply('inspect_diff'), tool_reply('run_tests')])
        result = run_tool_loop(model, 'review-key', 'task', {
            'inspect_diff': broken, 'run_tests': lambda **args: {'status': 'unavailable'},
        })
        self.assertEqual(result['stop_reason'], 'unavailable')
        self.assertEqual(len(model.prompts), 2)
        self.assertEqual(result['steps'][0]['result']['status'], 'error')
        self.assertIn('review tool error', model.prompts[1])

    def test_history_and_each_serialized_tool_result_are_bounded(self):
        model = GatewayScript([tool_reply('read_execution_log', {'offset': i}) for i in range(15)] +
                              [{'done': True, 'summary': 'inspected'}])
        result = run_tool_loop(model, 'review-key', 'task', {
            'read_execution_log': lambda **args: {'status': 'ok', 'output': 'x' * 10000},
        })
        self.assertEqual(result['stop_reason'], 'done')
        # Fixed prompt/catalog overhead is small; no prompt may grow with unbounded history.
        overhead = len(model.prompts[0])
        self.assertTrue(all(len(p) <= overhead + 30000 for p in model.prompts))
        self.assertLessEqual(len(model.prompts[1]) - overhead, 3500)

    def test_max_steps_uses_distinct_calls_so_repeat_detection_does_not_mask_it(self):
        model = GatewayScript([tool_reply('read_execution_log', {'offset': i}) for i in range(20)])
        result = run_tool_loop(model, 'review-key', 'task', {
            'read_execution_log': lambda **args: {'status': 'ok'},
        }, max_steps=20)
        self.assertEqual(result['stop_reason'], 'max_steps')
        self.assertEqual(len(result['steps']), 20)
        self.assertEqual(len(model.prompts), 20)

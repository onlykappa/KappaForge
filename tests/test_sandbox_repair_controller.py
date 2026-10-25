import io
import json
import tarfile
import unittest
from unittest.mock import Mock

from engine import sandbox, sandbox_repair_controller, sandbox_tools


class FakeDocker(sandbox.Docker):
    """Recording Docker boundary; reads candidate tarballs but never executes repository code."""
    def __init__(self, always_fail=False, zero_tests=False, vary_failure=False, skipped_tests=False):
        self.calls = []
        self.always_fail = always_fail
        self.zero_tests = zero_tests
        self.vary_failure = vary_failure
        self.skipped_tests = skipped_tests

    def call(self, args, stdin=b"", timeout=60, limit=64_000, on_timeout=None):
        self.calls.append((list(args), stdin, timeout, limit, on_timeout))
        if args[:1] != ["run"]:
            return sandbox.Exec(0, "", "")
        files = {}
        try:
            with tarfile.open(fileobj=io.BytesIO(stdin), mode="r:*") as archive:
                files = {member.name: archive.extractfile(member).read()
                         for member in archive if member.isfile()}
        except tarfile.TarError:
            pass
        command = args[-2:]
        is_node = "npm" in args or "node" in args
        passed = not self.always_fail and b"value=2" in files.get("app.py", b"")
        if self.zero_tests:
            output = "Ran 0 tests in 0.000s\n\nOK\n"
        elif self.skipped_tests:
            output = "Ran 1 test in 0.001s\n\nOK (skipped=1)\n"
        elif is_node:
            output = "# tests 1\n# pass 1\n# fail 0\n" if passed else "# tests 1\n# pass 0\n# fail 1\n"
        else:
            output = "Ran 1 test in 0.001s\n\nOK\n" if passed else (
                "Ran 1 test in 0.001s\n\nFAILED (failures=1)\n" +
                (files.get("app.py", b"").decode("utf-8", "replace") if self.vary_failure else "same assertion"))
        return sandbox.Exec(0 if passed else 1, output, "")


def fixture_tree(docker=None, files=None):
    original = {"app.py": b"value=1\n", "tests/test_app.py": b"import unittest\nclass T(unittest.TestCase):\n    def test_value(self): self.assertEqual(2, 2)\n"}
    original.update(files or {})
    return sandbox.Session(sandbox.Tree("repo", "a" * 40, original), docker=docker or FakeDocker())


def model_reply(reply):
    return lambda *args, **kwargs: ("free:test-model", json.dumps(reply))


class TestSandboxRepairController(unittest.TestCase):
    def setUp(self):
        self.session = fixture_tree()
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)

    def test_generated_candidate_passes_then_gets_a_fresh_full_regression(self):
        result = self.controller.run_repair("repair the app", model_reply({}), "key",
                                            initial_changes={"app.py": "value=2\n"})
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["stop_reason"], "validated")
        self.assertEqual(len(result["attempts"]), 1)
        self.assertEqual(result["attempts"][0]["why_different"], "Initial generated candidate")
        test_runs = [call for call in self.session.docker.calls if call[0][:1] == ["run"]]
        self.assertEqual(len(test_runs), 2, "candidate tests plus a fresh final regression")
        self.assertTrue(self.session.closed)

    def test_model_repairs_the_real_session_candidate_and_records_why(self):
        reply = {"tool": "apply_patch", "args": {"edits": [
            {"path": "app.py", "find": "value=1", "replace": "value=2"}]},
            "reason": "The failing assertion requires value 2; correct the implementation."}
        result = self.controller.run_repair("make the tests pass", model_reply(reply), "key")
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["attempts"]), 1)
        self.assertIn("correct the implementation", result["attempts"][0]["rationale"])
        self.assertIn("differs from the failing base state", result["attempts"][0]["why_different"])
        self.assertEqual(result["candidate_changes"], {"app.py": "value=2\n"})

    def test_identical_test_error_stops_after_one_repair(self):
        reply = {"tool": "apply_patch", "args": {"edits": [
            {"path": "app.py", "find": "value=1", "replace": "value=3"}]}, "reason": "Try another value"}
        result = self.controller.run_repair("repair", model_reply(reply), "key")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["stop_reason"], "identical_error")
        self.assertEqual(len(result["attempts"]), 1)
        self.assertIn("value=3", result["last_diff"])

    def test_repeated_tool_call_stops_without_counting_a_candidate(self):
        reply = {"tool": "apply_patch", "args": {"edits": [
            {"path": "app.py", "find": "missing", "replace": "value=2"}]}, "reason": "repeat"}
        result = self.controller.run_repair("repair", model_reply(reply), "key")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["stop_reason"], "repeated_tool_call")
        self.assertEqual(result["attempts"], [])

    def test_attempt_limit_counts_changed_candidates_not_model_actions(self):
        docker = FakeDocker(always_fail=True, vary_failure=True)
        session = fixture_tree(docker, {"app.py": b"a1\na2\na3\na4\na5\n"})
        controller = sandbox_repair_controller.SandboxRepairController(session)
        calls = 0

        def scripted(*args, **kwargs):
            nonlocal calls
            calls += 1
            old = "a" + str(calls)
            reply = {"tool": "apply_patch", "args": {"edits": [
                {"path": "app.py", "find": old, "replace": old + "_fixed"}]}, "reason": "Change " + old}
            return "free:test-model", json.dumps(reply)

        result = controller.run_repair("repair", scripted, "key")
        self.assertEqual(result["stop_reason"], "attempt_limit")
        self.assertEqual(len(result["attempts"]), 5)
        self.assertEqual(calls, 5)
        self.assertTrue(all(row["why_different"] for row in result["attempts"]))

    def test_zero_discovered_tests_do_not_establish_success(self):
        session = fixture_tree(ZeroTestDocker())
        controller = sandbox_repair_controller.SandboxRepairController(session)
        result = controller.run_repair("repair", model_reply({}), "key",
                                       initial_changes={"app.py": "value=2\n"})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["stop_reason"], "no_tests_discovered")

    def test_edits_beyond_the_display_diff_limit_still_count_as_distinct_attempts(self):
        work = fixture_tree(FakeDocker(always_fail=True, vary_failure=True))
        controller = sandbox_repair_controller.SandboxRepairController(work)
        count = 0
        def next_patch(*args, **kwargs):
            nonlocal count
            previous = 3 + count
            count += 1
            return 'free:repair', json.dumps(dict(tool='apply_patch', reason='Change the failing value', args=dict(edits=[
                dict(path='app.py', find='value=' + str(previous), replace='value=' + str(previous + 1))])))
        result = controller.run_repair('repair', next_patch, 'key', {'app.py': '#' + 'x' * 25000 + '\nvalue=3\n'})
        self.assertEqual(result['stop_reason'], 'attempt_limit')
        self.assertEqual(len(result['attempts']), 5)
        self.assertEqual(count, 4, 'the generated candidate plus four different repair candidates use the five attempts')
        self.assertEqual(len({a['fingerprint'] for a in result['attempts']}), 5)

    def test_all_skipped_tests_do_not_establish_success(self):
        session = fixture_tree(FakeDocker(skipped_tests=True))
        controller = sandbox_repair_controller.SandboxRepairController(session)
        result = controller.run_repair("repair", model_reply({}), "key",
                                       initial_changes={"app.py": "value=2\n"})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["stop_reason"], "no_tests_passed")

    def test_error_fingerprint_ignores_test_run_durations(self):
        first = [{"status": "failed", "argv": ["python", "-m", "unittest"], "exit_code": 1,
                  "output": "Ran 1 test in 0.001s\\nFAILED (failures=1)\\nAssertionError: 1 != 2"}]
        second = [{**first[0], "output": "Ran 1 test in 0.983s\\nFAILED (failures=1)\\nAssertionError: 1 != 2"}]
        self.assertEqual(sandbox_repair_controller._failure_key(first),
                         sandbox_repair_controller._failure_key(second))

    def test_session_cleanup_runs_when_model_raises(self):
        self.session.close = Mock()
        def broken(*args, **kwargs):
            raise RuntimeError("provider failed")
        result = self.controller.run_repair("repair", broken, "key")
        self.assertEqual(result["stop_reason"], "controller_error")
        self.session.close.assert_called_once()

    def test_real_session_and_tools_use_docker_exec_contract(self):
        session = sandbox.Session(sandbox.Tree("repo", "a" * 40, {
            "tests/test_smoke.py": b"pass\n"}), docker=FakeDocker(), versions=("3.13", "22"))
        tools = sandbox_tools.SandboxTools(session)
        result = tools.run_tests()
        self.assertEqual(result["status"], "ok")
        run_calls = [call for call in session.docker.calls if call[0][:1] == ["run"]]
        self.assertEqual(len(run_calls), 1)
        self.assertEqual(run_calls[0][2], 900)


class ZeroTestDocker(FakeDocker):
    def __init__(self):
        super().__init__(zero_tests=True)


if __name__ == "__main__":
    unittest.main()

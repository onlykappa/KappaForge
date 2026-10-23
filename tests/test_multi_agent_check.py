"""The live multi-agent check runs generated code only in sandbox containers and fails when the experiment fails."""
import os
import shutil
import subprocess
import unittest
from unittest.mock import patch

from engine import developer
from tools import multi_agent_check as check


def docker_works():
    try:
        return bool(shutil.which("docker")) and subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


class SandboxCommandTests(unittest.TestCase):
    def test_paths_that_leave_the_project_are_refused_before_docker_runs(self):
        for name in ("../escape.py", "/etc/passwd", "a/../../b.py", "a\\b.py", "a//b.py", "./a.py", ""):
            with patch.object(check.subprocess, "run") as run, self.assertRaises(ValueError, msg=name):
                check.run_in_sandbox({name: "x"}, "python:3.13-slim", ["true"])
            run.assert_not_called()

    def test_generated_code_runs_without_network_environment_or_write_access(self):
        calls = []
        with patch.object(check.subprocess, "run", side_effect=lambda cmd, **kw: calls.append((cmd, kw)) or
                          subprocess.CompletedProcess(cmd, 0, "", "")):
            check.run_in_sandbox({"tests/test_a.py": "x"}, "python:3.13-slim", ["python", "-m", "unittest"])
        bootstrap, execute = calls[1][0], calls[2][0]
        self.assertIn("python:3.13-slim", bootstrap)
        self.assertNotIn("x", bootstrap, "file text is streamed on stdin, never on the command line")
        for flag in ("--network", "--read-only", "--cap-drop", "--pids-limit", "--memory"):
            self.assertIn(flag, execute)
        self.assertEqual(execute[execute.index("--network") + 1], "none")
        self.assertTrue(any(part.endswith(",readonly") for part in execute), "the project is mounted read-only")
        self.assertEqual(execute[execute.index("--user") + 1], "65534:65534")
        for cmd, kw in calls:
            self.assertFalse({"-e", "--env", "--env-file", "-v", "--volume", "--privileged"} & set(cmd), cmd)
            self.assertNotIn("env", kw, "the runner environment is never handed to a container")
        self.assertEqual([c[0][:3] for c in calls[-2:]], [["docker", "rm", "-f"], ["docker", "volume", "rm"]])

    def test_tests_never_run_as_plain_runner_processes(self):
        with patch.object(check, "run_in_sandbox", return_value=subprocess.CompletedProcess([], 0, "ok", "")) as sandbox:
            result = check.run_tests({"tests/test_a.py": "", "web/a.test.mjs": ""})
        self.assertEqual([c.args[1] for c in sandbox.call_args_list], ["python:3.13-slim", "node:22-slim"])
        self.assertTrue(result["python"]["passed"] and result["javascript"]["passed"])


class ExitStatusTests(unittest.TestCase):
    def test_only_a_finished_passing_run_exits_zero(self):
        self.assertEqual(check.exit_code({"ok": True, "unfinished": []}), 0)
        self.assertEqual(check.exit_code({"ok": True, "unfinished": [], "tests": {"python": {"passed": True}, "javascript": None}}), 0)
        self.assertEqual(check.exit_code({"ok": False, "error": "boom"}), 1)
        self.assertEqual(check.exit_code({"ok": True, "unfinished": ["stage 2"]}), 1)
        self.assertEqual(check.exit_code({"ok": True, "unfinished": [], "tests": {"python": {"passed": False}, "javascript": None}}), 1)

    def test_a_failed_generation_makes_the_process_fail(self):
        # main() wraps developer.generate and review_stage; patching them restores the originals afterwards.
        with patch.object(developer, "build_in_stages", side_effect=RuntimeError("gateway down")), \
                patch.object(developer, "generate", developer.generate), patch.object(developer, "review_stage", developer.review_stage), \
                patch("builtins.print"), patch.dict(os.environ, {"MULTI_AGENT_SCENARIO": "simple"}):
            self.assertEqual(check.main(), 1)


@unittest.skipUnless(docker_works(), "Docker runs on the GitHub runner")
class SandboxCanaryTests(unittest.TestCase):
    """Real containers: host secrets are absent, networking fails and the project cannot be changed."""

    def test_sandbox_hides_credentials_blocks_network_and_writes(self):
        probe = (
            "import os, socket, unittest\n\n\nclass Canary(unittest.TestCase):\n"
            "    def test_boundary(self):\n"
            "        self.assertNotIn('KAPPA_CANARY_SECRET', os.environ)\n"
            "        self.assertNotIn('GITHUB_TOKEN', os.environ)\n"
            "        with self.assertRaises(OSError):\n"
            "            socket.create_connection(('1.1.1.1', 443), timeout=3)\n"
            "        with self.assertRaises(OSError):\n"
            "            open('tests/written.txt', 'w')\n")
        with patch.dict(os.environ, {"KAPPA_CANARY_SECRET": "must-not-leak"}):
            result = check.run_tests({"tests/__init__.py": "", "tests/test_canary.py": probe})
        self.assertTrue(result["python"]["passed"], result["python"]["output"])


if __name__ == "__main__":
    unittest.main()

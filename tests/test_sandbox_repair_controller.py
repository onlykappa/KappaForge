import unittest
from unittest.mock import Mock
from engine import sandbox, sandbox_repair_controller, sandbox_tools

class FakeDocker(sandbox.Docker):
    # stand-in: Real Docker needs a daemon; this fake follows its call signature and sandbox.Exec result contract.
    def __init__(self):
        self.calls = []
    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
        self.calls.append((list(args), stdin, timeout, limit, on_timeout))
        return sandbox.Exec(0, 'ok\n', '')
    def available(self):
        return True

class TestSandboxRepairController(unittest.TestCase):
    def setUp(self):
        self.base = sandbox.Tree('repo', 'sha', {})
        self.session = sandbox.Session(self.base, docker=FakeDocker())
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)

    def test_attempt_limit(self):
        self.base = sandbox.Tree('repo', 'sha', {'test_file.py': b'line1\nline2\nline3\nline4\nline5\n'})
        self.session = sandbox.Session(self.base, docker=FakeDocker())
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)
        self.call_count = 0
        def mock_model(*args, **kwargs):
            self.call_count += 1
            return 'route', '{"done":false, "tool":"apply_patch", "args":{"edits":[{"path":"test_file.py", "find":"line' + str(self.call_count) + '", "replace":"changed' + str(self.call_count) + '"}]}, "reason":"fail"}'
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(len(self.controller.attempts), 5)

    def test_success_verification(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.tools.run_tests = lambda: {'ok': True, 'passed': True}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'success')

    def test_deduplication(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":false, "tool":"apply_patch", "args":{"edits":[{"path":"test_file.py", "find":"old_code", "replace":"new_code"}]}, "reason":"fail"}'
        self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_session_cleanup(self):
        from unittest.mock import Mock
        self.session.close = Mock()
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.run_repair('task', mock_model, 'key')
        self.session.close.assert_called_once()

    def test_dishonest_model_done(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.tools.run_tests = lambda: {'ok': True, 'passed': False}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_unavailable_outcome(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"tool":"run_command", "args":{"argv":["ls"]}, "reason":"fail"}'
        self.controller.tools.run_command = lambda **kwargs: {'ok': False, 'status': 'unavailable'}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_real_session_and_tools_use_docker_exec_contract(self):
        session = sandbox.Session(
            sandbox.Tree('repo', 'sha', {'tests/test_smoke.py': b'pass\\n'}),
            docker=FakeDocker(),
            versions=('3.13', '22'),
        )
        tools = sandbox_tools.SandboxTools(session)

        result = tools.run_tests()

        self.assertEqual(result['status'], 'ok')
        self.assertTrue(result['passed'])
        run_calls = [call for call in session.docker.calls if call[0][:1] == ['run']]
        self.assertEqual(len(run_calls), 1)
        self.assertEqual(run_calls[0][2], 900)

import unittest
from engine import sandbox, sandbox_repair_controller, sandbox_tools

class FakeDocker(sandbox.Docker):
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
        def mock_model(*args, **kwargs):
            return 'route', '{"done":false, "tool":"run_command", "args":{"argv":["ls"]}, "reason":"fail"}'
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['last_attempt'], 5)

    def test_success_verification(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.tools.run_tests = lambda: {'ok': True, 'passed': True}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'success')

    def test_deduplication(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":false, "tool":"run_command", "args":{"argv":["ls"]}, "reason":"fail"}'
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_session_cleanup(self):
        self.session.close = unittest.mock.Mock()
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.run_repair('task', mock_model, 'key')
        self.session.close.assert_called_once()
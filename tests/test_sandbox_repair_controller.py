import unittest
from engine import sandbox, sandbox_repair_controller, sandbox_tools

class FakeDocker(sandbox.Docker):
    # stand-in: Real Docker requires a running daemon and host-side environment; this matches the interface for unit testing.
    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
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

    def test_dishonest_model_done(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        self.controller.tools.run_tests = lambda: {'ok': True, 'passed': False}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')

    def test_unavailable_outcome(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"tool":"run_command", "args":{"argv":["ls"]}, "reason":"fail"}'
        self.controller.tools.run_command = lambda **kwargs: {'ok': False, 'status': 'unavailable'}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')
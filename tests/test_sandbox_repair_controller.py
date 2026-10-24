import unittest
from engine import sandbox, sandbox_repair_controller

class FakeDocker:
    def call(self, args, **kwargs):
        class Proc: returncode = 0
        return Proc()
    def available(self): return True

class TestSandboxRepairController(unittest.TestCase):
    def setUp(self):
        self.base = sandbox.Tree('repo', 'sha', {})
        self.session = sandbox.Session(self.base, docker=FakeDocker())
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)

    def test_attempt_limit(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":false, "tool":"run_tests", "args":{}, "reason":"fail"}'
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['last_attempt'], 5)

    def test_success_verification(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"done":true, "summary":"fixed"}'
        # Mock run_tests to return passed
        self.controller.tools.run_tests = lambda: {'ok': True, 'passed': True}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'success')
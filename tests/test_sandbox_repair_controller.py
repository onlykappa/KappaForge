import unittest
from engine import sandbox, sandbox_repair_controller, sandbox_tools

class FakeDocker(sandbox.Docker):
    """# stand-in: preserve Docker.call's arguments and Exec result contract without a daemon."""
    def __init__(self):
        self.calls = []

    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
        self.calls.append((list(args), stdin, timeout, limit, on_timeout))
        return sandbox.Exec(0, 'ok\\n', '')

    def available(self):
        return True

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

    def test_real_session_and_tools_use_the_docker_exec_contract(self):
        # The real Session must discover and run this test command through SandboxTools.
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

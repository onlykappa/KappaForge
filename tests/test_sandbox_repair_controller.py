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


class ZeroTestDocker(FakeDocker):
    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
        self.calls.append((list(args), stdin, timeout, limit, on_timeout))
        return sandbox.Exec(0, 'Ran 0 tests in 0.000s\n\nOK\n', '')

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
            return 'route', '{"done":false, "tool":"apply_patch", "args":{"edits":[{"path":"test_file.py", "find":"line' + str(self.call_count) + '", "replace":"line' + str(self.call_count) + '_changed"}]}, "reason":"fail"}'
        self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(len(self.controller.attempts), 5)
        self.assertEqual([attempt['index'] for attempt in self.controller.attempts], [1, 2, 3, 4, 5])
        self.assertTrue(all(attempt['changed_paths'] == ['test_file.py'] for attempt in self.controller.attempts))

    def _seed_candidate(self):
        self.session = sandbox.Session(
            sandbox.Tree('repo', 'sha', {'app.py': b'value=1\n'}), docker=FakeDocker())
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)

    def _patch_then_done(self):
        calls = 0
        def run_model(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                reply = '{"tool":"apply_patch","args":{"edits":[{"path":"app.py","find":"value=1","replace":"value=2"}]},"reason":"make candidate"}'
            else:
                reply = '{"done":true,"summary":"candidate ready"}'
            return 'route', reply
        return run_model

    def test_success_verification(self):
        self._seed_candidate()
        mock_model = self._patch_then_done()
        calls = []
        def run_tests():
            calls.append('tests')
            return {'ok': True, 'status': 'ok', 'passed': True,
                    'results': [{'status': 'passed', 'ran': 1, 'output': 'Ran 1 test in 0.001s\nOK'}]}
        self.controller.tools.run_tests = run_tests
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'success')
        self.assertEqual(calls, ['tests', 'tests'], 'success requires a fresh final regression run')

    def test_deduplication(self):
        self.session = sandbox.Session(
            sandbox.Tree('repo', 'sha', {'test_file.py': b'old_code\n'}), docker=FakeDocker())
        self.controller = sandbox_repair_controller.SandboxRepairController(self.session)
        def mock_model(*args, **kwargs):
            return 'route', '{"done":false, "tool":"apply_patch", "args":{"edits":[{"path":"test_file.py", "find":"old_code", "replace":"new_code"}]}, "reason":"fail"}'
        self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_session_cleanup(self):
        self._seed_candidate()
        self.session.close = Mock()
        mock_model = self._patch_then_done()
        self.controller.run_repair('task', mock_model, 'key')
        self.session.close.assert_called_once()

    def test_dishonest_model_done(self):
        self._seed_candidate()
        mock_model = self._patch_then_done()
        self.controller.tools.run_tests = lambda: {'ok': True, 'status': 'ok', 'passed': False,
                                                     'results': [{'status': 'failed', 'ran': 1}]}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')
        self.assertEqual(len(self.controller.attempts), 1)

    def test_unavailable_outcome(self):
        def mock_model(*args, **kwargs):
            return 'route', '{"tool":"run_command", "args":{"argv":["ls"]}, "reason":"fail"}'
        self.controller.tools.run_command = lambda **kwargs: {'ok': False, 'status': 'unavailable'}
        res = self.controller.run_repair('task', mock_model, 'key')
        self.assertEqual(res['status'], 'failed')
        self.assertEqual(res['last_attempt'], 0, 'unavailable runs never count as a changed candidate')

    def test_zero_discovered_tests_do_not_establish_success(self):
        session = sandbox.Session(
            sandbox.Tree('repo', 'sha', {
                'app.py': b'value=1\n',
                'tests/test_smoke.py': b'import unittest\nclass Smoke(unittest.TestCase):\n    def test_it(self): pass\n',
            }), docker=ZeroTestDocker())
        controller = sandbox_repair_controller.SandboxRepairController(session)
        result = controller.run_repair('task', self._patch_then_done(), 'key')
        self.assertEqual(result['status'], 'failed', 'zero discovered tests cannot verify a repair')

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

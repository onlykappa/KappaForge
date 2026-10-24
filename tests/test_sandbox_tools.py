import unittest
from typing import List

from engine import sandbox
from engine.sandbox_tools import SandboxTools

# Minimal fake session that mimics the subset of Session used by SandboxTools
class FakeSession:
    def __init__(self, files=None, results=None):
        self._files = files or {}
        self.results = results or []
        # emulate a simple base tree for diff inspection
        self.base = sandbox.Tree('repo', 'sha', {k: v.encode() for k, v in self._files.items()})

    # Session API used by SandboxTools
    def current(self):
        return self._files

    def apply(self, edits: dict):
        self._files.update(edits)

    def revert(self, paths: List[str] = None):
        if paths is None:
            self._files.clear()
        else:
            for p in paths:
                self._files.pop(p, None)

    def diff(self):
        # Very simple diff representation – list of changed paths
        diffs = []
        for p, content in self._files.items():
            diffs.append(f"+{p}\n{content}\n")
        return "".join(diffs)

    def run(self, argv, profile='test'):
        # Return a successful RunResult with dummy output
        return sandbox.RunResult(argv=argv, profile=profile, status='passed', exit_code=0,
                                 duration_s=0.1, stdout='output', stderr='')

    def run_tests(self):
        # Return whatever is stored in self.results (already RunResult objects)
        return self.results

# Helper to create a RunResult with custom stdout/stderr for parsing tests
def make_result(status, stdout='', stderr=''):
    return sandbox.RunResult(argv=['cmd'], profile='test', status=status, exit_code=0,
                             duration_s=0.0, stdout=stdout, stderr=stderr)

class SandboxToolsTest(unittest.TestCase):
    def test_apply_patch_success(self):
        sess = FakeSession({'file.txt': 'hello world'})
        tools = SandboxTools(sess)
        res = tools.apply_patch([{'path': 'file.txt', 'find': 'world', 'replace': 'there'}])
        self.assertTrue(res['ok'])
        self.assertIn('file.txt', sess.current())
        self.assertEqual(sess.current()['file.txt'], 'hello there')

    def test_apply_patch_duplicate_find(self):
        sess = FakeSession({'dup.txt': 'foo foo'})
        tools = SandboxTools(sess)
        res = tools.apply_patch([{'path': 'dup.txt', 'find': 'foo', 'replace': 'bar'}])
        self.assertFalse(res['ok'])
        self.assertIn('occurs 2 times', res['error'])
        # ensure file unchanged
        self.assertEqual(sess.current()['dup.txt'], 'foo foo')

    def test_apply_patch_create_missing(self):
        sess = FakeSession({})
        tools = SandboxTools(sess)
        res = tools.apply_patch([{'path': 'new.txt', 'find': '', 'replace': 'content'}])
        self.assertTrue(res['ok'])
        self.assertIn('new.txt', sess.current())
        self.assertEqual(sess.current()['new.txt'], 'content')

    def test_run_command_summary(self):
        sess = FakeSession()
        tools = SandboxTools(sess)
        res = tools.run_command(['echo', 'hi'])
        self.assertTrue(res['ok'])
        self.assertEqual(res['status'], 'passed')
        self.assertIn('argv', res)
        self.assertIn('output', res)
        self.assertEqual(res['output'], 'output')

    def test_run_tests_aggregation(self):
        passed = make_result('passed', stdout='Ran 1 test\nOK')
        failed = make_result('failed', stdout='Ran 1 test\nFAILED (failures=1)')
        sess = FakeSession(results=[passed, failed])
        tools = SandboxTools(sess)
        res = tools.run_tests()
        self.assertTrue(res['ok'])
        self.assertFalse(res['passed'])
        self.assertEqual(len(res['results']), 2)
        self.assertEqual(res['results'][0]['status'], 'passed')
        self.assertEqual(res['results'][1]['status'], 'failed')

    def test_inspect_test_results_unittest(self):
        out = """\nRan 3 tests in 0.001s\n\nFAILED (failures=1, errors=0)\n\nFAIL: test_example (module.TestCase)\nTraceback (most recent call last):\n  File \"test.py\", line 10, in test_example\n    self.assertEqual(1, 2)\nAssertionError: 1 != 2\n"""
        sess = FakeSession(results=[make_result('failed', stdout=out)])
        tools = SandboxTools(sess)
        res = tools.inspect_test_results()
        self.assertTrue(res['ok'])
        self.assertEqual(res['counts']['ran'], 3)
        self.assertEqual(res['counts']['failures'], 1)
        self.assertIn('test_example', res['failing'][0])
        self.assertIn('Traceback', res['first_error'])

    def test_inspect_test_results_tap(self):
        out = "# pass 5\n# fail 2\n# skipped 1\n"
        sess = FakeSession(results=[make_result('failed', stdout=out)])
        tools = SandboxTools(sess)
        res = tools.inspect_test_results()
        self.assertTrue(res['ok'])
        self.assertEqual(res['counts']['ran'], 5)
        self.assertEqual(res['counts']['failures'], 2)
        self.assertEqual(res['counts']['skipped'], 1)

    def test_read_execution_log(self):
        result = make_result('passed', stdout='a'*5000, stderr='b'*3000)
        sess = FakeSession(results=[result])
        tools = SandboxTools(sess)
        res = tools.read_execution_log(stream='stdout', offset=100, limit=200)
        self.assertTrue(res['ok'])
        self.assertEqual(res['total'], 5000)
        self.assertEqual(len(res['slice']), 200)
        self.assertTrue(res['more'])

    def test_inspect_diff_and_changed_paths(self):
        sess = FakeSession({'a.txt': '1', 'b.txt': '2'})
        # modify one file after creation to simulate a change
        sess.apply({'a.txt': 'changed'})
        tools = SandboxTools(sess)
        res = tools.inspect_diff()
        self.assertTrue(res['ok'])
        self.assertIn('a.txt', res['changed_paths'])
        self.assertIn('b.txt', res['changed_paths'])  # both differ from base (base had original values)

    def test_revert_candidate_change(self):
        sess = FakeSession({'x.txt': 'old'})
        sess.apply({'x.txt': 'new'})
        tools = SandboxTools(sess)
        res = tools.revert_candidate_change(['x.txt'])
        self.assertTrue(res['ok'])
        self.assertNotIn('x.txt', sess.current())
        # revert all
        sess.apply({'y.txt': 'y'})
        res_all = tools.revert_candidate_change()
        self.assertTrue(res_all['ok'])
        self.assertEqual(sess.current(), {})

if __name__ == '__main__':
    unittest.main()

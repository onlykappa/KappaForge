import unittest
import json

from engine import sandbox
from engine.sandbox_tools import SandboxTools

# stand-in: fake command execution avoids Docker; candidate operations use the real Session.
class FakeSession(sandbox.Session):
    def __init__(self, files=None, results=None):
        super().__init__(sandbox.Tree('repo', 'a' * 40, {k: v.encode() for k, v in (files or {}).items()}),
                         versions=('3.12', '22'), results=list(results or []))

    def run(self, argv, profile='test'):
        # Return a successful RunResult with dummy output
        result = sandbox.RunResult(argv=argv, profile=profile, status='passed', exit_code=0,
                                   duration_s=0.1, stdout='output', stderr='')
        self.results.append(result)
        return result

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
        self.assertEqual(sess.current()['file.txt'], b'hello there')

    def test_apply_patch_duplicate_find(self):
        sess = FakeSession({'dup.txt': 'foo foo'})
        tools = SandboxTools(sess)
        res = tools.apply_patch([{'path': 'dup.txt', 'find': 'foo', 'replace': 'bar'}])
        self.assertFalse(res['ok'])
        self.assertIn('occurs 2 times', res['error'])
        # ensure file unchanged
        self.assertEqual(sess.current()['dup.txt'], b'foo foo')

    def test_apply_patch_create_missing(self):
        sess = FakeSession({})
        tools = SandboxTools(sess)
        res = tools.apply_patch([{'path': 'new.txt', 'find': '', 'replace': 'content'}])
        self.assertTrue(res['ok'])
        self.assertIn('new.txt', sess.current())
        self.assertEqual(sess.current()['new.txt'], b'content')

    def test_run_command_summary(self):
        sess = FakeSession()
        tools = SandboxTools(sess)
        res = tools.run_command(['echo', 'hi'])
        self.assertTrue(res['ok'])
        self.assertEqual(res['status'], 'passed')
        self.assertIn('argv', res)
        self.assertIn('output', res)
        self.assertEqual(res['output'], 'output')

    def test_failed_summary_preserves_first_failure_before_later_cascade(self):
        root = ('ERROR: test_ingest (test_review_ingestion.ReviewIngestionTest)\n'
                'Traceback (most recent call last):\n'
                '  File "tests/test_review_ingestion.py", line 25, in test_ingest\n'
                'ValueError: Task state requires a repository and full candidate SHA\n')
        cascade = ('ERROR: later_test\nTraceback (most recent call last):\n'
                   "AttributeError: 'DummyJournal' object has no attribute 'loader'\n") * 30
        output = '.' * 2000 + '\n' + root + cascade + '\nRan 1318 tests\nFAILED (errors=18)\n'
        result = SandboxTools(FakeSession())._summary(make_result('failed', stderr=output))
        self.assertIn('ERROR: test_ingest', result['first_failure'])
        self.assertIn('full candidate SHA', result['first_failure'])
        self.assertLessEqual(len(result['first_failure']), 1200)
        self.assertIn('FAILED (errors=18)', result['output'])
        self.assertEqual(len(result['output']), 1500)

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
        out = "# tests 8\n# pass 5\n# fail 2\n# skipped 1\n"
        sess = FakeSession(results=[make_result('failed', stdout=out)])
        tools = SandboxTools(sess)
        res = tools.inspect_test_results()
        self.assertTrue(res['ok'])
        self.assertEqual(res['counts']['ran'], 8)
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
        self.assertEqual(res['changed_paths'], ['a.txt'])

    def test_revert_candidate_change(self):
        sess = FakeSession({'x.txt': 'old'})
        sess.apply({'x.txt': 'new'})
        tools = SandboxTools(sess)
        res = tools.revert_candidate_change(['x.txt'])
        self.assertTrue(res['ok'])
        self.assertEqual(sess.current()['x.txt'], b'old')
        # revert all
        sess.apply({'y.txt': 'y'})
        res_all = tools.revert_candidate_change()
        self.assertTrue(res_all['ok'])
        self.assertEqual(sess.current(), {'x.txt': b'old'})

if __name__ == '__main__':
    unittest.main()


class RealSessionReviewTests(unittest.TestCase):
    """Owner review of #228: the same tools against the real engine.sandbox.Session (fake Docker only).

    The real Session stores file contents as bytes, applies {path: text or None} and records changes in
    session.changes. Do not weaken or delete these tests; fix SandboxTools so they pass."""

    def setUp(self):
        from tests.test_sandbox import FakeDocker
        self.session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, {'app.py': b'a = 1\nb = 2\n'}),
                                       FakeDocker(), versions=('3.13', '22'))
        self.tools = SandboxTools(self.session)

    def text(self, path):
        return self.session.current()[path].decode()

    def test_an_existing_file_is_edited(self):
        result = self.tools.apply_patch([{'path': 'app.py', 'find': 'a = 1', 'replace': 'a = 10'}])
        self.assertEqual((result['ok'], result['status']), (True, 'applied'))
        self.assertEqual(self.text('app.py'), 'a = 10\nb = 2\n')

    def test_several_edits_to_one_file_all_apply_in_order(self):
        result = self.tools.apply_patch([{'path': 'app.py', 'find': 'a = 1', 'replace': 'a = 10'},
                                         {'path': 'app.py', 'find': 'b = 2', 'replace': 'b = 20'}])
        self.assertTrue(result['ok'])
        self.assertEqual(self.text('app.py'), 'a = 10\nb = 20\n')
        self.assertEqual(result['changed_paths'], ['app.py'])

    def test_a_failing_edit_applies_nothing(self):
        result = self.tools.apply_patch([{'path': 'app.py', 'find': 'a = 1', 'replace': 'a = 10'},
                                         {'path': 'app.py', 'find': 'missing', 'replace': 'x'}])
        self.assertEqual((result['ok'], result['status']), (False, 'invalid'))
        self.assertIn('app.py', result['error'])
        self.assertEqual(self.session.changes, {})

    def test_bad_input_is_reported_never_raised(self):
        for edits in ('oops', [42], [{'path': '../x', 'find': '', 'replace': 'x'}],
                      [{'path': 'app.py', 'find': 123, 'replace': 'x'}], [{'find': 'a', 'replace': 'b'}]):
            with self.subTest(edits=edits):
                result = self.tools.apply_patch(edits)
                self.assertEqual((result['ok'], result['status']), (False, 'invalid'))
                self.assertTrue(result['error'])
        self.assertEqual(self.session.changes, {})
        self.session.results.append(sandbox.RunResult(['x'], 'test', 'failed', stderr='abcdef'))
        for kwargs in ({'offset': -1}, {'limit': 0}, {'offset': 'x'}, {'index': 5}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.tools.read_execution_log(**kwargs)['status'], 'invalid')

    def test_node_tap_counts_every_test_and_names_the_failures(self):
        self.session.results.append(sandbox.RunResult(['npm', 'test'], 'test', 'failed', stdout=(
            'TAP version 13\nok 1 - adds\nnot ok 2 - total counts units\nok 3 - empty cart\n'
            '# tests 3\n# pass 2\n# fail 1\n# skipped 0\n')))
        result = self.tools.inspect_test_results()
        self.assertEqual(result['counts'], {'ran': 3, 'failures': 1, 'errors': 0, 'skipped': 0})
        self.assertEqual(result['failing'], ['total counts units'])

    def test_missing_docker_is_unavailable_not_invalid_input(self):
        self.session.docker._available = False
        result = self.tools.run_command(['python', 'app.py'])
        self.assertEqual((result['ok'], result['status']), (False, 'unavailable'))
        self.assertIn('Docker', result['error'])

    def test_the_diff_lists_exactly_the_candidate_changes_including_deletions(self):
        self.session.apply({'app.py': None, 'new.py': 'x = 1\n'})
        result = self.tools.inspect_diff()
        self.assertEqual(result['changed_paths'], ['app.py', 'new.py'])
        self.assertIn('+x = 1', result['diff'])


class AdditionalRealSessionReviewTests(unittest.TestCase):
    """Reviewer regressions: malformed tool calls must stay structured and atomic."""

    def setUp(self):
        from tests.test_sandbox import FakeDocker
        self.session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, {
            'app.py': b'a = 1\nb = 2\n', 'tests/test_app.py': b'import unittest\n',
            'binary.dat': b'\xff\xfe',
        }), FakeDocker(), versions=('3.12', '22'))
        self.tools = SandboxTools(self.session)

    def test_outputs_are_json_serializable_and_keep_the_documented_limits(self):
        output = 'start\n' + 'x' * 25000 + '\nend'
        self.session.docker.run = lambda args: sandbox.Exec(0, output, '')
        result = self.tools.run_command(['python', 'app.py'])
        self.assertEqual(result['output'], output[-1500:])
        self.assertEqual(json.loads(json.dumps(result)), result)
        log = self.tools.read_execution_log(stream='stdout', limit=90000)
        self.assertEqual(len(log['slice']), 20000)
        self.assertEqual(log['total'], len(output))
        self.assertTrue(log['more'])
        self.assertEqual(json.loads(json.dumps(log)), log)
        self.assertEqual(self.tools.inspect_test_results(index='bad')['status'], 'invalid')

    def test_patch_validates_shape_fields_and_text_without_partial_changes(self):
        invalid = [None, 42, {}, [None], [{'path': ['app.py'], 'find': '', 'replace': 'x'}],
                   [{'path': 'app.py', 'replace': 'x'}], [{'path': 'app.py', 'find': 'a = 1'}],
                   [{'path': 'app.py', 'find': 'a = 1', 'replace': None}],
                   [{'path': 'binary.dat', 'find': 'x', 'replace': 'y'}]]
        for edits in invalid:
            with self.subTest(edits=edits):
                result = self.tools.apply_patch(edits)
                self.assertEqual((result['ok'], result['status']), (False, 'invalid'))
                self.assertTrue(result['error'])
                self.assertEqual(self.session.changes, {})

    def test_sequential_edits_can_target_text_created_by_the_previous_edit(self):
        result = self.tools.apply_patch([
            {'path': 'new.py', 'find': '', 'replace': 'x = 1\n'},
            {'path': 'new.py', 'find': 'x = 1', 'replace': 'x = 2'},
        ])
        self.assertTrue(result['ok'])
        self.assertEqual(self.session.current()['new.py'], b'x = 2\n')
        self.assertEqual(result['changed_paths'], ['new.py'])

    def test_diff_rejects_noninteger_limits(self):
        for limit in ('x', None, [], 1.5):
            with self.subTest(limit=limit):
                result = self.tools.inspect_diff(limit=limit)
                self.assertEqual((result['ok'], result['status']), (False, 'invalid'))

    def test_revert_rejects_a_string_path_collection(self):
        self.session.apply({'app.py': 'changed\n'})
        result = self.tools.revert_candidate_change('app.py')
        self.assertEqual((result['ok'], result['status']), (False, 'invalid'))
        self.assertEqual(self.session.current()['app.py'], b'changed\n')

    def test_missing_docker_in_run_tests_is_unavailable(self):
        self.session.docker._available = False
        result = self.tools.run_tests()
        self.assertEqual((result['ok'], result['status']), (False, 'unavailable'))
        self.assertIn('Docker', result['error'])

    def test_failed_unittest_keeps_skipped_count_and_bounded_stderr_traceback(self):
        self.session.results.append(sandbox.RunResult(['python'], 'test', 'failed', stderr=(
            'FAIL: test_total (test_app.PriceTests)\n'
            'Traceback (most recent call last):\n' + '  assertion context\n' * 150 +
            'AssertionError: wrong total\n\nRan 5 tests in 0.1s\n\nFAILED (failures=1, skipped=2)\n')))
        result = self.tools.inspect_test_results()
        self.assertEqual(result['counts'], {'ran': 5, 'failures': 1, 'errors': 0, 'skipped': 2})
        self.assertEqual(result['failing'], ['test_total (test_app.PriceTests)'])
        self.assertTrue(result['first_error'].startswith('Traceback'))
        self.assertLessEqual(len(result['first_error']), 2000)

    def test_real_node_assertion_block_is_available_for_diagnosis(self):
        self.session.results.append(sandbox.RunResult(['node', '--test'], 'test', 'failed', stdout=(
            'TAP version 13\nnot ok 1 - total\n  ---\n  duration_ms: 1\n'
            '  location: /work/tests/pricing.test.mjs:4:1\n  failureType: testCodeFailure\n'
            '  error: |-\n    Expected values to be strictly equal:\n    1999 !== 1699\n'
            '  code: ERR_ASSERTION\n  expected: 1699\n  actual: 1999\n'
            '  operator: strictEqual\n  ...\n# tests 1\n# pass 0\n# fail 1\n# skipped 0\n')))
        result = self.tools.inspect_test_results()
        self.assertEqual(result['failing'], ['total'])
        self.assertIn('1999', result['first_error'])
        self.assertIn('1699', result['first_error'])
        self.assertLessEqual(len(result['first_error']), 2000)

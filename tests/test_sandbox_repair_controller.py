import unittest
from unittest.mock import patch

from engine.sandbox_repair_controller import run_sandbox_repair


class TestSandboxRepairController(unittest.TestCase):
    def setUp(self):
        self.task = "Fix the faulty project"
        self.api_key = "dummy"
        # Simple stub model – the controller never inspects the model output directly.
        self.run_model = lambda *a, **kw: ("dummy_route", "{}")

    def _make_loop_result(self, tool, result):
        return {"stop_reason": "done", "summary": "", "steps": [{"tool": tool, "args": {}, "reason": "test", "result": result}], "models": []}

    @patch("engine.tool_loop.run_tool_loop")
    def test_successful_repair(self, mock_run_tool_loop):
        # First loop: apply a patch.
        apply_step = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["fixed.txt"]},
        )
        # Second loop: run tests and pass.
        test_step = self._make_loop_result(
            "run_tests",
            {"status": "passed"},
        )
        mock_run_tool_loop.side_effect = [apply_step, test_step]

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertTrue(result["success"])
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(result["steps"][0]["tool"], "run_tests")

    @patch("engine.tool_loop.run_tool_loop")
    def test_repeat_patch_detection(self, mock_run_tool_loop):
        # Two identical patches – should trigger repeat detection on second attempt.
        patch1 = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["a.txt"]},
        )
        patch2 = self._make_loop_result(
            "apply_patch",
            {"ok": True, "status": "applied", "changed_paths": ["a.txt"]},
        )
        mock_run_tool_loop.side_effect = [patch1, patch2]

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "repeat_patch")
        self.assertEqual(result["attempts"], 1)

    @patch("engine.tool_loop.run_tool_loop")
    def test_max_attempts_exhausted(self, mock_run_tool_loop):
        # Five distinct patches, never passing tests.
        side_effects = []
        for i in range(5):
            side_effects.append(
                self._make_loop_result(
                    "apply_patch",
                    {"ok": True, "status": "applied", "changed_paths": [f"file{i}.txt"]},
                )
            )
        mock_run_tool_loop.side_effect = side_effects

        result = run_sandbox_repair(self.task, self.run_model, self.api_key)
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "max_attempts")
        self.assertEqual(result["attempts"], 5)


if __name__ == "__main__":
    unittest.main()


class RepairControllerReviewTests(unittest.TestCase):
    """Real Session and tool-loop integration; only container execution is faked."""

    def make_session(self, outcome=None, available=True):
        from engine import sandbox
        from tests.test_sandbox import FakeDocker
        docker = FakeDocker(available=available)
        session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, {
            'app.py': b'value = 0\n', 'tests/test_app.py': b'import unittest\n',
        }), docker, versions=('3.12', '22'))
        tested = []

        def execute(args):
            source = session.current()['app.py'].decode()
            tested.append(source)
            passed = outcome(source, len(tested)) if outcome else 'value = 2' in source
            return sandbox.Exec(0 if passed else 1, '', 'Ran 1 test\nOK\n' if passed else (
                'FAIL: test_value (test_app.ValueTests)\nTraceback (most recent call last):\n'
                'AssertionError: wrong value ' + source.strip() + '\n\nRan 1 test\nFAILED (failures=1)\n'))

        docker.run = execute
        return session, tested

    def script(self, replies, calls=None):
        import json
        replies = iter(replies)

        def model(key, prompt, **kwargs):
            self.assertEqual(key, 'review-key')
            if calls is not None:
                calls.append((prompt, kwargs))
            return 'scripted:repair', json.dumps(next(replies, {'done': True, 'summary': 'no more proposals'}))
        return model

    def call(self, name, args=None, reason='change the value to satisfy the failing assertion'):
        return {'tool': name, 'args': args or {}, 'reason': reason}

    def edit(self, before, after):
        return self.call('apply_patch', {'edits': [
            {'path': 'app.py', 'find': 'value = ' + str(before), 'replace': 'value = ' + str(after)},
        ]}, reason='Use value ' + str(after) + ' instead of the earlier value ' + str(before))

    def test_real_tool_results_can_complete_repair_and_fresh_final_regression(self):
        session, tested = self.make_session()
        model = self.script([self.call('run_tests'), self.call('inspect_test_results'), self.edit(0, 2),
                             self.call('run_tests'), {'done': True, 'summary': 'corrected'}])
        result = run_sandbox_repair('fix value', model, 'review-key', session_factory=lambda: session)
        self.assertTrue(result['success'], result)
        self.assertGreaterEqual(tested.count('value = 2\n'), 2, 'repair pass must be followed by fresh final regression')
        self.assertTrue(session.closed, 'controller owns and closes its session')

    def test_five_attempt_bound_is_enforced_during_the_loop_not_after_it(self):
        session, tested = self.make_session(outcome=lambda source, count: False)
        replies = []
        for i in range(6):
            replies.extend([self.edit(i, i + 1), self.call('run_tests')])
        result = run_sandbox_repair('fix value', self.script(replies), 'review-key', session_factory=lambda: session)
        candidates = {source for source in tested if source != 'value = 0\n'}
        self.assertLessEqual(len(candidates), 5, 'a sixth changed candidate must never be tested')
        self.assertFalse(result['success'])
        self.assertTrue(session.closed)

    def test_correcting_the_same_file_twice_is_not_a_repeated_patch(self):
        session, tested = self.make_session()
        model = self.script([self.edit(0, 1), self.call('run_tests'), self.call('inspect_test_results'),
                             self.edit(1, 2), self.call('run_tests'), {'done': True, 'summary': 'corrected again'}])
        result = run_sandbox_repair('fix value', model, 'review-key', session_factory=lambda: session)
        self.assertTrue(result['success'], result)
        self.assertEqual(result['attempts'], 2)
        self.assertTrue(session.closed)

    def test_noop_patch_is_not_a_meaningful_attempt(self):
        session, tested = self.make_session(outcome=lambda source, count: False)
        result = run_sandbox_repair('fix value', self.script([self.edit(0, 0), self.call('run_tests')]),
                                    'review-key', session_factory=lambda: session)
        self.assertEqual(result['attempts'], 0)
        self.assertFalse(result['success'])

    def test_unavailable_preserves_candidate_and_closes_without_reporting_success(self):
        session, tested = self.make_session(available=False)
        result = run_sandbox_repair('fix value', self.script([self.edit(0, 2), self.call('run_tests')]),
                                    'review-key', session_factory=lambda: session)
        self.assertFalse(result['success'])
        self.assertEqual(result.get('reason'), 'unavailable')
        self.assertIn('+value = 2', result.get('diff', ''))
        self.assertEqual(tested, [])
        self.assertTrue(session.closed)

    def test_final_regression_failure_blocks_success_and_keeps_diff_and_logs(self):
        import json
        session, tested = self.make_session(outcome=lambda source, count: count == 1)
        result = run_sandbox_repair('fix value', self.script([self.edit(0, 2), self.call('run_tests')]),
                                    'review-key', session_factory=lambda: session)
        self.assertGreaterEqual(len(tested), 2, 'fresh final regression was never executed')
        self.assertFalse(result['success'])
        self.assertIn('+value = 2', result.get('diff', ''))
        self.assertIn('AssertionError', json.dumps(result))
        self.assertTrue(session.closed)

    def test_provider_allowlist_reaches_the_real_model_protocol(self):
        session, tested = self.make_session()
        calls = []
        result = run_sandbox_repair('fix value', self.script([{'done': True, 'summary': 'no repair'}], calls),
                                    'review-key', session_factory=lambda: session, allowed=['ollama'])
        self.assertTrue(calls)
        self.assertTrue(all(options['allowed'] == ['ollama'] for prompt, options in calls))
        self.assertTrue(session.closed)

    def test_new_development_does_not_open_a_plan_pr_before_generation_or_validation(self):
        import urllib.error
        from engine import developer
        issue = {'number': 987, 'title': 'Fix value', 'user': {'login': 'onlykappa'},
                 'body': 'Repository: onlykappa/KappaForge\nMode: develop\n\nFix the value in app.py.'}

        def github(path, token, payload=None, method=None):
            if path.endswith('/git/ref/heads/kappa/dev-987'):
                raise urllib.error.HTTPError(path, 404, 'missing', {}, None)
            return [] if path.endswith('/comments?per_page=100') else {}

        with patch.object(developer, 'gh', side_effect=github), \
                patch.object(developer, 'snapshot', return_value=('main', 'a' * 40, {'app.py': 10}, {})), \
                patch.object(developer, 'project_guide', return_value=''), \
                patch.object(developer, 'build_repo_map', return_value=None), \
                patch.object(developer, 'plan_change', return_value=(['app.py'], [], '')), \
                patch.object(developer, 'read_source', return_value='value = 0\n'), \
                patch.object(developer, 'build_in_stages', side_effect=RuntimeError('review stopped generation')), \
                patch.object(developer, 'open_plan_draft', side_effect=AssertionError('PR created before sandbox validation')) as draft, \
                self.assertRaisesRegex(RuntimeError, 'review stopped generation'):
            developer.produce_development_pr(issue, 'review-key', 'github-test-token')
        draft.assert_not_called()

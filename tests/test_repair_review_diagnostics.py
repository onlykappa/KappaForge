"""A blocked repair review must be diagnosable, and real failing-test evidence must reach the verifier."""
import inspect
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from engine import developer, recovery, repair_guard, task_goal, task_state

SHA = 'a' * 40
OWNER = ('Wire it into engine/developer.py. For the new sandbox flow, defer those commits/branch writes/PR creation '
         'until sandbox validation AND final regression succeed.')
OWNER_QUOTE = 'defer those commits/branch writes/PR creation until sandbox validation AND final regression succeed'
PUBLISH_LINE = 'saved.update(open_plan_draft(repo, repo_token, number, issue, base, sha, branch, layout, design))'
RUNNER = '/home/runner/work/KappaForge/KappaForge/'


def review_input(prompt):
    return json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]


def failing_log(line):
    """The shape of sandbox run 40121972199: the step-4 regression failing at the early plan PR."""
    caret = '           ' + '^' * 30
    return ('FAIL: test_new_development_does_not_open_a_plan_pr_before_generation_or_validation '
            '(test_sandbox_repair_controller.RepairControllerReviewTests.test_new_development_does_not_open_a_plan_pr_before_generation_or_validation)\n'
            + '-' * 70 + '\nTraceback (most recent call last):\n'
            f'  File "{RUNNER}tests/test_sandbox_repair_controller.py", line 266, in test_new_development_does_not_open_a_plan_pr_before_generation_or_validation\n'
            "    developer.produce_development_pr(issue, 'review-key', 'github-test-token')\n"
            f'  File "{RUNNER}engine/task_goal.py", line 182, in run\n    return method(issue, *args, **kwargs)\n{caret}\n'
            f'  File "{RUNNER}engine/developer.py", line {line}, in produce_development_pr\n    {PUBLISH_LINE}\n{caret}\n'
            + ''.join(f'  File "/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/unittest/mock.py", line {n}, in _call\n'
                      f'    return self._mock_call(*args, **kwargs)\n{caret}\n' for n in (1139, 1143, 1198))
            + 'AssertionError: PR created before sandbox validation\n\n' + '-' * 70 + '\nRan 729 tests in 24.025s\n\nFAILED (failures=1, skipped=10)\n')


class GuardCase(unittest.TestCase):
    def setUp(self):
        developer.Progress.latest = None
        self.goal = task_goal.from_request(OWNER)
        self.goal_token = task_goal.CURRENT.set(self.goal)
        self.journal_token = recovery.CURRENT.set(None)
        task_state.bind('onlykappa/KappaForge', 232, 'kappa/dev-232', SHA)

    def tearDown(self):
        task_goal.CURRENT.reset(self.goal_token)
        recovery.CURRENT.reset(self.journal_token)


class IncompleteExcerptTests(GuardCase):
    def large_source(self):
        filler = ''.join(f'    total += step()  # r{n}\n' for n in range(400))
        return 'def produce_development_pr():\n' + filler + '    ' + PUBLISH_LINE + '\n' + filler

    def test_traceback_supported_finding_in_an_incomplete_excerpt_can_be_confirmed(self):
        source = self.large_source()
        line = source.split('\n').index('    ' + PUBLISH_LINE) + 1
        claim = 'Independent check failure: ' + failing_log(line)
        seen = {}

        def model(key, prompt, **kw):
            data = review_input(prompt)
            seen.update(prompt=prompt, data=data)
            return 'verifier', json.dumps({'findings': [dict(
                id=data['findings'][0]['id'], verdict='confirmed', in_goal=True,
                reason='The failing regression shows the plan PR opens before validation',
                owner_quote=OWNER_QUOTE, evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)])]})
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, [claim], {'engine/developer.py': source})
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        shown = seen['data']['sources']['engine/developer.py']
        self.assertFalse(shown['complete'], 'the excerpt is partial, yet literal frame evidence still counts')
        self.assertEqual(shown['traceback_lines'], [line])
        self.assertIn('omitted code could change the verdict', seen['prompt'])
        self.assertIn('reproduction evidence', seen['prompt'])
        self.assertNotIn('incomplete excerpts, inability to reproduce', seen['prompt'])

    def test_frame_evidence_does_not_relax_literal_source_or_owner_checks(self):
        source = self.large_source()
        line = source.split('\n').index('    ' + PUBLISH_LINE) + 1
        claim = 'Independent check failure: ' + failing_log(line)
        for change in (dict(owner_quote='open the PR immediately'),
                       dict(evidence=[dict(path='engine/developer.py', quote='open_plan_draft(repo, token)')]),
                       dict(evidence=[dict(path='engine/developer.py', quote='total += step()  # r200')]),
                       dict(in_goal=False)):
            def model(key, prompt, **kw):
                data = review_input(prompt)
                row = dict(id=data['findings'][0]['id'], verdict='confirmed', in_goal=True, reason='Publishes early',
                           owner_quote=OWNER_QUOTE, evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)])
                row.update(change)
                return 'verifier', json.dumps({'findings': [row]})
            with self.subTest(change=change):
                rows = repair_guard.verify_findings(model, 'key', self.goal.request, [claim], {'engine/developer.py': source})
                self.assertEqual(rows[0]['verdict'], 'needs_validation')


class TracebackExcerptTests(unittest.TestCase):
    SOURCE = ''.join(f'total += step()  # r{n}\n' for n in range(600))

    def test_frame_window_is_shown_when_its_code_has_no_distinctive_words(self):
        claim = ('Traceback (most recent call last):\n'
                 f'  File "{RUNNER}app/flow.py", line 301, in run\n    total += step()\nAssertionError: boom')
        shown = repair_guard.payload({'app/flow.py': self.SOURCE}, [claim])['sources']['app/flow.py']
        for n in (294, 300, 306):
            self.assertIn(f'# r{n}\n', shown['text'] + '\n')
        self.assertEqual(shown['traceback_lines'], [301])
        self.assertLessEqual(len(shown['text']), 3000)
        without = repair_guard.payload({'app/flow.py': self.SOURCE}, [claim.replace('line 301', 'line 9999')])
        self.assertNotIn('# r300\n', without['sources']['app/flow.py']['text'], 'keyword matching alone would miss it')

    def test_frame_windows_stay_within_every_budget(self):
        for budget in (0, 10, 16, 40, 120, 400, 3000):
            with self.subTest(budget=budget):
                shown = developer.excerpt(self.SOURCE, 'step total', budget, lines_near=[0, 300, 599, 5000, -3])
                self.assertLessEqual(len(shown), budget)

    def test_frames_from_other_files_and_library_frames_do_not_anchor(self):
        claim = (f'  File "{RUNNER}app/other.py", line 301, in run\n'
                 '  File "/opt/hostedtoolcache/Python/3.12.15/x64/lib/python3.12/site-packages/app/flow.py", line 301, in x\n')
        self.assertEqual(repair_guard.frame_lines([claim], 'app/flow.py'), [])
        self.assertEqual(repair_guard.frame_lines([claim], 'app/other.py'), [300])

    def test_compacted_claim_keeps_the_failing_frame_and_assertion(self):
        claim = 'Independent check failure (sandbox tests and/or native iOS build): ' + failing_log(2022)
        shown = repair_guard.payload({}, [claim])['findings'][0]
        self.assertEqual(shown['id'], repair_guard.digest(claim), 'the id is still the original claim digest')
        self.assertIn('File "engine/developer.py", line 2022, in produce_development_pr', shown['claim'])
        self.assertIn(PUBLISH_LINE, shown['claim'])
        self.assertIn('AssertionError: PR created before sandbox validation', shown['claim'])
        self.assertNotIn('mock.py', shown['claim'])
        self.assertNotIn('^^^', shown['claim'])
        self.assertNotIn(RUNNER, shown['claim'])
        self.assertLessEqual(len(shown['claim']), repair_guard.MAX_TRACEBACK_CLAIM_CHARS)
        plain = 'x' * 2000
        self.assertEqual(len(repair_guard.payload({}, [plain])['findings'][0]['claim']), repair_guard.MAX_CLAIM_CHARS)


class ReasonPersistenceTests(GuardCase):
    def test_reasons_are_saved_short_and_without_quotes_source_or_secrets(self):
        journal = SimpleNamespace(state={}, persist=Mock())
        recovery.CURRENT.set(journal)
        secret = 'sensitive-reason-fixture'
        source = {'app.py': 'def add(a, b):\n    return combine_values(a, b)\n'}
        reason = ('Cannot confirm: return combine_values(a, b) may be fine, see `def add(a, b):` and "a quoted part". '
                  'Leaked ' + secret + '.\nOmitted callers could change the verdict. ' + 'more detail ' * 40)

        def model(key, prompt, **kw):
            data = review_input(prompt)
            return 'verifier', json.dumps({'findings': [dict(
                id=data['findings'][0]['id'], verdict='needs_validation', in_goal=True, reason=reason,
                owner_quote='', evidence=[dict(path='app.py', quote='return combine_values(a, b)')])]})
        with patch.dict(os.environ, {'TEST_API_KEY': secret}):
            rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['app.py: add is wrong'], source)
        saved = journal.state['repairEvidence']['findings'][0]
        wire = json.dumps(journal.state) + json.dumps(task_state.snapshot()['repairAssessment'])
        self.assertIn('Omitted callers could change the verdict', saved['reason'])
        self.assertLessEqual(len(saved['reason']), repair_guard.MAX_REASON_CHARS)
        for leaked in (secret, 'combine_values', 'def add', 'a quoted part', 'quote', '\n'):
            self.assertNotIn(leaked, saved['reason'])
        for leaked in (secret, 'combine_values', 'def add'):
            self.assertNotIn(leaked, wire)
        self.assertEqual(task_state.snapshot()['repairAssessment']['findings'][0]['reason'], saved['reason'])
        self.assertEqual(rows[0]['safe_reason'], saved['reason'])
        self.assertIn('needs_validation: Cannot confirm', repair_guard.summary(rows))

    def test_malformed_evidence_still_yields_a_reason_instead_of_a_hard_stop(self):
        for evidence in (5, 'text', {'quote': 'x'}, None):
            with self.subTest(evidence=evidence):
                self.assertEqual(repair_guard.safe_reason(dict(reason='Omitted code matters', evidence=evidence)),
                                 'Omitted code matters')

    def test_unquoted_source_lines_are_removed_from_reasons(self):
        row = dict(reason='Line one\n    return combine_values(a, b)\nLine three', evidence=[])
        self.assertEqual(repair_guard.safe_reason(row, {'app.py': '    return combine_values(a, b)\n'}),
                         'Line one [excerpt] Line three')


class RevisionHarness(GuardCase):
    """revise_branch on the PR #234 failure: real verifier, scripted model, no GitHub writes."""
    PROBLEMS = [
        'engine/developer.py produce_development_pr still executes saved.update(open_plan_draft(...)) before build_in_stages '
        'and sandbox validation. Defer all new-development checkpoint commits/PR writes until final regression.',
        'engine/developer.py never imports or calls run_sandbox_repair, so the repair controller is disconnected.',
    ]

    def setUp(self):
        super().setUp()
        task_goal.CURRENT.reset(self.goal_token)
        self.goal_token = task_goal.CURRENT.set(None)
        self.engine = inspect.getsource(developer)
        self.line = self.engine.split('\n').index('        ' + PUBLISH_LINE) + 1
        self.writes = []
        self.files = {'engine/sandbox_repair_controller.py': 'def run_sandbox_repair():\n    return {}\n',
                      'tests/test_sandbox_repair_controller.py': 'def test():\n    pass\n',
                      'engine/developer.py': self.engine, 'engine/task_goal.py': inspect.getsource(task_goal)}

    def github(self, path, _token, *args, **kwargs):
        if args or kwargs:
            self.writes.append(path)
        if '/files?' in path:
            return [{'filename': p, 'status': 'added', 'patch': '+fixture'} for p in
                    ('engine/sandbox_repair_controller.py', 'tests/test_sandbox_repair_controller.py')]
        return []

    def read(self, _repo, path, _sha, _token):
        return self.files[path]

    def revise(self, model, read=None, problems=None, failed=True, pr_body=''):
        issue = {'number': 232, 'title': 'Phase 1 step 4', 'body': 'Repository: onlykappa/KappaForge\nMode: develop\n\n' + OWNER}
        pr = {'number': 234, 'body': pr_body, 'html_url': 'https://github.com/onlykappa/KappaForge/pull/234'}
        with patch.object(developer, 'gh', side_effect=self.github), \
                patch.object(developer, 'list_tree', return_value=({p: len(t) for p, t in self.files.items()}, {})), \
                patch.object(developer, 'project_guide', return_value=''), \
                patch.object(developer, 'read_source', side_effect=read or self.read), \
                patch.object(developer, 'requirements_open', return_value=self.PROBLEMS if problems is None else problems), \
                patch.object(developer, 'job_log', return_value=failing_log(self.line)), \
                patch.object(developer, 'is_private', return_value=False), \
                patch.object(developer, 'code_providers', return_value={'groq'}), \
                patch.object(developer, 'run_model', side_effect=model), \
                patch.object(developer, 'check_the_work', side_effect=lambda *a, **k: (a[7], 'checked', [])), \
                patch.object(developer, 'generate', return_value=('m', 'Defer the plan PR', {'engine/developer.py': 'x'}, '')) as generate:
            result = developer.revise_branch(issue, pr, 'kappa/dev-232', SHA, [{'id': 1, 'steps': []}] if failed else [],
                                             'fixture', 'fixture')
        return result, generate


class Pr234ReplayTests(RevisionHarness):
    def test_the_real_failure_shape_reaches_verified_generation(self):
        seen = {}

        def model(key, prompt, **kw):
            data = review_input(prompt)
            seen['data'] = data
            rows = []
            for row in data['findings']:
                early_pr = 'open_plan_draft' in row['claim']
                rows.append(dict(id=row['id'], verdict='confirmed' if early_pr else 'needs_validation', in_goal=True,
                                 reason='The plan PR opens before validation' if early_pr else 'Absence cannot be quoted',
                                 owner_quote=OWNER_QUOTE, evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)]))
            return 'verifier', json.dumps({'findings': rows})
        _, generate = self.revise(model)
        failure = next(row for row in seen['data']['findings'] if row['claim'].startswith('Independent check failure'))
        self.assertIn(f'File "engine/developer.py", line {self.line}, in produce_development_pr', failure['claim'])
        self.assertIn('AssertionError: PR created before sandbox validation', failure['claim'])
        self.assertEqual(seen['data']['sources']['engine/developer.py']['traceback_lines'], [self.line])
        self.assertIn(PUBLISH_LINE, seen['data']['sources']['engine/developer.py']['text'])
        generate.assert_called_once()
        task = generate.call_args.args[1]
        self.assertIn('Verified repair targets only:', task)
        targets = task.split('Verified repair targets only:', 1)[1].split('Existing design and attempt history', 1)[0]
        self.assertIn('PR created before sandbox validation', targets)
        self.assertIn('saved.update(open_plan_draft', targets)
        self.assertNotIn('never imports or calls run_sandbox_repair', targets)
        self.assertEqual(self.writes, [], 'preparing a repair writes nothing to GitHub')

    def test_an_unconfirmed_review_stops_with_sanitized_verdicts(self):
        def model(key, prompt, **kw):
            data = review_input(prompt)
            return 'verifier', json.dumps({'findings': [dict(
                id=row['id'], verdict='needs_validation', in_goal=True,
                reason='Omitted validation code could change the verdict near `' + PUBLISH_LINE + '`',
                owner_quote=OWNER_QUOTE, evidence=[]) for row in data['findings']]})
        with self.assertRaises(repair_guard.RepairReviewRequired) as stopped:
            self.revise(model)
        message = str(stopped.exception)
        self.assertIn('No repair finding was confirmed', message)
        self.assertIn('needs_validation: Omitted validation code could change the verdict', message)
        self.assertNotIn('open_plan_draft(repo', message)
        self.assertEqual(self.writes, [])


class SourceReadFailureTests(RevisionHarness):
    def test_failed_source_reads_still_load_the_pr_body_and_design(self):
        def unreadable(*args):
            raise ValueError('Full source unavailable')
        _, generate = self.revise(Mock(side_effect=AssertionError('no verifier without claims')), read=unreadable,
                                  problems=[], failed=False, pr_body='## Design notes\nKeep publication after validation.\n')
        generate.assert_called_once()
        self.assertIn('Keep publication after validation.', generate.call_args.args[1])


if __name__ == '__main__':
    unittest.main()

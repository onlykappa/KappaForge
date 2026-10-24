"""A blocked repair review must be diagnosable, and real failing-test evidence must reach the verifier."""
import inspect
import json
import os
import unittest
import urllib.error
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


class GateDiagnosticsTests(GuardCase):
    """A confirming answer that fails a deterministic check says which check, without loosening any check."""
    SOURCE = {'engine/developer.py': 'def produce_development_pr():\n    ' + PUBLISH_LINE + '\n    build_in_stages()\n'}

    def decide(self, **change):
        journal = SimpleNamespace(state={}, persist=Mock())
        recovery.CURRENT.set(journal)

        def model(key, prompt, **kw):
            row = dict(id=review_input(prompt)['findings'][0]['id'], verdict='confirmed', in_goal=True,
                       reason='`produce_development_pr` calls `open_plan_draft(repo, token)` before `build_in_stages`',
                       owner_quote=OWNER_QUOTE, evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)])
            row.update(change)
            return 'verifier', json.dumps({'findings': [row]})
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Plan PR opens before validation'], self.SOURCE)
        return rows[0], journal.state['repairEvidence']['findings'][0]

    def test_an_inexact_extra_quote_no_longer_voids_a_literal_one(self):
        row, saved = self.decide(evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE),
                                           dict(path='engine/developer.py', quote='open_plan_draft(repo, token)'),
                                           dict(path='/home/runner/work/x/engine/developer.py', quote=PUBLISH_LINE)])
        self.assertEqual(row['verdict'], 'confirmed')
        self.assertEqual(row['evidence'], [dict(path='engine/developer.py', quote=PUBLISH_LINE)], 'only literal items are kept')
        self.assertEqual(saved['gate'], [])

    def test_each_failed_check_is_named_and_still_blocks(self):
        for change, gate in ((dict(evidence=[dict(path='engine/developer.py', quote='open_plan_draft(repo, token)')]), ['no_literal_source_evidence', 'evidence:not_in_source']),
                             (dict(evidence=[]), ['no_literal_source_evidence', 'evidence:evidence_count']),
                             (dict(evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)] * 5), ['no_literal_source_evidence', 'evidence:evidence_count']),
                             (dict(owner_quote='publish only after review'), ['owner_quote_not_literal']),
                             (dict(in_goal=False), ['not_in_goal']),
                             (dict(in_goal=False, owner_quote='', evidence=[]), ['not_in_goal', 'no_literal_source_evidence', 'owner_quote_not_literal', 'evidence:evidence_count'])):
            with self.subTest(gate=gate, change=change):
                row, saved = self.decide(**change)
                self.assertEqual(row['verdict'], 'needs_validation')
                self.assertEqual(row['gate'], gate)
                self.assertEqual(saved['gate'], gate)
                self.assertIn('[gate: ' + ', '.join(gate) + ']', repair_guard.summary([row]))

    def test_a_rejection_without_its_proof_is_named_too(self):
        row, _ = self.decide(verdict='rejected', evidence=[])
        self.assertEqual((row['verdict'], row['gate']), ('needs_validation', ['no_literal_source_evidence', 'evidence:evidence_count']))
        row, _ = self.decide(verdict='rejected', in_goal=False, owner_quote='not in the request')
        self.assertEqual((row['verdict'], row['gate']), ('needs_validation', ['owner_quote_not_literal']))

    def test_owner_quote_may_join_a_wrapped_line_but_not_change_words(self):
        wrapped = OWNER_QUOTE.replace('until sandbox validation', 'until\n  sandbox   validation')
        self.assertTrue(repair_guard.owner_quoted(wrapped, OWNER))
        self.assertFalse(repair_guard.owner_quoted(OWNER_QUOTE.replace('AND', 'or'), OWNER))
        self.assertFalse(repair_guard.owner_quoted('   ', OWNER))
        row, _ = self.decide(owner_quote=wrapped)
        self.assertEqual(row['verdict'], 'confirmed')

    def test_source_quotes_still_need_exact_text(self):
        squeezed = PUBLISH_LINE.replace(', ', ',')
        row, _ = self.decide(evidence=[dict(path='engine/developer.py', quote=squeezed)])
        self.assertEqual(row['gate'], ['no_literal_source_evidence', 'evidence:not_in_source'])

    def test_reflowed_or_elided_quotes_count_only_when_every_piece_is_literal(self):
        reflowed = '    ' + PUBLISH_LINE.replace('issue, base', 'issue,\n        base') + '\n  build_in_stages()'
        elided = 'saved.update(open_plan_draft(repo ... layout, design))'
        for quote in (reflowed, elided, elided.replace('...', '\u2026')):
            with self.subTest(quote=quote):
                row, _ = self.decide(evidence=[dict(path='engine/developer.py', quote=quote)])
                self.assertEqual((row['verdict'], row['gate']), ('confirmed', []))
        for quote, issue in (('saved.update(open_plan_draft(repo ... invented_call()', 'abbreviated_or_paraphrased'),
                             ('saved ... design))', 'abbreviated_or_paraphrased'),
                             ('build_in_stages() ... saved.update(open_plan_draft(repo', 'abbreviated_or_paraphrased'),
                             ('...', 'abbreviated_or_paraphrased'),
                             ('saved.update(open_plan_draft(repo,token))', 'not_in_source')):
            with self.subTest(quote=quote):
                row, saved = self.decide(evidence=[dict(path='engine/developer.py', quote=quote)])
                self.assertEqual(row['verdict'], 'needs_validation')
                self.assertEqual(saved['gate'], ['no_literal_source_evidence', 'evidence:' + issue])
        row, _ = self.decide(evidence=[dict(path='engine/other.py', quote=PUBLISH_LINE)])
        self.assertEqual(row['gate'], ['no_literal_source_evidence', 'evidence:unknown_path'])

    def test_elided_quotes_must_stay_within_one_short_span(self):
        far = 'alpha_marker_begin()\n' + '# filler line\n' * 60 + 'omega_marker_end()\n'
        self.assertTrue(repair_guard.quote_found('alpha_marker_begin() ... # filler line', far))
        self.assertFalse(repair_guard.quote_found('alpha_marker_begin() ... omega_marker_end()', far))

    def test_a_quote_outside_the_shown_excerpt_is_named(self):
        source = {'engine/developer.py': 'def produce_development_pr():\n    ' + PUBLISH_LINE + '\n' + '# filler\n' * 900 + 'hidden_unrelated_line = 42\n'}
        data = repair_guard.payload(source, ['produce_development_pr open_plan_draft'])
        self.assertEqual(repair_guard.quote_issue(dict(path='engine/developer.py', quote='hidden_unrelated_line = 42'), data, source),
                         'outside_excerpt')

    def test_owner_quote_may_be_elided_but_not_invented(self):
        self.assertTrue(repair_guard.owner_quoted('defer those commits/branch writes ... final regression succeed', OWNER))
        self.assertFalse(repair_guard.owner_quoted('defer those commits ... until the owner merges', OWNER))

    def test_saved_reasons_keep_identifier_names_but_not_source(self):
        _, saved = self.decide(in_goal=False)
        self.assertIn('`produce_development_pr`', saved['reason'])
        self.assertIn('`build_in_stages`', saved['reason'])
        self.assertNotIn('open_plan_draft(repo', saved['reason'])
        self.assertIn('[excerpt]', saved['reason'])


class VerifierFallbackTests(GuardCase):
    """One free model's malformed answer is retried on a different free model, never accepted or treated as a verdict."""
    SOURCE = {'engine/developer.py': 'def produce_development_pr():\n    ' + PUBLISH_LINE + '\n'}

    def good(self, prompt):
        return json.dumps({'findings': [dict(id=review_input(prompt)['findings'][0]['id'], verdict='confirmed', in_goal=True,
                           reason='Publishes before validation', owner_quote=OWNER_QUOTE,
                           evidence=[dict(path='engine/developer.py', quote=PUBLISH_LINE)])]})

    def test_a_malformed_answer_is_retried_on_another_free_model(self):
        calls = []

        def model(key, prompt, **kw):
            calls.append(kw.get('skip', ()))
            if len(calls) == 1:
                return 'ollama:gpt-oss:120b', '{"findings": [{"id": "x", "verdict": "needs validation"}]}'
            if len(calls) == 2:
                return 'mistral:codestral-latest', 'not json'
            return 'nvidia:deepseek-v4.1-flash', self.good(prompt)
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Plan PR opens before validation'], self.SOURCE)
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertEqual(calls, [(), ('ollama:gpt-oss:120b',), ('ollama:gpt-oss:120b', 'mistral:codestral-latest')])

    def test_three_invalid_answers_stop_with_each_route_and_problem_named(self):
        answers = iter([('ollama:gpt-oss:120b', 'not json'), ('mistral:codestral-latest', '[]'),
                        ('groq:qwen', '{"findings": [{"id": "foreign", "verdict": "confirmed", "in_goal": true, "reason": "x"}]}')])
        model = Mock(side_effect=lambda key, prompt, **kw: next(answers))
        with self.assertRaises(repair_guard.RepairReviewRequired) as stopped:
            repair_guard.verify_findings(model, 'key', self.goal.request, ['Plan PR opens before validation'], self.SOURCE)
        message = str(stopped.exception)
        self.assertIn('invalid from 3 free models', message)
        for part in ('ollama:gpt-oss:120b: malformed_json', 'mistral:codestral-latest: not_an_object', 'groq:qwen: missing_or_foreign_ids'):
            self.assertIn(part, message)
        self.assertEqual(model.call_count, repair_guard.VERIFIER_ATTEMPTS)
        self.assertNotIn('foreign', message.replace('missing_or_foreign_ids', ''), 'answer text is never echoed')

    def test_a_valid_but_unconvinced_answer_is_not_retried(self):
        model = Mock(side_effect=lambda key, prompt, **kw: ('ollama:gpt-oss:120b', json.dumps({'findings': [dict(
            id=review_input(prompt)['findings'][0]['id'], verdict='needs_validation', in_goal=True, reason='Omitted code matters')]})))
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Plan PR opens before validation'], self.SOURCE)
        self.assertEqual((rows[0]['verdict'], model.call_count), ('needs_validation', 1), 'a verdict is not shopped around')


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


class BaseRegressionTests(unittest.TestCase):
    """Existing tests that regress on a candidate are actionable CI evidence."""
    def test_only_existing_base_tests_become_regressions(self):
        log = ('ERROR: test_commits_one_change (test_developer.DeveloperTests.test_commits_one_change)\n' + '-' * 70 +
               '\nTraceback (most recent call last):\n  File "tests/test_developer.py", line 430, in test_commits_one_change\n'
               "    developer.produce_development_pr(issue, 'key', 'token')\nTypeError: 'dict' object is not subscriptable\n\n" + '=' * 70 +
               '\nFAIL: test_brand_new_check (test_new_module.NewTests.test_brand_new_check)\n' + '-' * 70 + '\nAssertionError: 1 != 2\n\n' + '=' * 70 +
               '\nERROR: test_broken_import (unittest.loader._FailedTest.test_broken_import)\nImportError: nope\n' + '-' * 70 + '\nRan 3 tests\n')
        base = {'tests/test_developer.py': 'class DeveloperTests:\n    def test_commits_one_change(self):\n        pass\n'}
        with patch.object(developer, 'read_target', side_effect=lambda repo, path, sha, token: base.get(path)):
            found = developer.base_test_regressions(log, developer.ROOT, 'c' * 40, 't')
        self.assertEqual(len(found), 1)
        self.assertIn('existing test test_commits_one_change', found[0])
        self.assertIn("TypeError: 'dict' object is not subscriptable", found[0])
        self.assertNotIn('test_brand_new_check', found[0])
        self.assertFalse(any('test_broken_import' in item for item in found))
        self.assertEqual(developer.base_test_regressions('', developer.ROOT, 'c' * 40, 't'), [])

    def test_existing_test_module_import_failure_is_a_regression(self):
        log = ('ERROR: test_developer (unittest.loader._FailedTest.test_developer)\n' + '-' * 70 +
               "\nImportError: Failed to import test module: test_developer\nImportError: cannot import name 'job_log' "
               "from partially initialized module 'engine.developer'\n\n" + '=' * 70 +
               '\nERROR: test_new_module (unittest.loader._FailedTest.test_new_module)\nImportError: nope\n')
        with patch.object(developer, 'read_target', side_effect=lambda repo, path, sha, token:
                          {'tests/test_developer.py': 'import unittest\n'}.get(path)):
            found = developer.base_test_regressions(log, developer.ROOT, 'c' * 40, 't')
        self.assertEqual(len(found), 1)
        self.assertIn('existing test module tests/test_developer.py no longer imports', found[0])
        self.assertIn('partially initialized module', found[0])

    def test_attempt_history_stays_bounded_and_keeps_short_diffs_whole(self):
        short = developer.verified_history('design', ['a', 'b'], 'notes', '', '--- f\n+line\n')
        self.assertTrue(short.endswith('--- f\n+line\n'))
        self.assertNotIn('shortened', short)
        long = developer.verified_history('d' * 5000, ['t' * 600] * 5, 'n' * 5000, 'b' * 5000, '+' * 30000)
        self.assertLessEqual(len(long), developer.VERIFIED_HISTORY_CHARS)
        self.assertTrue(long.endswith(developer.TRUNCATED_DIFF))

if __name__ == '__main__':
    unittest.main()

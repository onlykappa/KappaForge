"""The three root causes behind "No repair finding was confirmed" (tasks #232, #235, #237, #256), each fixed at source.

1. A true finding was downgraded because a free model could not copy a source quote exactly: evidence is now cited by
   the line numbers the verifier is shown, and the owner request by requirement id; the engine copies the text.
2. One skipped or malformed decision voided the whole verification: it now counts only as "not answered".
3. The engine's own review-process notes were sent to the verifier as source defects (#256 "Repair checkpoint
   awaiting full requirement review"): they are now resolved by a fresh review, never by a repair.
"""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from engine import developer, recovery, repair_guard, task_goal, task_state, verify

SHA = 'a' * 40
SOURCES = {'app.py': 'def add(a, b):\n    return a + b\n'}


def review_input(prompt):
    return json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]


def answer(prompt, **fields):
    rows = [dict(id=row['id'], verdict='confirmed', in_goal=True, reason='add concatenates numeric strings', **fields)
            for row in review_input(prompt)['findings']]
    return 'verifier', json.dumps({'findings': rows})


class Base(unittest.TestCase):
    def setUp(self):
        developer.Progress.latest = None
        self.goal = task_goal.from_request('Make add accept numeric strings')
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(self.goal))
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(None))
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', SHA)

    def verify(self, respond, claims=('app.py: add concatenates strings',), sources=SOURCES):
        model = Mock(side_effect=lambda key, prompt, **kw: respond(prompt))
        return repair_guard.verify_findings(model, 'key', self.goal.request, list(claims), sources), model


class LineCitationTests(Base):
    def test_bad_span_retries_protocol_on_another_route_without_accepting_it(self):
        calls = []
        def model(key, prompt, **kwargs):
            calls.append(kwargs)
            span = [1, 999] if len(calls) == 1 else [2]
            return answer(prompt, owner_ref='R1', evidence=[dict(path='app.py', lines=span)])
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix app.py'], SOURCES)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]['skip'], ('verifier',))
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertEqual(rows[0]['evidence'][0]['lines'], [2, 2])

    def test_rejected_finding_can_reread_a_real_omitted_span_once(self):
        sources = {'app.py': '\n'.join(f'value_{n} = {n}' for n in range(600))}
        calls = []
        def model(key, prompt, **kwargs):
            data = review_input(prompt)
            calls.append(data)
            if len(calls) == 1:
                self.assertNotIn('501| ', data['sources']['app.py']['text'])
            else:
                self.assertIn('501| ', data['sources']['app.py']['text'])
            route, output = answer(prompt, owner_ref='R1', evidence=[dict(path='app.py', lines=[501])])
            output = json.loads(output)
            output['findings'][0]['verdict'] = 'rejected'
            return route, json.dumps(output)
        rows = repair_guard.verify_findings(model, 'key', self.goal.request, ['Fix app.py'], sources)
        self.assertEqual(len(calls), 2)
        self.assertEqual(rows[0]['verdict'], 'rejected')
        self.assertEqual(rows[0]['evidence'][0]['quote'], 'value_500 = 500')

    def test_the_verifier_sees_line_numbers_and_numbered_owner_requirements(self):
        seen = {}
        def respond(prompt):
            seen.update(review_input(prompt))
            return answer(prompt, owner_ref='R1', evidence=[dict(path='app.py', lines=[2, 2])])
        self.verify(respond)
        self.assertEqual(seen['sources']['app.py']['text'], '1| def add(a, b):\n2|     return a + b\n3| ')
        self.assertEqual(seen['owner_goal'], self.goal.request)
        self.assertEqual(seen['owner_requirements'], {'R1': [0, len(self.goal.request)]})
        span = seen['owner_requirements']['R1']
        self.assertEqual(seen['owner_goal'][span[0]:span[1]], 'Make add accept numeric strings')
        self.assertNotIn('shown', seen, 'the engine keeps its own copy for checking evidence')

    def test_a_true_finding_cited_by_line_is_confirmed_where_a_paraphrase_is_not(self):
        rows, _ = self.verify(lambda p: answer(p, owner_ref='R1', evidence=[dict(path='app.py', lines=[1, 2])]))
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertEqual(rows[0]['evidence'], [{'path': 'app.py', 'quote': 'def add(a, b):\n    return a + b', 'lines': [1, 2]}])
        # The #232 shape stays refused: an abbreviated or reworded quote is still not evidence.
        rows, _ = self.verify(lambda p: answer(p, owner_ref='R1', evidence=[dict(path='app.py', quote='return a+b ... numbers')]))
        self.assertEqual(rows[0]['verdict'], 'needs_validation')
        self.assertIn('no_literal_source_evidence', rows[0]['gate'])

    def test_a_copied_line_number_prefix_is_not_held_against_the_quote(self):
        rows, _ = self.verify(lambda p: answer(p, owner_quote='numeric strings', evidence=[dict(path='app.py', quote='2|     return a + b')]))
        self.assertEqual(rows[0]['verdict'], 'confirmed')

    def test_cited_lines_must_be_shown_few_and_in_order(self):
        long_source = {'app.py': '\n'.join(f'line_{n} = {n}' for n in range(1, 400))}
        for lines in ([2, 1], [1, 9], [900, 900], ['1', '2'], [1, 2, 3]):
            with self.subTest(lines=lines):
                rows, _ = self.verify(lambda p: answer(p, owner_ref='R1', evidence=[dict(path='app.py', lines=lines)]), sources=long_source)
                self.assertEqual(rows[0]['verdict'], 'needs_validation')
                self.assertIn('evidence:lines_not_shown' if lines != [1, 2, 3] else 'no_literal_source_evidence', rows[0]['gate'])

    def test_an_unknown_owner_reference_proves_nothing(self):
        rows, _ = self.verify(lambda p: answer(p, owner_ref='R9', evidence=[dict(path='app.py', lines=[2, 2])]))
        self.assertEqual(rows[0]['verdict'], 'needs_validation')
        self.assertIn('owner_quote_not_literal', rows[0]['gate'])


class PartialAnswerTests(Base):
    CLAIMS = ('app.py: add concatenates strings', 'app.py: add ignores floats')

    def test_a_skipped_decision_no_longer_voids_the_ones_made(self):
        def respond(prompt):
            first = repair_guard.digest(self.CLAIMS[0])
            return 'verifier', json.dumps({'findings': [dict(id=first, verdict='confirmed', in_goal=True, reason='concatenates',
                                                             owner_ref='R1', evidence=[dict(path='app.py', lines=[2, 2])]),
                                                        dict(id='foreign', verdict='confirmed', in_goal=True, reason='x')]})
        rows, model = self.verify(respond, self.CLAIMS)
        self.assertEqual(model.call_count, repair_guard.VERIFIER_ATTEMPTS)
        for call in model.call_args_list[1:]:
            self.assertEqual([row['id'] for row in review_input(call.args[1])['findings']],
                             [repair_guard.digest(self.CLAIMS[1])])
        verdicts = {row['claim']: (row['verdict'], row['gate']) for row in rows}
        self.assertEqual(verdicts[self.CLAIMS[0]], ('confirmed', []))
        self.assertEqual(verdicts[self.CLAIMS[1]], ('needs_validation', ['not_answered']), 'unanswered authorizes nothing')
        self.assertEqual(len(rows), 2, 'a foreign id is ignored')

    def test_duplicates_or_no_usable_decision_are_still_invalid(self):
        def duplicate(prompt):
            first = review_input(prompt)['findings'][0]['id']
            row = dict(id=first, verdict='confirmed', in_goal=True, reason='x')
            return 'verifier', json.dumps({'findings': [row, row]})
        for respond in (duplicate, lambda p: ('verifier', '{"findings":[{"id":"foreign"}]}'),
                        lambda p: ('verifier', json.dumps({'findings': [dict(id=review_input(p)['findings'][0]['id'], verdict='maybe')]}))):
            with self.subTest(respond=respond), self.assertRaises(repair_guard.RepairReviewRequired):
                self.verify(respond)


class ProcessProblemTests(Base):
    def test_review_only_retry_reloads_saved_classification_before_accepting_completion(self):
        from engine import requirements
        from tests.test_recovery_journal import GitHub
        world = GitHub()
        journal = world.journal()
        request = '- Document numeric inputs.\n- Document empty input refusal.'
        self.goal.request = self.goal.original = request
        classified = requirements.classify(request)
        requirements.save(journal, classified, developer.ROOT, request)
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(journal))
        self.addCleanup(requirements.CURRENT.reset, requirements.CURRENT.set(None))
        def review(*args, **kwargs):
            self.assertEqual([r.id for r in kwargs['classified']], [r.id for r in classified])
            return ([dict(id=classified[0].id, text=classified[0].text, met=True,
                          evidence={'path': 'app.py', 'quote': 'return a + b'})], [], [])
        with patch.object(verify, 'model_review', side_effect=review), \
                patch.object(developer, 'generate', side_effect=AssertionError('missing review is not a source defect')):
            _, _, problems = developer.check_the_work(
                'key', request, developer.ROOT, SHA, 'token', SOURCES, {'app.py': 40}, {}, '',
                {'free'}, '', False, self.progress())
        self.assertTrue(any('Requirement not reviewed: ' + classified[1].id in p for p in problems), problems)

    def test_omitted_classified_requirement_blocks_completion_without_source_repair(self):
        from engine import requirements
        request = '- Document numeric inputs.\n- Document empty input refusal.'
        self.goal.request = self.goal.original = request
        classified = requirements.classify(request)
        self.addCleanup(requirements.CURRENT.reset, requirements.CURRENT.set(classified))
        review = ([dict(id=classified[0].id, text=classified[0].text, met=True,
                        evidence={'path': 'app.py', 'quote': 'return a + b'})], [], [])
        with patch.object(verify, 'model_review', return_value=review), \
                patch.object(developer, 'generate', side_effect=AssertionError('missing review is not a source defect')):
            changes, verdict, problems = developer.check_the_work(
                'key', request, developer.ROOT, SHA, 'token', SOURCES, {'app.py': 40}, {}, '',
                {'free'}, '', False, self.progress())
        self.assertEqual(changes, {})
        self.assertTrue(any('Requirement not reviewed: ' + classified[1].id in p for p in problems), problems)
        self.assertTrue(all(verify.process_problem(p) for p in problems), problems)

    PROCESS = ['Requirement review unavailable; task completion is not verified: TimeoutError',
               'Requirement review returned no requirements; verification is incomplete',
               'Requirement verification is incomplete', 'Invalid requirement verification record',
               'Requirement evidence does not match executable current source: Cast inputs',
               'Requirement evidence is still incomplete after source inspection: app.py',
               'A previously reviewed requirement disappeared from the follow-up: Cast inputs',
               'A requirement disappeared between repair rounds: Cast inputs',
               'Review requested unavailable source; verification is incomplete: x.py',
               'Source inspection exceeds the bounded file budget; verification is incomplete',
               'Repair findings need validation; no speculative source edits were authorized',
               'File scope review is incomplete; no source repair is authorized by a missing review decision',
               'Repair checkpoint awaiting full requirement review and independent tests']
    SOURCE = ['Requirement not met: Cast inputs', 'No test proves the change works yet: add or update a regression test',
              'Unrelated change outside the owner goal: README.md: not requested',
              'Requirement untested: R1 Cast inputs (add or cite a test that exercises it)',
              'app.py: add concatenates numeric strings']

    def test_review_process_notes_are_told_apart_from_source_defects(self):
        for problem in self.PROCESS:
            self.assertTrue(verify.process_problem(problem), problem)
        for problem in self.SOURCE:
            self.assertFalse(verify.process_problem(problem), problem)

    def progress(self):
        return SimpleNamespace(now=lambda *a, **k: None, ok=lambda *a, **k: None, act=lambda *a, **k: None)

    def test_a_fresh_complete_review_clears_process_notes_without_the_verifier_or_code(self):
        developer.UNFINISHED[:] = ['Repair checkpoint awaiting full requirement review and independent tests']
        self.addCleanup(developer.UNFINISHED.clear)
        review = ([dict(text='Make add accept numeric strings', met=True, evidence={'path': 'app.py', 'quote': 'return a + b'})], [], [])
        with patch.object(verify, 'model_review', return_value=review), patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(repair_guard, 'verify_findings', side_effect=AssertionError('no verifier')), \
                patch.object(developer, 'generate', side_effect=AssertionError('no code')):
            changes, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token', SOURCES,
                                                            {'app.py': 50}, {}, '', None, '', False, self.progress())
        self.assertEqual((changes, problems), ({}, []))

    def test_current_review_schema_failure_reaches_progress_beside_stale_notes(self):
        from engine import requirements
        token = requirements.CURRENT.set(requirements.classify(self.goal.request))
        self.addCleanup(requirements.CURRENT.reset, token)
        stale = 'Requirement review unavailable; task completion is not verified: old diagnostic'
        developer.UNFINISHED[:] = [stale]
        self.addCleanup(developer.UNFINISHED.clear)
        progress = self.progress()
        progress.act = Mock()
        with patch.object(developer, 'run_model', return_value=('fixture', json.dumps(dict(
                requirements=[dict(id='R1', met='private malformed value')], problems=[])))), \
                patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(developer, 'generate', side_effect=AssertionError('no speculative edits')):
            changes, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token',
                SOURCES, {'app.py': 50}, {}, '', None, '', False, progress, review_only=True)
        self.assertEqual(changes, {})
        self.assertIn(stale, problems)
        events = [str(call.args) for call in progress.act.call_args_list]
        self.assertTrue(any('requirements[0].met must be boolean' in event for event in events), events)
        self.assertTrue(any('requirements[0].met must be boolean' in problem for problem in problems))
        self.assertFalse(any('private malformed value' in event for event in events))

    def test_process_notes_from_a_review_never_reach_the_verifier(self):
        developer.UNFINISHED.clear()
        review = ([dict(text='Make add accept numeric strings', met=True, evidence={'path': 'app.py', 'quote': 'return a + b'})],
                  ['Review requested unavailable source; verification is incomplete: lib/missing.py'], [])
        with patch.object(verify, 'model_review', return_value=review), patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(repair_guard, 'verify_findings', side_effect=AssertionError('no verifier')), \
                patch.object(developer, 'generate', side_effect=AssertionError('no code')):
            _, _, problems = developer.check_the_work('key', self.goal.request, developer.ROOT, SHA, 'token', SOURCES,
                                                      {'app.py': 50}, {}, '', None, '', False, self.progress())
        self.assertEqual(problems, ['Review requested unavailable source; verification is incomplete: lib/missing.py'],
                         'it stays open on the draft instead of starting a repair it cannot complete')


class ReverifyTests(Base):
    """A fix round whose only open problems are review-process notes re-checks the source and writes no code."""

    def test_disproved_findings_review_unchanged_source_but_uncertainty_still_blocks(self):
        pr = dict(number=50, html_url='https://github.com/onlykappa/KappaForge/pull/50',
                  base={'sha': SHA}, head={'sha': SHA, 'ref': 'kappa/dev-9',
                  'repo': {'full_name': developer.ROOT}}, title='Draft: Cast', body='Plan')
        issue = dict(number=9, title='Cast', body='Make add accept numeric strings')
        for verdict, check_failed in (('rejected', False), ('needs_validation', False), ('rejected', True)):
            with self.subTest(verdict=verdict, failed_check=check_failed), \
                    patch.object(developer, 'revision_files', return_value=[dict(filename='app.py', status='modified')]), \
                    patch.object(developer, 'list_tree', return_value=({'app.py': 40}, {})), \
                    patch.object(developer, 'project_guide', return_value=''), \
                    patch.object(developer, 'read_source', return_value=SOURCES['app.py']), \
                    patch.object(developer, '_add_engine_developer_source', side_effect=lambda sources, *a: sources), \
                    patch.object(developer, 'gh', return_value=[]), \
                    patch.object(developer, 'anchor_pr_goal'), \
                    patch.object(developer, 'requirements_open', return_value=['app.py lacks numeric string support']), \
                    patch.object(developer, 'repair_branch_observation', return_value=None), \
                    patch.object(repair_guard, 'enabled', return_value=True), \
                    patch.object(repair_guard, 'verify_all_findings', return_value=[dict(verdict=verdict)]), \
                    patch.object(developer, 'generate', side_effect=AssertionError('no speculative generation')), \
                    patch.object(developer, 'check_the_work', return_value=({}, 'Still incomplete', ['Actual unmet requirement'])) as review:
                if verdict == 'needs_validation' or check_failed:
                    with self.assertRaises(repair_guard.RepairReviewRequired):
                        developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, [], 'token', 'key', allowed={'free'}, checks_failed=check_failed)
                    review.assert_not_called()
                else:
                    result = developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, [], 'token', 'key', allowed={'free'}, checks_failed=check_failed)
                    review.assert_called_once()
                    self.assertEqual(review.call_args.args[7], {})
                    self.assertEqual(result[2], {})
                    self.assertIn('Actual unmet requirement', result[3])

    def test_unavailable_review_with_old_source_claims_rechecks_without_edit_permission(self):
        pr = dict(number=50, html_url='https://github.com/onlykappa/KappaForge/pull/50',
                  base={'sha': SHA}, head={'sha': SHA, 'ref': 'kappa/dev-9',
                  'repo': {'full_name': developer.ROOT}}, title='Draft: Cast', body='Plan')
        issue = dict(number=9, title='Cast', body='Make add accept numeric strings')
        pending = ['Requirement not met: Make add accept numeric strings (old unsupported quote)',
                   'Requirement review unavailable; task completion is not verified: ScopeReviewUnavailable: missing IDs']
        for failed, check_failed in (([], False), ([dict(id=123)], True), ([], True)):
            with self.subTest(failed_check=check_failed, known_jobs=bool(failed)), \
                    patch.object(developer, 'revision_files', return_value=[dict(filename='app.py', status='modified')]), \
                    patch.object(developer, 'list_tree', return_value=({'app.py': 40}, {})), \
                    patch.object(developer, 'project_guide', return_value=''), \
                    patch.object(developer, 'read_source', return_value=SOURCES['app.py']), \
                    patch.object(developer, '_add_engine_developer_source', side_effect=lambda sources, *a: sources), \
                    patch.object(developer, 'gh', return_value=[]), patch.object(developer, 'job_log', return_value='AssertionError'), \
                    patch.object(developer, 'anchor_pr_goal'), \
                    patch.object(developer, 'requirements_open', return_value=pending), \
                    patch.object(developer, 'repair_branch_observation', return_value=None), \
                    patch.object(repair_guard, 'enabled', return_value=True), \
                    patch.object(repair_guard, 'verify_all_findings', side_effect=repair_guard.RepairReviewRequired('needs validation')) as verifier, \
                    patch.object(developer, 'generate', side_effect=AssertionError('no speculative generation')), \
                    patch.object(developer, 'check_the_work', return_value=({}, 'Still incomplete', pending)) as review:
                if check_failed:
                    with self.assertRaises(repair_guard.RepairReviewRequired):
                        developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, failed, 'token', 'key', allowed={'free'}, checks_failed=check_failed)
                    verifier.assert_called_once()
                    review.assert_not_called()
                else:
                    result = developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, [], 'token', 'key', allowed={'free'})
                    verifier.assert_not_called()
                    review.assert_called_once()
                    self.assertTrue(review.call_args.kwargs.get('review_only'), 'the fresh review cannot edit code')
                    self.assertEqual(result[2], {})
                    self.assertIn('Still incomplete', result[3])
                    self.assertEqual(verify.open_problems({'body': result[3]}), pending)

    def test_fix_pull_request_publishes_the_fresh_review_without_code_or_test_dispatch(self):
        from engine import native_build
        old_problem = 'Repair checkpoint awaiting full requirement review and independent tests'
        issue = dict(number=9, title='Cast', user={'login': developer.OWNER},
                     body='Repository: onlykappa/KappaForge\nMode: develop\n\nMake add accept numeric strings')
        for problems in ([], ['Requirement verification is incomplete']):
            with self.subTest(problems=problems):
                pr = dict(number=50, html_url='https://github.com/onlykappa/KappaForge/pull/50',
                          state='open', draft=True, title='Draft (incomplete): Cast', base={'sha': SHA},
                          head={'sha': SHA, 'ref': 'kappa/dev-9', 'repo': {'full_name': developer.ROOT}},
                          body='Original plan\n\n' + verify.review_record([old_problem]) +
                               '\n\n## Latest fix\nStale review')
                fresh = 'Fresh requirement review.\n\n' + verify.review_record(problems)
                writes = []

                def gh(path, token, payload=None, method=None):
                    if payload is not None:
                        writes.append((path, payload, method))
                        return {}
                    if path.endswith('/pulls?state=open&head=onlykappa:kappa/dev-9'):
                        return [pr]
                    if '/comments?' in path:
                        return []
                    self.fail('Unexpected GitHub read: ' + path)

                with patch.object(developer, 'gh', side_effect=gh), \
                        patch.object(developer, 'token_for', return_value='token'), \
                        patch.object(developer, 'sandbox_result', return_value={'status': 'completed', 'conclusion': 'success'}), \
                        patch.object(native_build, 'result', return_value=None), \
                        patch.object(developer, 'owner_guidance', return_value=[]), \
                        patch.object(developer, 'is_private', return_value=False), \
                        patch.object(developer, 'code_providers', return_value={'free'}), \
                        patch.object(developer, 'Progress') as progress, \
                        patch.object(developer, 'revise_branch', return_value=('reviewer', 'Re-checked', {}, fresh, {})) as revise, \
                        patch.object(developer, 'run_sandbox_repair') as sandbox_run, \
                        patch.object(developer, 'publish_candidate') as publish, \
                        patch.object(developer, 'commit_changes') as commit, \
                        patch.object(developer, 'dispatch_tests') as dispatch:
                    url = developer.fix_pull_request(issue, 'key', 'token')

                self.assertEqual(url, pr['html_url'])
                revise.assert_called_once()
                sandbox_run.assert_not_called()
                publish.assert_not_called()
                commit.assert_not_called()
                dispatch.assert_not_called()
                self.assertEqual(len(writes), 2, 'only the existing PR and task comment are updated')
                path, payload, method = writes[0]
                self.assertEqual((path, method), (f'repos/{developer.ROOT}/pulls/50', 'PATCH'))
                self.assertEqual(payload['title'], 'Draft' + (' (incomplete)' if problems else '') + ': Cast')
                previous, latest = payload['body'].split('\n\n## Latest fix\n')
                self.assertEqual(previous.strip(), 'Original plan')
                self.assertEqual(latest, fresh)
                self.assertEqual(verify.open_problems(payload), problems)
                path, payload, _ = writes[1]
                self.assertEqual(path, f'repos/{developer.ROOT}/issues/9/comments')
                self.assertIn('Re-checked the requirements against the current source:', payload['body'])
                self.assertIn(pr['html_url'], payload['body'])
                self.assertIn('1 problem(s) still open' if problems else 'every requirement is met; no code change was needed', payload['body'])
                self.assertEqual(progress.return_value.ok.call_args.kwargs['status'], 'blocked' if problems else 'testing')

    def test_a_process_only_fix_round_reviews_again_without_verifier_or_generation(self):
        fallback = 'The previous attempt reported unfinished requirements; recheck the original task'
        self.assertTrue(verify.process_problem(fallback))
        self.assertFalse(verify.process_problem('Requirement not met: Add numeric-string support'))
        pr = dict(number=50, html_url='https://github.com/onlykappa/KappaForge/pull/50', base={'sha': SHA},
                  head={'sha': SHA, 'ref': 'kappa/dev-9', 'repo': {'full_name': developer.ROOT}},
                  title='Draft (incomplete): Cast', body='Plan')
        def gh(path, token, payload=None, method=None):
            if path.endswith('/files?per_page=100'):
                return [{'filename': 'app.py', 'status': 'modified', 'patch': '@@ -1 +1 @@'}]
            if path == f'repos/{developer.ROOT}':
                return {'private': False}
            return []
        seen = {}
        def review(api_key, task, repo, sha, token, sources, existing, changes, *args, **kwargs):
            seen['changes'], seen['unfinished'] = dict(changes), list(developer.UNFINISHED)
            return changes, 'All requirements met.', []
        issue = {'number': 9, 'title': 'Cast', 'body': 'Repository: onlykappa/KappaForge\nMode: develop\n\nMake add accept numeric strings'}
        with patch.object(developer, 'gh', side_effect=gh), patch.object(developer, 'list_tree', return_value=({'app.py': 40}, {})), \
                patch.object(developer, 'project_guide', return_value=''), patch.object(developer, 'read_source', return_value=SOURCES['app.py']), \
                patch.object(developer, '_add_engine_developer_source', side_effect=lambda sources, *a: sources), \
                patch.object(repair_guard, 'enabled', return_value=True), \
                patch.object(repair_guard, 'verify_findings', side_effect=AssertionError('no verifier')), \
                patch.object(developer, 'generate', side_effect=AssertionError('no code')), \
                patch.object(developer, 'check_the_work', side_effect=review):
            model, summary, changes, explanation, _ = developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, [], 'token', 'key')
        self.assertEqual(changes, {})
        self.assertEqual(seen['changes'], {}, 'the PR as it stands is reviewed')
        self.assertEqual(seen['unfinished'], [fallback])
        self.assertEqual(summary, 'Re-checked the requirements against the current source')
        self.assertEqual(verify.open_problems({'body': explanation}), [], 'a clean review closes the old note')


if __name__ == '__main__':
    unittest.main()

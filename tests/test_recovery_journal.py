"""Failure injection through the real journal, intent guard, generation and runner."""
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest
import urllib.error
from unittest.mock import patch, MagicMock
from engine import developer, intent_guard, recovery, runner


class GitHub:
    """A stateful API boundary with atomic ref creation and the real authorization guard."""
    def __init__(self):
        self.now = time.time()
        self.issue = dict(number=130, title='Change value to 2', state='open', user={'login': 'onlykappa'},
                          created_at=datetime.fromtimestamp(self.now - 60, timezone.utc).isoformat(),
                          body='Repository: onlykappa/KappaForge\nMode: develop\nChange value to 2 and test it.')
        self.rows, self.calls, self.refs = [], [], {'main': 'a' * 40, 'kappa/dev-130': 'b' * 40}
        self.prs = [dict(number=133, html_url='https://github.com/onlykappa/KappaForge/pull/133',
                         head={'sha': 'b' * 40, 'ref': 'kappa/dev-130', 'repo': {'full_name': recovery.ROOT}}, body=developer.review_record(['Implement value 2']))]
        self.run = dict(status='completed', conclusion='failure')
        self.lose_ack = False
        self.files = {'value.py': 'value = 1\n'}
        self.trees = {}
        self.parents = {}
        intent_guard.activate(self.issue)

    def read(self, path):
        if '/issues/133/comments?' in path:
            return []
        if '/comments?' in path:
            page = int(re.search(r'page=(\d+)$', path)[1])
            return copy.deepcopy(self.rows[(page - 1) * 100:page * 100])
        if '/issues?' in path:
            return [copy.deepcopy(self.issue)]
        if '/git/ref/heads/' in path:
            name = path.split('/git/ref/heads/')[1]
            if name not in self.refs:
                raise urllib.error.HTTPError(path, 404, 'missing', {}, None)
            return {'object': {'sha': self.refs[name]}}
        if '/actions/runs/' in path and '/jobs?' not in path:
            return dict(self.run)
        if '/pulls?' in path:
            result = copy.deepcopy(self.prs)
            intent_guard.record_success('https://api.github.com/' + path, None, result)
            return result
        if '/pulls/133/files?' in path:
            return [dict(filename=p, status='modified', patch='value change') for p in self.files]
        if '/actions/runs/' in path and '/jobs?' in path:
            return {'jobs': [dict(id=12, conclusion='failure', steps=[dict(name='Behavioral test', conclusion='failure')])]}

        if '/git/commits/' in path:
            return {'tree': {'sha': 'base'}}
        raise AssertionError('Unhandled GET ' + path)

    def write(self, path, payload, method):
        url = 'https://api.github.com/' + path
        intent_guard.guard_request(url, payload, method, lambda n: self.issue)
        self.calls.append((path, copy.deepcopy(payload), method))
        if path.endswith('/comments'):
            row = dict(id=len(self.rows) + 1, body=payload['body'], user={'login': recovery.BOT})
            self.rows.append(row)
            result = row
        elif '/issues/comments/' in path:
            id = int(path.rsplit('/', 1)[1])
            self.rows[id - 1]['body'] = payload['body']
            result = self.rows[id - 1]
        elif path.endswith('/git/refs'):
            name = payload['ref'].removeprefix('refs/heads/')
            if name in self.refs:
                raise urllib.error.HTTPError(path, 422, 'exists', {}, None)
            self.refs[name] = payload['sha']
            result = {}
        elif '/git/refs/heads/' in path:
            name = path.split('/git/refs/heads/')[1]
            assert not payload.get('force')
            if payload['sha'] != self.refs[name] and self.parents.get(payload['sha']) != self.refs[name]:
                raise urllib.error.HTTPError(path, 422, 'not a fast-forward', {}, None)
            self.refs[name] = payload['sha']
            result = {}
        elif path.endswith('/git/trees'):
            self.trees['tree'] = payload['tree']
            result = {'sha': 'tree'}
        elif path.endswith('/git/commits'):
            for entry in self.trees[payload['tree']]:
                self.files[entry['path']] = entry['content']
            sha = 'c' * 40
            self.parents[sha] = payload['parents'][0]
            result = {'sha': sha}
        elif path.endswith('/pulls/133') and method == 'PATCH':
            self.prs[0].update(payload)
            result = dict(self.prs[0])
        elif path.endswith('/dispatches'):
            if self.lose_ack:
                self.lose_ack = False
                raise urllib.error.URLError('acknowledgement lost')
            result = {}
        else:
            raise AssertionError('Unhandled mutation ' + path)
        intent_guard.record_success(url, payload, result)
        return result

    def journal(self):
        return recovery.Journal(self.issue, self.read, self.write, lambda: self.now)


class RecoveryJournalTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.handle = recovery.CURRENT.set(self.journal)
        self.env = patch.dict(os.environ, {'GITHUB_RUN_ID': '11', 'GITHUB_RUN_ATTEMPT': '1'})
        self.env.start()
        self.journal.begin()

    def tearDown(self):
        recovery.CURRENT.reset(self.handle)
        intent_guard.ACTIVE.set(None)
        developer.Progress.latest = None
        self.env.stop()

    def test_classification_selects_distinct_recovery_strategies(self):
        cases = [(json.JSONDecodeError('Expecting comma', '{bad:1}', 1), 'malformed_json'),
                 (json.JSONDecodeError('Unterminated string', '{"x":"a', 5), 'truncated_output'),
                 (ValueError('Expected a files list'), 'schema'),
                 (ValueError('Edit matched 0 times'), 'edit_anchor'),
                 (ValueError('File was not read: value.py'), 'missing_context'),
                 (ValueError('Syntax check failed'), 'syntax'),
                 (ValueError('Tests failed: assertion'), 'behavioral'),
                 (RuntimeError('HTTP 429'), 'rate_limit'),
                 (RuntimeError('Model routes reached their shared four-minute budget'), 'model_deadline'),
                 (runner.TaskTimeExpired('5-hour-50-minute budget'), 'task_deadline'),
                 (urllib.error.URLError('offline'), 'provider_outage'),
                 (PermissionError('authorization expired'), 'authorization')]
        for error, kind in cases:
            with self.subTest(kind=kind):
                self.assertEqual(recovery.diagnose(error)[0], kind)

    def test_durable_requirements_models_and_rejected_proposals_survive_restart(self):
        j = self.journal
        j.checkpoint('b' * 40, base='main', pr=self.world.prs[0]['html_url'], files=['value.py'])
        j.requirements(['Original requirement', 'Handle missing input'])
        for _ in range(2):
            j.event(ValueError('Edit matched 0 times'), model='writer', signature='proposal')
        restored = self.world.journal()
        self.assertEqual(restored.state['requirements'], ['Original requirement', 'Handle missing input'])
        self.assertIn('writer', restored.avoid_models())
        self.assertTrue(restored.rejected('proposal'))
        self.assertEqual(restored.state['events'][-1]['candidate'], 'b' * 40)

    def test_untrusted_or_embedded_journal_markers_cannot_authorize_queue_work(self):
        self.journal.defer(RuntimeError('offline'))
        body = self.world.rows[0]['body']
        self.world.rows = [dict(id=1, body=body, user={'login': 'onlykappa'}),
                           dict(id=2, body='### Model report\n' + body, user={'login': recovery.BOT})]
        self.assertIsNone(self.world.journal().comment)

    def test_queue_waits_reserves_once_and_duplicate_dispatch_is_consumed_once(self):
        j = self.journal
        j.defer(RuntimeError('HTTP 429'))
        self.assertFalse(j.queue())
        self.world.now += 301
        self.assertTrue(j.queue())
        self.assertFalse(j.queue())
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        restored = self.world.journal()
        action = f'resume:1:{j.scope.digest[:12]}'
        self.assertTrue(restored.begin(action))
        self.assertFalse(self.world.journal().begin(action))

    def test_lost_dispatch_ack_reuses_token_without_incrementing_continuation(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 301
        self.world.lose_ack = True
        with self.assertRaises(urllib.error.URLError):
            self.journal.queue()
        self.world.now += 1201
        recovery.scan(self.world.read, self.world.write, lambda: self.world.now)
        intent_guard.activate(self.world.issue)
        restored = self.world.journal()
        self.assertEqual(restored.state['continuations'], 1)
        self.assertTrue(restored.begin(f'resume:1:{restored.scope.digest[:12]}'))
        self.assertFalse(self.world.journal().begin(f'resume:1:{restored.scope.digest[:12]}'))

    def test_reserved_ref_before_persist_crash_is_reconciled(self):
        j = self.journal
        j.defer(RuntimeError('offline'))
        self.world.now += 1201
        self.world.refs[f'kappa/recovery-130-{j.scope.digest[:12]}-1'] = 'a' * 40
        self.assertTrue(j.queue())
        self.assertEqual(j.state['status'], 'dispatching')

    def test_missing_dispatch_delivery_stops_after_three_bounded_attempts(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 301
        self.journal.queue()
        for _ in range(3):
            self.world.now += 1201
            recovery.scan(self.world.read, self.world.write, lambda: self.world.now)
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 3)
        self.assertEqual(self.world.journal().state['status'], 'blocked')

    def test_near_expiry_is_blocked_instead_of_queuing_impossible_continuation(self):
        self.world.now = self.journal.scope.expires - 600
        self.assertFalse(self.journal.defer(RuntimeError('offline')))
        self.assertEqual(self.journal.state['status'], 'blocked')

    def test_active_runs_are_not_resumed_and_cancelled_runs_stay_stopped(self):
        self.world.run['status'] = 'in_progress'
        self.assertFalse(self.journal.recover_interrupted())
        self.world.run.update(status='completed', conclusion='cancelled')
        self.assertFalse(self.journal.recover_interrupted())
        self.assertEqual(self.journal.state['status'], 'blocked')

    def test_completed_interrupted_worker_enters_waiting_and_retains_candidate(self):
        self.journal.checkpoint('b' * 40, base='main', files=['value.py'])
        self.assertTrue(self.journal.recover_interrupted())
        restored = self.world.journal()
        self.assertEqual(restored.state['status'], 'waiting')
        self.assertEqual(restored.state['candidate'], 'b' * 40)
        self.assertTrue(any('KAPPA_PROGRESS_V1' in row['body'] and '"status": "waiting"' in row['body'] for row in self.world.rows))

    def test_concurrent_branch_updates_are_blocked_before_any_model_work(self):
        self.journal.checkpoint('b' * 40, files=['value.py'])
        self.world.refs['kappa/dev-130'] = 'd' * 40
        self.assertFalse(self.journal.begin())
        self.assertEqual(self.world.refs['kappa/dev-130'], 'd' * 40)
        self.assertEqual(self.journal.state['status'], 'blocked')

    def test_changed_task_cancellation_and_expiry_revoke_continuation(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 301
        self.world.issue['state'] = 'closed'
        with self.assertRaises(PermissionError):
            self.journal.queue()
        self.world.issue['state'] = 'open'
        self.world.issue['body'] += '\nDo something else'
        with self.assertRaises(PermissionError):
            self.journal.queue()
        self.world.now += 86400
        with self.assertRaises(PermissionError):
            self.world.journal()

    def test_continuation_cap_remains_bounded_while_storage_rotates(self):
        self.journal.state['continuations'] = recovery.MAX_CONTINUATIONS
        self.assertFalse(self.journal.defer(RuntimeError('offline')))
        self.assertEqual(self.journal.state['status'], 'blocked')
        self.journal.state['events'] = [dict(sequence=n) for n in range(recovery.MAX_EVENTS)]
        self.journal.event('one more')
        archive = next(row['body'] for row in self.world.rows if 'ARCHIVE_V1' in row['body'])
        saved = json.loads(re.search(r'ARCHIVE_V1 (.*?) -->', archive)[1])
        self.assertEqual(saved['events'] + self.journal.state['events'][:-1],
                         [dict(sequence=n) for n in range(recovery.MAX_EVENTS)])
        self.assertEqual(len(self.journal.state['events']), 21)
        self.assertEqual(self.journal.state['archivedEvents'], 20)

    def test_history_capacity_still_allows_automatic_continuation(self):
        self.journal.state['events'] = [dict(sequence=n) for n in range(recovery.MAX_EVENTS)]
        self.assertTrue(self.journal.defer(runner.ProviderRoutesUnavailable('HTTP 403; HTTP 402')))
        self.assertEqual(self.journal.state['status'], 'waiting')
        self.world.now += 301
        self.journal.queue()
        self.assertEqual(self.journal.state['continuations'], 1)
        self.assertTrue(any(path.endswith('/dispatches') for path, _, _ in self.world.calls))

    def test_archive_write_failure_keeps_every_live_event(self):
        before = [dict(sequence=n) for n in range(recovery.MAX_EVENTS)]
        self.journal.state['events'] = copy.deepcopy(before)
        with patch.object(self.journal, 'write', side_effect=urllib.error.URLError('offline')):
            with self.assertRaises(urllib.error.URLError):
                self.journal.event('next')
        self.assertEqual(self.journal.state['events'], before)

    def test_source_reread_rebuilds_an_already_full_context(self):
        self.journal.loader = lambda path: 'value = 1\n'
        answer = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        budget = developer.SMALL._replace(file_chars=2000, context_chars=1060)
        # The unrelated file almost fills the context. Appending the missing file would fail.
        sources = {'other.py': '#' + 'x' * 1010}
        with patch.object(developer, 'run_model', side_effect=[('writer', answer), ('other', answer)]) as model:
            result = developer.generate_with('key', 'change value', recovery.ROOT, sources,
                                             {'other.py': 1011, 'value.py': 10}, '', None, budget)
        self.assertEqual(result[2]['value.py'], 'value = 2\n')
        self.assertIn('===== FILE value.py =====\nvalue = 1', model.call_args.args[1])
        self.assertNotIn('===== FILE other.py', model.call_args.args[1])

    def test_minified_missing_file_is_visible_within_compact_context(self):
        source = 'const value = 1;/*' + 'x' * 100000 + '*/'
        self.journal.loader = lambda path: source
        answer = json.dumps({'files': [{'path': 'preview/value.js', 'edits': [
            {'find': 'const value = 1;', 'replace': 'const value = 2;'}]}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', answer), ('other', answer)]) as model:
            result = developer.generate_with('key', 'change value', recovery.ROOT, {},
                                             {'preview/value.js': len(source)}, '', None, developer.COMPACT)
        self.assertEqual(result[2]['preview/value.js'], source.replace('const value = 1;', 'const value = 2;'))
        prompt = model.call_args.args[1]
        self.assertIn('===== FILE preview/value.js (LARGE:', prompt)
        self.assertLess(len(prompt), developer.COMPACT.context_chars)

    def test_excerpt_cannot_replace_an_entire_file(self):
        source = 'value = 1\n' + '# comment\n' * 100
        rewrite = json.dumps({'files': [{'path': 'value.py', 'content': 'value = 2\n'}]})
        edit = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        budget = developer.SMALL._replace(file_chars=150)
        with patch.object(developer, 'run_model', side_effect=[('writer', rewrite), ('other', edit)]):
            result = developer.generate_with('key', 'change value', recovery.ROOT,
                                             {'value.py': source}, {'value.py': len(source)}, '', None, budget)
        self.assertEqual(result[2]['value.py'], source.replace('value = 1', 'value = 2'))
        self.assertIn('excerpts', self.journal.state['events'][-1]['error'])

    def test_legacy_requirement_hypotheses_are_retained_for_audit_only(self):
        self.journal.state.pop('requirementOrigin')
        self.journal.state['requirements'] = ['Invented requirement from a diagnostic']
        self.journal.persist()
        resumed = self.world.journal()
        self.assertEqual(resumed.state['requirements'], [])
        self.assertEqual(resumed.state['legacyRequirements'], ['Invented requirement from a diagnostic'])

    def test_review_uses_owner_task_instead_of_repair_hypotheses(self):
        from engine import verify
        with patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(verify, 'model_review', return_value=([{'text': 'Change value to 2', 'met': True}], [], [])) as review:
            developer.check_the_work('key', 'REPAIR HYPOTHESIS: add unrelated feature', recovery.ROOT,
                                     'b' * 40, 'token', {'value.py': 'value = 1'}, {'value.py': 9},
                                     {'value.py': 'value = 2'}, '', None, '', False, MagicMock())
        task = review.call_args.args[2]
        self.assertIn(self.world.issue['body'], task)
        self.assertNotIn('unrelated feature', task)

    def test_provider_route_exhaustion_waits_but_github_403_blocks(self):
        wrapped = developer.GenerationFailure('HTTP 403 on provider', provider_routes=True)
        self.assertTrue(self.journal.defer(wrapped))
        self.assertFalse(self.journal.defer(urllib.error.HTTPError('github', 403, 'forbidden', {}, None)))
        self.assertEqual(self.journal.state['status'], 'blocked')

    def test_continuation_guard_rejects_other_tasks_refs_and_actions(self):
        scope = intent_guard.ACTIVE.get()
        path = 'https://api.github.com/repos/onlykappa/KappaForge/actions/workflows/agent.yml/dispatches'
        valid = {'ref': 'main', 'inputs': {'issue_number': '130', 'action': f'resume:1:{scope.digest[:12]}'}}
        scope.permit(path, valid, 'POST')
        for bad in [dict(valid, ref='candidate'), dict(valid, inputs={'issue_number': '131', 'action': valid['inputs']['action']}),
                    dict(valid, inputs={'issue_number': '130', 'action': 'fix'})]:
            with self.assertRaises(PermissionError):
                scope.permit(path, bad, 'POST')

    def test_missing_context_is_read_from_the_immutable_candidate_before_retry(self):
        self.journal.loader = lambda path: 'value = 1\n'
        answer = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', answer), ('other', answer)]) as model:
            _, _, changes, _ = developer.generate('key', 'update value', recovery.ROOT, {}, {'value.py': 10})
        self.assertEqual(changes['value.py'], 'value = 2\n')
        self.assertIn('===== FILE value.py =====\nvalue = 1', model.call_args.args[1])
        self.assertIn('Reread immutable candidate source: value.py', model.call_args.args[1])
        self.assertEqual(self.journal.state['events'][0]['kind'], 'missing_context')

    def test_runner_resumes_existing_pr_once_and_never_opens_a_duplicate(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 301
        self.journal.queue()
        action = f'resume:1:{self.journal.scope.digest[:12]}'
        with patch.dict(os.environ, {'GITHUB_TOKEN': 'fixture', 'GEMINI_API_KEY': 'fixture',
                'GITHUB_EVENT_NAME': 'workflow_dispatch', 'KAPPA_TASK_SCOPE': 'write', 'INPUT_ACTION': action}), \
                patch.object(runner, 'choose_issue', return_value=self.world.issue), \
                patch.object(runner, 'github', side_effect=lambda path, token=None, payload=None: self.world.read(path) if payload is None else self.world.write(path, payload, 'POST')), \
                patch.object(developer, 'gh', side_effect=lambda path, token, payload=None, method=None: self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')), \
                patch.object(runner, 'request', side_effect=lambda url, payload=None, token=None, method=None: self.world.write(url.removeprefix('https://api.github.com/'), payload, method)), \
                patch.object(developer, 'fix_pull_request', return_value=self.world.prs[0]['html_url']) as fix:
            runner.main()
            runner.main()
        self.assertEqual(fix.call_count, 1)
        self.assertEqual(len(self.world.prs), 1)

    def test_exhausted_proposals_replan_into_smaller_validated_stages(self):
        bad = '{"files":[ BAD ]}'
        plan = json.dumps({'read': ['value.py'], 'stages': ['Change value and add its test', 'Add the remaining helper']})
        first = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]},
                                    {'path': 'test_value.py', 'content': 'from value import value\nassert value == 2\n'}]})
        second = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 2', 'replace': 'value = 2\nready = True'}]}]})
        saved = []
        self.journal.stage_checkpoint = lambda model, summary, changes, explanation: saved.append(dict(changes))
        with patch.object(developer, 'run_model', side_effect=[('writer', bad)] * 10 + [('planner', plan), ('other', first), ('other', second)]):
            _, _, changes, _ = developer.generate('key', 'Change value and add a ready helper', recovery.ROOT,
                                                  {'value.py': 'value = 1\n'}, {'value.py': 10}, require_test=True)
        self.assertEqual(changes['value.py'], 'value = 2\nready = True\n')
        self.assertIn('test_value.py', changes)
        self.assertEqual(len(saved), 2)
        self.assertTrue(any(e['strategy'] == 'split_stages' for e in self.journal.state['events']))

    def test_restored_requirements_cannot_disappear_in_a_later_review(self):
        from engine import verify
        self.journal.requirements(['Original requirement'])
        p = MagicMock()
        with patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(verify, 'model_review', return_value=([{'text': 'New requirement', 'met': True}], [], [])), \
                patch.object(developer, 'generate', return_value=('writer', '', {'value.py': 'value = 2\n'}, '')), \
                patch.object(developer, 'MAX_CHECK_ROUNDS', 1):
            _, _, problems = developer.check_the_work('key', 'original task', recovery.ROOT, 'b' * 40, 'fixture',
                {'value.py': 'value = 1\n'}, {'value.py': 10}, {'value.py': 'value = 2\n'}, '', None, '', False, p)
        self.assertTrue(any('Original requirement' in p for p in problems))
        self.assertEqual(self.journal.state['requirements'], ['Original requirement', 'New requirement'])

    def test_failed_behavioral_test_is_repaired_checkpointed_and_dispatched_for_exact_sha(self):
        from engine import native_build, verify
        self.world.files['test_value.py'] = 'from value import value\nassert value == 1\n'
        good = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]},
                                    {'path': 'test_value.py', 'edits': [{'find': 'value == 1', 'replace': 'value == 2'}]}]})
        def gh(path, token, payload=None, method=None):
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'sandbox_result', return_value={'id': 123, 'status': 'completed', 'conclusion': 'failure'}), \
                patch.object(native_build, 'result', return_value=None), patch.object(developer, 'owner_guidance', return_value=[]), \
                patch.object(developer, 'list_tree', return_value=({p: len(t) for p, t in self.world.files.items()}, {})), \
                patch.object(developer, 'project_guide', return_value=''), patch.object(developer, 'job_log', return_value='AssertionError: expected value 2, got 1'), \
                patch.object(developer, 'read_source', side_effect=lambda repo, path, sha, token: self.world.files[path]), \
                patch.object(developer, 'is_private', return_value=False), patch.object(developer, 'code_providers', return_value={'groq'}), \
                patch.object(developer, 'run_model', return_value=('writer', good)), patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(verify, 'model_review', return_value=([{'text': 'Implement value 2', 'met': True}], [], [])), \
                patch.object(developer, 'dispatch_tests') as dispatch, patch.object(developer, 'notify'):
            url = developer.fix_pull_request(self.world.issue, 'key', 'fixture')
        self.assertEqual(url, self.world.prs[0]['html_url'])
        self.assertEqual(self.world.files['value.py'], 'value = 2\n')
        self.assertIn('value == 2', self.world.files['test_value.py'])
        self.assertEqual(self.journal.state['candidate'], 'c' * 40)
        self.assertEqual(dispatch.call_args.args[2], 'c' * 40)
        self.assertTrue(any(e['strategy'] == 'repair_from_test_evidence' for e in self.journal.state['events']))
        self.assertEqual(len(self.world.prs), 1)

    def test_partial_test_dispatch_resumes_missing_native_check_without_duplicate_sandbox(self):
        from engine import native_build
        self.journal.checkpoint('b' * 40, files=['preview/ui.js'])
        with patch.object(developer, 'sandbox_result', return_value={'status': 'completed', 'conclusion': 'success'}), \
                patch.object(native_build, 'result', return_value=None), patch.object(native_build, 'dispatch') as native, \
                patch.object(developer, 'dispatch_tests') as all_tests:
            result = recovery.resume_checks(self.journal, {'body': developer.review_record([])}, 'fixture')
        self.assertEqual(result, 'testing')
        native.assert_called_once_with('kappa/dev-130', 'b' * 40, 'fixture')
        all_tests.assert_not_called()

    def test_failed_native_checks_and_unmet_requirements_request_repair(self):
        from engine import native_build
        self.journal.checkpoint('b' * 40, files=['preview/ui.js'])
        with patch.object(developer, 'sandbox_result', return_value={'status': 'completed', 'conclusion': 'success'}), \
                patch.object(native_build, 'result', return_value={'status': 'completed', 'conclusion': 'failure'}):
            self.assertEqual(recovery.resume_checks(self.journal, {'body': developer.review_record([])}, 'fixture'), 'fix')
        with patch.object(developer, 'sandbox_result', return_value={'status': 'completed', 'conclusion': 'success'}), \
                patch.object(native_build, 'result', return_value={'status': 'completed', 'conclusion': 'success'}):
            self.assertEqual(recovery.resume_checks(self.journal, {'body': developer.review_record(['Original requirement unmet'])}, 'fixture'), 'fix')

    def test_controlled_end_to_end_recovery_commits_tests_and_resumes_exact_candidate(self):
        self.journal.requirements(['Change value to 2', 'Test the actual value'])
        bad = '{"files":[ BAD ]}'
        good = json.dumps({'files': [{'path': 'value.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]},
                                    {'path': 'test_value.py', 'content': 'from value import value\nassert value == 2\n'}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', bad), ('writer', bad),
                RuntimeError('Model routes reached their shared four-minute budget'), ('other', good)]), \
                patch.object(developer, 'gh', side_effect=lambda path, token, payload=None, method=None:
                             self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')):
            _, _, changes, _ = developer.generate('key', 'Change value to 2 and test it', recovery.ROOT,
                                                  dict(self.world.files), {'value.py': 10}, require_test=True)
            commit = developer.commit_changes(recovery.ROOT, 'b' * 40, changes, {}, 'validated stage', 'fixture')
        self.world.write('repos/onlykappa/KappaForge/git/refs/heads/kappa/dev-130', {'sha': commit['sha'], 'force': False}, 'PATCH')
        self.journal.checkpoint(commit['sha'], base='main', pr=self.world.prs[0]['html_url'], files=changes)
        # Real code and its generated behavioral assertion run in an isolated temp directory.
        with tempfile.TemporaryDirectory() as tmp:
            for path, text in changes.items():
                Path(tmp, path).write_text('value = 1\n' if path == 'value.py' else text)
            before = subprocess.run([sys_executable(), 'test_value.py'], cwd=tmp, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(before.returncode, 0, 'regression assertion must fail before implementation')
            Path(tmp, 'value.py').write_text(changes['value.py'])
            # Avoid timestamp-based bytecode reuse in this same-second fixture.
            import shutil
            shutil.rmtree(Path(tmp, '__pycache__'), ignore_errors=True)
            result = subprocess.run([sys_executable(), 'test_value.py'], cwd=tmp, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.journal.defer(runner.TaskTimeExpired('5-hour-50-minute budget'))
        self.world.now += 301
        recovery.scan(self.world.read, self.world.write, lambda: self.world.now)
        intent_guard.activate(self.world.issue)
        restored = self.world.journal()
        self.assertTrue(restored.begin(f'resume:1:{restored.scope.digest[:12]}'))
        self.assertEqual(restored.state['candidate'], commit['sha'])
        self.assertEqual(restored.state['requirements'], ['Change value to 2', 'Test the actual value'])
        self.assertTrue(any(e['kind'] == 'model_deadline' for e in restored.state['events']))
        self.assertEqual(self.world.refs['main'], 'a' * 40)
        self.assertEqual(len(self.world.prs), 1)


def sys_executable():
    import sys
    return sys.executable

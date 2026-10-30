"""Failure injection through the real journal, intent guard, generation and runner."""
from tests.repair_fixtures import response_or
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
        self.prs = [dict(number=133, state='open', draft=True, html_url='https://github.com/onlykappa/KappaForge/pull/133',
                         head={'sha': 'b' * 40, 'ref': 'kappa/dev-130', 'repo': {'full_name': recovery.ROOT}}, body=developer.review_record(['Implement value 2']))]
        self.run = dict(status='completed', conclusion='failure')
        self.lose_ack = False
        self.files = {'value.py': 'value = 1\n'}
        self.trees = {}
        self.parents = {}
        self.comparisons = {}
        intent_guard.activate(self.issue)

    def read(self, path):
        if path == 'repos/onlykappa/KappaForge/pulls/133':
            return copy.deepcopy(self.prs[0])
        if path == 'repos/onlykappa/KappaForge':
            return {'private': False}
        if path.endswith('/issues/130'):
            return copy.deepcopy(self.issue)
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
        if '/actions/workflows/agent.yml/runs?' in path:
            return {'workflow_runs': []}
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
        if '/compare/' in path:
            return copy.deepcopy(self.comparisons.get(path.split('/compare/')[1], {'status': 'diverged', 'ahead_by': 1, 'commits': []}))
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

    def test_gateway_retry_backoff_is_not_published_as_a_provider_cooldown(self):
        from engine.gateway import GatewayUnavailable
        self.journal.defer(GatewayUnavailable('Gateway timeout; remaining quota is unknown'))
        self.assertEqual(self.journal.state['waitReason'], 'retry')
        latest = self.world.rows[-1]['body']
        self.assertIn('"status":"queued"', latest.replace(' ', ''))
        self.assertIn('Gateway retry scheduled', latest)
        self.assertGreater(self.journal.state['nextAt'], self.world.now)
        self.journal.defer(runner.ProviderRoutesUnavailable('HTTP 429', retry_at=self.world.now+120))
        self.assertEqual(self.journal.state['waitReason'], 'cooldown')
        self.assertIn('recorded provider cooldown', self.world.rows[-1]['body'])

    def test_a_rejected_proposal_continues_promptly_and_is_never_called_a_provider_cooldown(self):
        from engine.developer import GenerationFailure
        failure = GenerationFailure('No validated proposal after 5 distinct attempts. Syntax check failed: engine/developer.py')
        self.assertTrue(self.journal.defer(failure))
        self.assertEqual(self.journal.state['waitReason'], 'continue')
        self.assertFalse(self.journal.state['quotaWait'])
        self.assertEqual(self.journal.state['nextAt'], self.world.now, 'no wait at all without a provider limit')
        latest = self.world.rows[-1]['body']
        self.assertNotIn('cooldown', latest)
        self.assertIn('No provider limit is involved', latest)
        self.assertIn('"status":"queued"', latest.replace(' ', ''))

    def test_targeted_automatic_scan_queues_existing_checkpoint_once(self):
        self.journal.checkpoint('b'*40, files=['value.py'])
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        first = recovery.scan(self.world.read, self.world.write, lambda: self.world.now, task=130)
        second = recovery.scan(self.world.read, self.world.write, lambda: self.world.now, task=130)
        self.assertIn((130, 'queued'), first)
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        intent_guard.activate(self.world.issue)
        self.assertTrue(self.world.journal().begin('resume:1:'+self.journal.scope.digest[:12]))
        self.assertFalse(self.world.journal().begin('resume:1:'+self.journal.scope.digest[:12]))
        self.assertEqual(self.world.journal().state['candidate'], 'b'*40)

    def test_active_previous_runner_does_not_consume_continuation(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        self.world.run['status'] = 'in_progress'
        self.assertFalse(self.world.journal().queue())
        self.assertEqual(self.world.journal().state['continuations'], 0)

    def test_wake_registration_failure_preserves_checkpoint_and_never_sends_inference(self):
        with patch.dict(os.environ, {'KAPPA_ROUTER_URL':'https://kappaforge-chat.ballaking1738.workers.dev', 'KAPPA_ROUTER_TOKEN':'fixture-only'}), patch('urllib.request.urlopen', side_effect=TimeoutError) as transport:
            self.assertTrue(self.journal.defer(RuntimeError('offline')))
            self.assertEqual(self.world.journal().state['status'], 'waiting')
            request = transport.call_args.args[0]
            self.assertTrue(request.full_url.endswith('/router/recovery'))
            self.assertEqual(json.loads(request.data), {'task':130})
            # Cloudflare answers HTTP 403 to Python's default User-Agent; the wake-up must name itself like other calls.
            self.assertEqual(request.get_header('User-agent'), 'KappaForge-Recovery-Wake/1')
            self.assertNotIn('Python-urllib', request.get_header('User-agent'))

    def test_fresh_explicit_authorization_retains_candidate_budgets_and_failure_history(self):
        self.journal.checkpoint('b'*40, files=['value.py'])
        self.journal.event('Edit matched 0 times', model='groq:model', signature='rejected')
        previous = self.journal.scope.digest
        old_identity = self.journal.scope.identity
        self.world.issue['body'] += '\nApproved from KappaForge Chat.\n<!-- kappa-authorization:' + json.dumps(dict(id='fresh-owner', conversationId='chat', requestId='fresh-owner', repo=recovery.ROOT, mode='develop', expiresAt=(self.world.now+86400)*1000, resumeFrom={'digest':previous,'authorization':old_identity})) + ' -->'
        intent_guard.activate(self.world.issue)
        renewed = self.world.journal()
        self.assertEqual(renewed.state['candidate'], 'b'*40)
        self.assertEqual(renewed.state['budgets'], self.journal.state['budgets'])
        self.assertTrue(renewed.ledger)
        renewed.begin("fix")
        self.assertEqual(self.world.journal().state['authorization'], 'fresh-owner')
        self.assertTrue(self.world.journal().ledger)

    def test_targeted_watchdog_recovers_lost_initial_dispatch_to_one_runner(self):
        self.world.rows = []
        self.world.run['status'] = 'in_progress'  # the scanner itself is active, not an agent
        results = recovery.scan(self.world.read, self.world.write, lambda: self.world.now, task=130)
        self.assertIn((130, 'queued'), results)
        intent_guard.activate(self.world.issue)
        journal = self.world.journal()
        self.assertTrue(journal.begin('resume:1:'+journal.scope.digest[:12]))
        self.assertFalse(self.world.journal().begin('resume:1:'+journal.scope.digest[:12]))

    def test_pending_github_run_prevents_lost_ack_redelivery(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        self.journal.queue()
        self.world.now += 121
        original = self.world.read
        def read(path):
            if '/actions/workflows/agent.yml/runs?' in path:
                return {'workflow_runs':[{'display_title':f'Agent task #130 resume:1:{self.journal.scope.digest[:12]}','status':'queued'}]}
            return original(path)
        recovery.scan(read, self.world.write, lambda:self.world.now, task=130)
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        self.assertEqual(self.world.journal().state['dispatchAttempts'], 1)

    def test_cancelled_waiting_run_and_modified_brief_are_not_restarted(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        self.world.run['conclusion'] = 'cancelled'
        self.assertFalse(self.world.journal().queue())
        self.assertEqual(self.world.journal().state['status'], 'blocked')
        self.world.issue['body'] += '\nUnapproved expanded scope'
        intent_guard.activate(self.world.issue)
        with self.assertRaisesRegex(PermissionError, 'scope changed'):
            self.world.journal()

    def test_crash_after_atomic_ref_is_reconciled_after_ack_window(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 121
        self.world.refs[f'kappa/recovery-130-{self.journal.scope.digest[:12]}-1'] = 'a'*40
        self.assertTrue(self.world.journal().queue())
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)

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

    def test_task_191_source_words_do_not_block_edit_recovery(self):
        from engine.edit_errors import SourceNotRead
        for word in ('/authorization', 'unauthorized', 'protected path', 'authorization expired', 'HTTP 403'):
            for count in (0, 2):
                with self.subTest(word=word, count=count):
                    error = developer.EditMismatch('value.py', word, 'value = 1\n', count)
                    self.assertEqual(recovery.diagnose(error), ('edit_anchor', 'reread_source'))
                    self.journal.event(error, model='writer')
                    self.assertEqual(self.journal.state['executionState'], 'recovering')
        # This is the next failure in task #191; it must not crash on a transition
        # out of a falsely persisted blocked_authorization state.
        self.journal.event(SourceNotRead('tests/authorization.test.mjs', overwrite=True))
        restored = self.world.journal()
        self.assertEqual(restored.state['events'][-1]['kind'], 'missing_context')
        self.assertEqual(restored.state['executionState'], 'recovering')
        self.assertEqual(restored.state['events'][-1]['files'], ['tests/authorization.test.mjs'])

    def test_task_191_generation_rereads_anchor_then_unread_file_and_succeeds(self):
        source = '# /authorization\nvalue = 1\n'
        candidate = {'value.py': source, 'test_weather.py': 'ready = False\n'}
        reads = []
        def load(path):
            reads.append(path)
            return candidate[path]
        self.journal.loader = load
        missing = {'files': [{'path': 'value.py', 'edits': [
            {'find': '# /authorization expired\nvalue = 0', 'replace': 'value = 2'}]}]}
        unread = {'files': [{'path': 'test_weather.py', 'content': 'ready = True\n'}]}
        with patch.object(developer, 'run_model', side_effect=[('writer', json.dumps(missing)),
                ('writer', json.dumps(unread)), ('other', json.dumps(unread))]) as model:
            _, _, changes, _ = developer.generate('key', 'repair weather', recovery.ROOT,
                                                  {'value.py': source}, {p: len(t) for p, t in candidate.items()})
        self.assertEqual(changes, {'test_weather.py': 'ready = True\n'})
        self.assertEqual(candidate['test_weather.py'], 'ready = False\n')
        self.assertEqual(reads, ['value.py', 'test_weather.py'])
        self.assertEqual(model.call_count, 3)
        self.assertIn('test_weather.py', model.call_args.args[1])
        self.assertEqual(self.world.journal().state['executionState'], 'recovering')

    def test_real_authorization_failure_still_stops_recovery(self):
        error = PermissionError('authorization expired')
        self.assertEqual(recovery.diagnose(error), ('authorization', 'stop'))
        self.assertFalse(self.journal.defer(error))
        restored = self.world.journal()
        self.assertEqual(restored.state['executionState'], 'blocked_authorization')

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
        self.assertEqual(j.state['continuations'], 0, 'cooldown waiting does not consume a continuation')
        self.assertFalse(j.queue())
        self.world.now += 301
        self.assertTrue(j.queue())
        self.assertFalse(j.queue())
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        restored = self.world.journal()
        action = f'resume:1:{j.scope.digest[:12]}'
        self.assertTrue(restored.begin(action))
        self.assertFalse(self.world.journal().begin(action))

    def test_transient_failure_is_eligible_after_one_minute_without_early_or_duplicate_dispatch(self):
        start = self.world.now
        self.journal.defer(urllib.error.URLError('temporary outage'))
        self.assertEqual(self.journal.state['nextAt'], start + 60)
        self.world.now = start + 59
        self.assertFalse(self.world.journal().queue())
        self.assertEqual(self.world.journal().state['continuations'], 0)
        self.world.now = start + 61
        restarted = self.world.journal()
        self.assertTrue(restarted.queue())
        self.assertFalse(self.world.journal().queue())
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        progress = json.loads(re.search(r'KAPPA_PROGRESS_V1 (.*?) -->', next(r['body'] for r in self.world.rows if 'KAPPA_PROGRESS_V1' in r['body']))[1])
        self.assertEqual(progress['recovery']['scanIntervalSeconds'], 300)
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/recovery.yml').read_text()
        self.assertIn("cron: '2-57/5 * * * *'", workflow)

    def test_one_minute_eligibility_keeps_later_provider_and_account_cooldowns(self):
        start = self.world.now
        self.journal.state['routingAvailability'] = {'retryAt': start + 7200}
        self.journal.defer(runner.ProviderRoutesUnavailable('outage', retry_at=start + 3600))
        self.assertEqual(self.journal.state['nextAt'], start + 7205, 'resume 5s after the later recorded reset')
        self.world.now = start + 61
        self.assertFalse(self.world.journal().queue())
        self.assertEqual(self.world.journal().state['continuations'], 0)

    def test_pinned_failure_preserves_route_without_automatic_continuation(self):
        self.journal.scope.inference_route = 'groq:openai/gpt-oss-120b'
        self.assertFalse(self.journal.defer(RuntimeError('Gateway HTTP 503; upstream cause unknown')))
        self.assertEqual(self.journal.state['events'][-1]['model'], 'groq:openai/gpt-oss-120b')
        self.assertEqual(self.journal.state['status'], 'blocked')
        self.assertEqual(self.journal.state['continuations'], 0)
        restored = self.world.journal()
        self.assertEqual(restored.state['events'][-1]['model'], 'groq:openai/gpt-oss-120b')
        self.world.now += 1200
        self.assertFalse(restored.queue())

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
        # An interrupted worker is not a provider limit: it is queued for the next scan, never shown as a cooldown.
        self.assertTrue(any('KAPPA_PROGRESS_V1' in row['body'] and '"status": "queued"' in row['body']
                            and 'No provider limit is involved' in row['body'] for row in self.world.rows))
        self.assertEqual(restored.state['waitReason'], 'continue')

    def test_concurrent_branch_updates_are_blocked_before_any_model_work(self):
        self.journal.checkpoint('b' * 40, files=['value.py'])
        self.world.refs['kappa/dev-130'] = 'd' * 40
        self.assertFalse(self.journal.begin())
        self.assertEqual(self.world.refs['kappa/dev-130'], 'd' * 40)
        self.assertEqual(self.journal.state['status'], 'blocked')

    def review(self, commits=1, guidance_delay=60, author='onlykappa', body='Guidance: make the review tests pass'):
        """An owner review commit on top of the checkpoint, then (optionally) a guidance comment."""
        self.journal.checkpoint('b' * 40, files=['value.py'])
        self.world.refs['kappa/dev-130'] = 'd' * 40
        stamp = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z')
        committed = self.world.now - 120
        self.world.comparisons['b' * 40 + '...' + 'd' * 40] = {
            'status': 'ahead', 'ahead_by': commits,
            'commits': [{'commit': {'committer': {'date': stamp(committed)}}} for _ in range(commits)],
            'files': [{'filename': 'tests/test_value.py'}]}
        if guidance_delay is not None:
            self.world.rows.append(dict(id=len(self.world.rows) + 1, body=body, user={'login': author},
                                        created_at=stamp(committed + guidance_delay)))

    def test_owner_review_commits_with_later_guidance_are_continued_from(self):
        self.review()
        self.assertTrue(self.journal.begin('fix'))  # The automatic fix the failing review tests start.
        self.assertEqual(self.journal.state['candidate'], 'd' * 40)
        self.assertEqual(self.journal.state['files'], ['tests/test_value.py', 'value.py'])
        self.assertIn('Adopted 1 owner-reviewed commit', json.dumps(self.journal.state['events']))
        self.assertEqual(self.world.refs['kappa/dev-130'], 'd' * 40, 'the branch itself is never moved')

    def test_reviewed_head_supersedes_and_archives_old_unpublished_fix_without_claiming_publication(self):
        from engine import execution
        self.review()
        patch = {'value.py': 'value = 999  # rejected proposal\n'}
        execution.seed(self.journal, recovery.ROOT, 'a' * 40, patch, 'Fix value', {'kind': 'fix'})
        receipt = copy.deepcopy(self.journal.state['executionCheckpoint'])
        published = self.journal.state.get('executionPublished')
        self.world.comparisons['a' * 40 + '...' + 'd' * 40] = {'status': 'ahead'}
        self.assertTrue(self.journal.begin('fix'))
        self.assertEqual(self.journal.state['candidate'], 'd' * 40)
        self.assertIsNone(execution.pending(self.world.journal(), 'fix'))
        self.assertEqual(self.journal.state.get('executionPublished'), published)
        archives = [row['body'] for row in self.world.rows if '"kind":"supersededExecution"' in row['body']]
        self.assertEqual(len(archives), 1)
        self.assertIn('rejected proposal', archives[0])
        self.assertEqual(self.journal.state['executionCheckpoint'], receipt)
        execution.seed(self.journal, recovery.ROOT, 'd' * 40, {'value.py': 'value = 2\n'}, 'Fix value', {'kind': 'fix'})
        self.assertEqual(execution.pending(self.journal, 'fix')['changes'], {'value.py': 'value = 2\n'})

    def test_missing_owner_guidance_does_not_retire_pending_fix(self):
        from engine import execution
        self.review(guidance_delay=None)
        execution.seed(self.journal, recovery.ROOT, 'b' * 40, {'value.py': 'value = 2\n'}, 'Fix value', {'kind': 'fix'})
        self.assertFalse(self.journal.begin('fix'))
        self.assertNotIn('supersededExecution', self.journal.state)
        self.assertIsNotNone(execution.pending(self.journal, 'fix'))

    def test_diverged_proposal_base_blocks_reviewed_adoption_and_keeps_evidence(self):
        from engine import execution
        self.review()
        execution.seed(self.journal, recovery.ROOT, 'a' * 40, {'value.py': 'value = 2\n'}, 'Fix value', {'kind': 'fix'})
        with self.assertRaises(execution.CheckpointMismatch):
            self.journal.begin('fix')
        self.assertNotIn('supersededExecution', self.journal.state)
        self.assertEqual(self.journal.state['candidate'], 'b' * 40)
        self.assertIsNotNone(execution.pending(self.journal, 'fix'))

    def test_explicit_fix_adopts_reviewed_commits_after_terminal_budget_stop(self):
        from engine.reliability import RecoveryBudgetExceeded
        self.review()
        self.journal.state['budgets'] = {'modelCalls': 160, 'edits': 1, 'fixCycles': 18}
        self.journal.event(RecoveryBudgetExceeded('Task modelCalls budget exhausted', terminal=True),
                           outcome='blocked', strategy='stop')
        resumed = self.world.journal()
        self.assertEqual(resumed.state['executionState'], 'failed_terminal')
        history = copy.deepcopy(resumed.state['events'])
        self.assertTrue(resumed.begin('fix'))
        self.assertEqual(resumed.state['candidate'], 'd' * 40)
        self.assertEqual(resumed.state['executionState'], 'running')
        self.assertEqual(resumed.state['budgets'], {'modelCalls': 160, 'edits': 1, 'fixCycles': 18})
        self.assertEqual(resumed.state['events'][:len(history)], history)
        self.assertFalse(resumed._resuming)
        self.assertEqual(self.world.journal().state['candidate'], 'd' * 40)

    def test_terminal_adoption_does_not_get_manual_fix_authority_from_other_actions(self):
        from engine.reliability import RecoveryBudgetExceeded
        self.review()
        self.journal.event(RecoveryBudgetExceeded('Task modelCalls budget exhausted', terminal=True),
                           outcome='blocked', strategy='stop')
        for action in ('', 'verify'):
            with self.subTest(action=action):
                resumed = self.world.journal()
                with self.assertRaises(RecoveryBudgetExceeded):
                    resumed.begin(action)
                self.assertEqual(self.world.journal().state['candidate'], 'b' * 40)
                self.assertEqual(self.world.journal().state['executionState'], 'failed_terminal')

    def test_terminal_fix_still_requires_post_commit_owner_guidance(self):
        from engine.reliability import RecoveryBudgetExceeded
        self.review(guidance_delay=None)
        self.journal.event(RecoveryBudgetExceeded('Task modelCalls budget exhausted', terminal=True),
                           outcome='blocked', strategy='stop')
        resumed = self.world.journal()
        with self.assertRaises(RecoveryBudgetExceeded):
            resumed.begin('fix')
        self.assertEqual(self.world.journal().state['candidate'], 'b' * 40)
        self.assertEqual(self.world.journal().state['executionState'], 'failed_terminal')

    def test_other_branch_moves_stay_blocked(self):
        for kwargs in ({'guidance_delay': None}, {'guidance_delay': -30}, {'author': 'someone-else'},
                       {'body': 'Looks fine to me'}, {'commits': recovery.MAX_ADOPTED_COMMITS + 1}):
            with self.subTest(**kwargs):
                self.tearDown()  # A fresh world per case, without leaking the previous journal or patches.
                self.setUp()
                self.review(**kwargs)
                self.assertFalse(self.journal.begin('fix'))
                self.assertEqual(self.journal.state['status'], 'blocked')
                self.assertEqual(self.journal.state['candidate'], 'b' * 40)

    def test_scheduled_recovery_resumes_candidate_drift_only_after_owner_guidance(self):
        self.review(guidance_delay=None)
        self.assertFalse(self.journal.begin('fix'))
        self.assertEqual(self.world.journal().state['status'], 'blocked')
        stamp = datetime.fromtimestamp(self.world.now, timezone.utc).isoformat().replace('+00:00', 'Z')
        self.world.rows.append(dict(id=len(self.world.rows) + 1, body='Guidance: continue the reviewed task',
                                    user={'login': 'onlykappa'}, created_at=stamp))

        results = recovery.scan(self.world.read, self.world.write, lambda: self.world.now)

        self.assertIn((130, 'queued'), results)
        resumed = self.world.journal()
        self.assertEqual(resumed.state['candidate'], 'd' * 40)
        self.assertEqual(resumed.state['status'], 'dispatching')
        self.assertEqual(resumed.state['continuations'], 1)
        self.assertEqual(self.world.refs['kappa/dev-130'], 'd' * 40, 'automatic recovery never moves the candidate branch')
        self.assertEqual(len([call for call in self.world.calls if call[0].endswith('/dispatches')]), 1)

    def test_scheduled_recovery_does_not_resume_candidate_drift_without_owner_guidance(self):
        self.review(guidance_delay=None)
        self.assertFalse(self.journal.begin('fix'))

        results = recovery.scan(self.world.read, self.world.write, lambda: self.world.now)

        self.assertIn((130, 'blocked'), results)
        self.assertEqual(self.world.journal().state['candidate'], 'b' * 40)
        self.assertEqual(self.world.journal().state['continuations'], 0)
        self.assertFalse(any(call[0].endswith('/dispatches') for call in self.world.calls))

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
        self.assertFalse(self.journal.defer(ValueError('syntax check failed')))
        self.assertEqual(self.journal.state['status'], 'blocked')
        self.journal.state['events'] = [dict(sequence=n) for n in range(recovery.MAX_EVENTS)]
        self.journal.event('one more')
        archive = next(row['body'] for row in self.world.rows if 'ARCHIVE_V1' in row['body'])
        saved = json.loads(re.search(r'ARCHIVE_V1 (.*?) -->', archive)[1])
        self.assertEqual(saved['events'] + self.journal.state['events'][:-1],
                         [dict(sequence=n) for n in range(recovery.MAX_EVENTS)])
        self.assertEqual(len(self.journal.state['events']), 21)
        self.assertEqual(self.journal.state['archivedEvents'], 20)

    def test_provider_limits_have_their_own_resume_allowance(self):
        # Three failed attempts are used up, but waiting out a rate limit is not a failed attempt: the task keeps going.
        self.journal.state['continuations'] = recovery.MAX_CONTINUATIONS
        self.assertTrue(self.journal.defer(RuntimeError('HTTP 429 rate-limited')))
        self.world.now += 301
        self.assertTrue(self.journal.queue())
        restored = self.world.journal()
        self.assertEqual((restored.state['continuations'], restored.state['quotaResumes']), (recovery.MAX_CONTINUATIONS + 1, 1))
        self.assertTrue(restored.begin(f'resume:{recovery.MAX_CONTINUATIONS + 1}:{restored.scope.digest[:12]}'))
        self.assertFalse(restored.defer(ValueError('syntax check failed')), 'other failures keep their own cap')

    def test_guard_admits_exactly_the_journal_continuation_range(self):
        top = recovery.MAX_CONTINUATIONS + recovery.MAX_QUOTA_RESUMES
        for n in range(0, top + 3):
            self.assertEqual(bool(re.fullmatch(intent_guard.RESUME_NUMBER, str(n))), 1 <= n <= top, n)

    def test_provider_limit_resumes_stay_bounded(self):
        self.journal.state.update(continuations=recovery.MAX_QUOTA_RESUMES, quotaResumes=recovery.MAX_QUOTA_RESUMES)
        self.assertFalse(self.journal.defer(RuntimeError('HTTP 429 rate-limited')))
        self.assertEqual(self.journal.state['status'], 'blocked')
        self.assertIn('needs your review', self.journal.notes.render())

    def test_pause_is_written_to_progress_md_and_read_back_on_resume(self):
        self.journal.note(plan=['Add the setting', 'Show it on the page'], done=['Stage 1 (written by groq:x): added it'],
                          files=['value.py'], model='groq:x')
        self.journal.defer(RuntimeError('HTTP 429 rate-limited'))
        note = next(r for r in self.world.rows if r['body'].startswith('### KappaForge PROGRESS.md'))
        self.assertIn('- [x] 1. Add the setting', note['body'])
        self.assertIn('- [ ] 2. Show it on the page', note['body'])
        self.assertIn('Last pause', note['body'])
        self.assertEqual(sum(r['body'].startswith('### KappaForge PROGRESS.md') for r in self.world.rows), 1, 'edited in place')
        restored = self.world.journal()
        self.assertEqual(restored.notes.remaining(), ['Show it on the page'])
        brief = restored.notes.brief()
        self.assertIn('2. [not done] Show it on the page', brief)
        self.assertIn('Files changed so far: value.py', brief)
        self.assertIn('429', brief)

    def test_notes_clear_pause_on_begin_and_complete_only_when_verified(self):
        from engine import native_build
        self.journal.note(plan=['Implement', 'Test'], done=['Stage 1: Implemented'], status='Paused')
        self.journal.defer(RuntimeError('HTTP 429 rate-limited'))
        self.world.now += 301
        self.assertTrue(self.journal.queue())
        restored = self.world.journal()
        self.assertTrue(restored.begin(f"resume:1:{restored.scope.digest[:12]}"))
        self.assertEqual(restored.notes.data['status'], 'Running: resumed saved work')
        self.assertEqual(restored.notes.remaining(), ['Test'])
        restored.checkpoint('b' * 40, files=['value.py'])
        with patch.object(developer, 'sandbox_result', return_value={'status': 'completed', 'conclusion': 'success'}), \
                patch.object(native_build, 'needed', return_value=False), patch.object(native_build, 'result', return_value=None):
            self.assertEqual(recovery.resume_checks(restored, {'body': developer.review_record([])}, 'fixture'), 'ready')
        notes = self.world.journal().notes
        self.assertEqual(notes.remaining(), [])
        self.assertIn('ready for owner review', notes.data['status'])

    def test_progress_md_from_anyone_but_the_bot_is_ignored(self):
        self.journal.note(plan=['Real plan'])
        forged = dict(next(r for r in self.world.rows if r['body'].startswith('### KappaForge PROGRESS.md')))
        forged['body'] = forged['body'].replace('Real plan', 'Delete everything')
        self.world.rows.append(dict(forged, id=len(self.world.rows) + 1, user={'login': 'onlykappa'}))
        self.assertEqual(self.world.journal().notes.data['plan'], ['Real plan'])

    def test_a_failed_progress_note_never_stops_the_task(self):
        self.journal.notes.save = MagicMock(side_effect=urllib.error.URLError('down'))
        self.assertTrue(self.journal.defer(RuntimeError('HTTP 429 rate-limited')))
        self.assertEqual(self.journal.state['status'], 'waiting')

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
        self.journal.persist()
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

    def test_required_source_survives_compact_round_and_checkpoint_reload(self):
        self.journal.loader = lambda path: 'value = 1\n'
        proposal = json.dumps({'files':[{'path':'value.py','edits':[{'find':'value = 1','replace':'value = 2'}]}]})
        with patch.object(developer, 'run_model', side_effect=[('first',proposal),('second',proposal)]):
            developer.generate_with('key','Change the number',recovery.ROOT,{}, {'value.py':10},'',None,developer.COMPACT)
        restored = self.world.journal()
        self.assertEqual(restored.state['sourcePriority'], ['value.py'])
        restored.checkpoint('c'*40)
        restored.loader = lambda path: 'value = 3\n'  # New candidate, never the earlier content.
        handle = recovery.CURRENT.set(restored)
        try:
            proposal = json.dumps({'files':[{'path':'value.py','edits':[{'find':'value = 3','replace':'value = 4'}]}]})
            with patch.object(developer,'run_model',return_value=('next',proposal)) as model:
                result = developer.generate_with('key','Continue the repair',recovery.ROOT,{'other.py':'#'+'x'*1010},
                    {'value.py':10,'other.py':1011},'',None,developer.COMPACT._replace(context_chars=1060))
            self.assertEqual(result[2]['value.py'],'value = 4\n')
            self.assertEqual(model.call_count,1,'the target is present before wasting another model call')
            self.assertIn('===== FILE value.py =====\nvalue = 3',model.call_args.args[1])
        finally:
            recovery.CURRENT.reset(handle)

    def test_saved_changed_file_is_visible_without_overwriting_current_stage_content(self):
        self.journal.state['files']=['value.py']
        self.journal.loader = MagicMock(return_value='value = 1\n')
        proposal=json.dumps({'files':[{'path':'value.py','edits':[{'find':'value = 3','replace':'value = 4'}]}]})
        with patch.object(developer,'run_model',return_value=('writer',proposal)) as model:
            result=developer.generate_with('key','Finish the current stage',recovery.ROOT,
                {'other.py':'#'+'x'*1010,'value.py':'value = 3\n'}, {'other.py':1011,'value.py':10},'',None,
                developer.COMPACT._replace(context_chars=1060))
        self.assertEqual(model.call_count,1)
        self.assertEqual(result[2]['value.py'],'value = 4\n')
        self.journal.loader.assert_not_called()

    def test_protected_dependency_can_be_read_but_not_edited(self):
        source='{"routing":"public configuration"}'
        self.journal.loader=MagicMock(return_value=source)
        proposal=json.dumps({'files':[{'path':'value.py','edits':[{'find':'value = 1','replace':'value = 2'}]}]})
        with patch.object(developer,'run_model',return_value=('writer',proposal)) as model:
            result=developer.generate_with('key','Read config/providers.json and update value.py',recovery.ROOT,
                {'value.py':'value = 1\n'}, {'value.py':10,'config/providers.json':len(source)},'',None,developer.COMPACT)
        self.assertEqual(result[2],{'value.py':'value = 2\n'})
        self.journal.loader.assert_called_once_with('config/providers.json')
        self.assertIn(source,model.call_args.args[1])
        changes=developer.apply_changes({'config/providers.json':source},{'config/providers.json':len(source)},
                {'files':[{'path':'config/providers.json','content':'{"routing":"private"}'}]})
        self.assertEqual(changes,{'config/providers.json':'{"routing":"private"}'})

    def test_multiple_repair_targets_survive_retry_prompt_compaction(self):
        self.journal.state['sourcePriority']=['one.py','two.py']
        sources={p:'value = 1\n'+'# filler\n'*220 for p in ['one.py','two.py']}
        sources['other.py']='# unrelated\n'*100
        existing={p:len(text) for p,text in sources.items()}
        good=json.dumps({'files':[{'path':p,'edits':[{'find':'value = 1','replace':'value = 2'}]} for p in ['one.py','two.py']]})
        bad=json.dumps({'files':[{'path':'one.py','edits':[{'find':'missing anchor','replace':'value = 2'}]}]})
        prompts=[]
        def model(*args,**kwargs):
            prompts.append(args[1])
            if len(prompts)==1:
                runner.PROVIDERS['routing']['defaults']['maxPromptChars']=len(args[1])+200
                return 'first',bad
            return 'second',good
        with patch.dict(os.environ,{'KAPPA_ROUTER_REQUIRED':'true'}), \
                patch.dict(runner.PROVIDERS['routing']['defaults'],{'maxPromptChars':15000}), \
                patch.object(developer,'run_model',side_effect=model):
            result=developer.generate_with('key','Change both numbers. Do not merge.',recovery.ROOT,sources,existing,'',None,
                developer.COMPACT._replace(context_chars=8000))
            from engine import gateway
            self.assertTrue(all(gateway.prompt_fits(p) for p in prompts))
            for prompt in prompts:
                self.assertIn('===== FILE one.py',prompt)
                self.assertIn('===== FILE two.py',prompt)
                self.assertIn('Do not merge.',prompt)
            self.assertEqual(len(result[2]),2)
            self.assertLess(len(prompts[1]),len(prompts[0])+200)

    def test_required_files_that_cannot_fit_are_split_instead_of_silently_dropped(self):
        self.journal.state['sourcePriority']=['one.py','two.py']
        sources={p:'value = 1\n'+'# filler\n'*100 for p in ['one.py','two.py']}
        with patch.object(developer,'run_model') as model:
            with self.assertRaisesRegex(developer.GenerationFailure,'split the repair'):
                developer.generate_with('key','Repair both files',recovery.ROOT,sources,
                    {p:len(t) for p,t in sources.items()},'',None,developer.COMPACT._replace(context_chars=300))
        model.assert_not_called()

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

    def test_runner_continues_a_plan_only_draft_instead_of_repairing_it(self):
        # The run stopped after opening the draft with the plan and before any code was saved.
        self.journal.checkpoint('b' * 40, base='main', pr=self.world.prs[0]['html_url'])
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
                patch.object(developer, 'fix_pull_request') as fix, \
                patch.object(developer, 'produce_development_pr', return_value=self.world.prs[0]['html_url']) as produce:
            runner.main()
        fix.assert_not_called()
        self.assertEqual(produce.call_count, 1)
        self.assertEqual(produce.call_args.kwargs['adopt']['html_url'], self.world.prs[0]['html_url'])
        self.assertEqual(len(self.world.prs), 1)

    def test_five_failed_proposals_stop_before_any_extra_recovery_attempt(self):
        bad = '{"files":[ BAD ]}'
        saved = []
        self.journal.stage_checkpoint = lambda model, summary, changes, explanation: saved.append(dict(changes))
        with patch.object(developer, 'run_model', side_effect=[('writer', bad)] * 10) as model:
            with self.assertRaisesRegex(ValueError, '5 distinct attempts'):
                developer.generate('key', 'Change value and add a ready helper', recovery.ROOT,
                                   {'value.py': 'value = 1\n'}, {'value.py': 10}, require_test=True)
        self.assertEqual(model.call_count, 5)
        self.assertEqual(saved, [])
        self.assertFalse(any(e['strategy'] == 'split_stages' for e in self.journal.state['events']))

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
        self.journal.note(plan=['Change value', 'Add test'], done=['Stage 1: Changed value'],
                          files=['value.py'], status='Paused for a provider limit; resumes automatically')
        self.world.files['test_value.py'] = 'from value import value\nassert value == 1\n'
        good = json.dumps({'files': [{'path': 'value.py', 'reason': 'Implement the requested value', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]},
                                    {'path': 'test_value.py', 'reason': 'Test the requested value behavior', 'edits': [{'find': 'value == 1', 'replace': 'value == 2'}]}]})
        def gh(path, token, payload=None, method=None):
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'sandbox_result', return_value={'id': 123, 'status': 'completed', 'conclusion': 'failure'}), \
                patch.object(native_build, 'result', return_value=None), patch.object(developer, 'owner_guidance', return_value=[]), \
                patch.object(developer, 'list_tree', return_value=({p: len(t) for p, t in self.world.files.items()}, {})), \
                patch.object(developer, 'project_guide', return_value=''), patch.object(developer, 'job_log', return_value='AssertionError: expected value 2, got 1'), \
                patch.object(developer, 'read_source', side_effect=lambda repo, path, sha, token: self.world.files[path]), \
                patch.object(developer, 'is_private', return_value=False), patch.object(developer, 'code_providers', return_value={'groq'}), \
                patch.object(developer, 'run_sandbox_repair', side_effect=lambda repo, sha, token, changes, *a, **k: {
                    'status': 'success', 'stop_reason': 'validated', 'summary': 'simulated test pass',
                    'candidate_changes': dict(changes), 'test_results': [{'status': 'passed', 'ran': 1}],
                    'attempts': [], 'models': [], 'logs': 'simulated test pass'}), \
                patch.object(developer, 'run_model', side_effect=lambda key, prompt, **kw: response_or(prompt, ('writer', good))), patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(verify, 'model_review', return_value=([{'text': 'Implement value 2', 'met': True}], [], [])), \
                patch.object(developer, 'dispatch_tests') as dispatch, patch.object(developer, 'notify'):
            url = developer.fix_pull_request(self.world.issue, 'key', 'fixture')
        self.assertEqual(url, self.world.prs[0]['html_url'])
        self.assertEqual(self.world.files['value.py'], 'value = 2\n')
        self.assertIn('value == 2', self.world.files['test_value.py'])
        self.assertEqual(self.journal.state['candidate'], 'c' * 40)
        self.assertEqual(dispatch.call_args.args[2], 'c' * 40)
        restored = self.world.journal()
        self.assertEqual(restored.notes.remaining(), [])
        self.assertIn('test_value.py', restored.notes.data['files'])
        self.assertIn('writer', restored.notes.data['models'])
        self.assertEqual(restored.notes.data['status'], 'Repair saved; independent tests running')
        self.assertIn('2. [done] Add test', restored.notes.brief())
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

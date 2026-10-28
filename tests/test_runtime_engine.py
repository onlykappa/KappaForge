"""Engine freshness, owner attestation and recovery through the real journal/authorization guard."""
import copy
import json
import os
import subprocess
import unittest
import urllib.error
from unittest.mock import patch
from engine import intent_guard, recovery, runtime_engine
from tests.test_recovery_journal import GitHub


class RuntimeEngineTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.origin = dict(event='workflow_dispatch', path='.github/workflows/agent.yml',
                           display_title='Agent task #130 fix',
                           head_branch='kappa/dev-130', head_sha='b' * 40, repository={'full_name': recovery.ROOT},
                           actor={'login': 'onlykappa'}, triggering_actor={'login': 'onlykappa'}, status='completed')
        self.runs = {'31': self.origin}
        base = self.world.read
        self.world.read = lambda path: copy.deepcopy(self.runs[path.rsplit('/', 1)[1]]) if path.rsplit('/', 1)[1] in self.runs else base(path)
        self.env = dict(GITHUB_REPOSITORY=recovery.ROOT, GITHUB_SHA='b' * 40, GITHUB_RUN_ID='31',
                        GITHUB_REF_NAME='kappa/dev-130', INPUT_ACTION='fix', KAPPA_ENGINE_CHECK='true')
        self.environment = patch.dict(os.environ, self.env)
        self.environment.start()
        self.checkout = patch.object(subprocess, 'check_output', return_value='b' * 40 + '\n')
        self.checkout.start()
        self.journal = self.world.journal()
        self.journal.begin('fix')

    def tearDown(self):
        self.checkout.stop()
        self.environment.stop()
        intent_guard.ACTIVE.set(None)

    def test_retry_uses_attested_engine_not_main_or_new_candidate(self):
        self.world.refs['kappa/dev-130'] = 'c' * 40  # Candidate edits do not authorize a different engine.
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        self.assertTrue(self.world.journal().queue())
        call = next(c for c in self.world.calls if c[0].endswith('/dispatches'))
        ref = call[1]['ref']
        self.assertNotEqual(ref, 'main')
        self.assertEqual(self.world.refs[ref], 'b' * 40)
        self.assertEqual(call[1]['inputs']['issue_number'], '130')
        self.runs['32'] = dict(self.origin, head_branch=ref)
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME=ref, INPUT_ACTION=call[1]['inputs']['action'])
        receipt = runtime_engine.attest(self.journal.scope, self.world.read, self.journal.state['engine'], env, 'b' * 40)
        self.assertEqual(receipt['sha'], 'b' * 40)
        self.world.refs[ref] = 'a' * 40
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, self.world.read, receipt, env, 'b' * 40)

    def test_branch_trial_cannot_run_engine_code_the_candidate_changed(self):
        self.world.refs['main'] = 'a' * 40
        self.world.comparisons['a' * 40 + '...' + 'b' * 40] = dict(
            status='ahead', merge_base_commit={'sha': 'a' * 40}, files=[{'filename': 'engine/runner.py'}])
        with self.assertRaisesRegex(PermissionError, 'reviewed main'):
            runtime_engine.attest(self.journal.scope, self.world.read, None, self.env, 'b' * 40)

    def trial(self):
        ref = 'fix/130-engine-recovery'
        self.world.refs[ref] = 'b' * 40
        self.runs['33'] = dict(self.origin, head_branch=ref)
        pr = dict(number=309, state='open', draft=True, user={'login': 'onlykappa'}, changed_files=2,
                  base=dict(ref='main', repo={'full_name': recovery.ROOT}),
                  head=dict(ref=ref, sha='b' * 40, repo={'full_name': recovery.ROOT}))
        comparison = dict(status='ahead', merge_base_commit={'sha': 'a' * 40},
                          files=[dict(filename='engine/developer.py'), dict(filename='tests/test_execution_recovery.py')])
        base = self.world.read
        def read(path):
            if path == f'repos/{recovery.ROOT}/pulls?state=open&head=onlykappa:{ref}&per_page=2':
                return [pr]
            if path == f'repos/{recovery.ROOT}/pulls/309':
                return pr
            if '/compare/' in path:
                return comparison
            return base(path)
        env = dict(self.env, GITHUB_RUN_ID='33', GITHUB_REF_NAME=ref)
        return read, env, pr, comparison

    def test_owner_repair_pr_engine_trial_and_pinned_continuation(self):
        read, env, pr, comparison = self.trial()
        receipt = runtime_engine.attest(self.journal.scope, read, None, env, 'b' * 40)
        self.assertEqual(receipt['trialPR'], 309)
        # A later PR update cannot substitute its new engine for a pinned continuation.
        pr['head']['sha'] = 'c' * 40
        ref = f'kappa/recovery-130-{self.journal.scope.digest[:12]}-1'
        self.world.refs[ref] = 'b' * 40
        self.runs['34'] = dict(self.origin, head_branch=ref)
        resume = dict(env, GITHUB_RUN_ID='34', GITHUB_REF_NAME=ref, INPUT_ACTION='resume:1:fixture')
        self.assertEqual(runtime_engine.attest(self.journal.scope, read, receipt, resume, 'b' * 40), receipt)
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, read, receipt, dict(resume, GITHUB_SHA='c' * 40), 'c' * 40)

    def test_engine_trial_refuses_foreign_stale_closed_and_unreviewed_infrastructure(self):
        changes = [lambda p, c: p.update(state='closed'), lambda p, c: p.update(draft=False),
                   lambda p, c: p['head'].update(sha='c' * 40),
                   lambda p, c: p['head'].update(repo={'full_name': 'other/repo'}),
                   lambda p, c: p.update(user={'login': 'reviewer'}),
                   lambda p, c: c.update(status='diverged'),
                   lambda p, c: c['files'][0].update(filename='.github/workflows/agent.yml'),
                   lambda p, c: c['files'][0].update(previous_filename='config/providers.json'),
                   lambda p, c: p.update(changed_files=300)]
        for change in changes:
            read, env, pr, comparison = self.trial()
            change(pr, comparison)
            with self.subTest(change=change), self.assertRaises(PermissionError):
                runtime_engine.attest(self.journal.scope, read, None, env, 'b' * 40)
        for change in ({'actor': {'login': 'github-actions[bot]'}},
                       {'triggering_actor': {'login': 'reviewer'}}, {'event': 'pull_request'}):
            read, env, _, _ = self.trial()
            self.runs['33'].update(change)
            with self.subTest(change=change), self.assertRaises(PermissionError):
                runtime_engine.attest(self.journal.scope, read, None, env, 'b' * 40)
        read, env, _, _ = self.trial()
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, read, None, dict(env, INPUT_ACTION='resume:1:fixture'), 'b' * 40)

    def test_main_and_stale_checkouts_stop_before_task_work(self):
        self.runs['32'] = dict(self.origin, head_branch='main', head_sha='a' * 40)
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='a' * 40,
                   INPUT_ACTION='verify')
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, self.world.read, self.journal.state['engine'], env, 'a' * 40)
        self.world.refs['main'] = 'c' * 40
        with self.assertRaises(runtime_engine.EngineRefreshRequired):
            runtime_engine.attest(self.journal.scope, self.world.read, None, env, 'a' * 40)
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, self.world.read, None, env, 'c' * 40)

    def test_current_main_can_replace_trial_only_after_including_its_revision(self):
        self.world.refs['main'] = 'c' * 40
        self.runs['32'] = dict(self.origin, head_branch='main', head_sha='c' * 40)
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='c' * 40)
        self.world.comparisons['b' * 40 + '...' + 'c' * 40] = dict(status='ahead', merge_base_commit={'sha': 'b' * 40})
        self.assertIsNone(runtime_engine.attest(self.journal.scope, self.world.read,
                                               self.journal.state['engine'], env, 'c' * 40))
        self.journal.defer(RuntimeError('offline'))
        self.world.now += 61
        self.assertTrue(self.journal.queue())
        call = next(c for c in self.world.calls if c[0].endswith('/dispatches'))
        self.assertEqual(call[1]['ref'], 'main')
        self.assertNotIn('engine', self.journal.state)

    def test_forged_owner_task_workflow_and_engine_receipts_are_rejected(self):
        receipt = self.journal.state['engine']
        for key, value in (('task', 131), ('sha', 'z' * 40), ('digest', 'wrong'), ('ref', 'main')):
            with self.subTest(key=key), self.assertRaises(PermissionError):
                runtime_engine.verify_receipt(dict(receipt, **{key: value}), self.journal.scope, self.world.read)
        for changes in ({'actor': {'login': 'reviewer'}}, {'triggering_actor': {'login': 'reviewer'}},
                        {'event': 'pull_request'}, {'path': '.github/workflows/other.yml'}, {'head_sha': 'c' * 40},
                        {'display_title': 'Agent task #131 fix'}):
            self.runs['31'] = dict(self.origin, **changes)
            with self.subTest(changes=changes), self.assertRaises(PermissionError):
                runtime_engine.verify_receipt(receipt, self.journal.scope, self.world.read)
        self.runs['31'] = self.origin

    def test_owner_fix_on_current_main_migrates_divergent_engine_and_preserves_candidate(self):
        self.world.refs['main'] = 'c' * 40
        self.runs['32'] = dict(self.origin, head_branch='main', head_sha='c' * 40)
        self.world.comparisons['b' * 40 + '...' + 'c' * 40] = dict(
            status='diverged', merge_base_commit={'sha': 'a' * 40})
        before = self.journal.state['candidate']
        with patch.dict(os.environ, dict(GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='c' * 40)), \
                patch.object(subprocess, 'check_output', return_value='c' * 40 + '\n'):
            self.journal.begin('fix')
        self.assertEqual(self.journal.state['candidate'], before)
        self.assertNotIn('engine', self.journal.state)
        migration = self.journal.state['events'][-1]
        self.assertEqual(migration['strategy'], 'reviewed_main_engine_migration')
        self.assertIn('b' * 40, migration['error'])
        self.assertIn('c' * 40, migration['error'])
        self.assertIn('32', migration['error'])

    def test_divergent_engine_migration_requires_explicit_owner_fix(self):
        self.world.refs['main'] = 'c' * 40
        run = dict(self.origin, head_branch='main', head_sha='c' * 40)
        self.world.comparisons['b' * 40 + '...' + 'c' * 40] = dict(
            status='diverged', merge_base_commit={'sha': 'a' * 40})
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='c' * 40)
        for changes, action in [({}, 'resume:1:fixture'), ({}, 'verify'), ({}, ''),
                                ({'actor': {'login': 'github-actions[bot]'}}, 'fix'),
                                ({'triggering_actor': {'login': 'reviewer'}}, 'fix'),
                                ({'display_title': 'Agent task #131 fix'}, 'fix')]:
            self.runs['32'] = dict(run, **changes)
            with self.subTest(changes=changes, action=action), self.assertRaises(PermissionError):
                runtime_engine.attest(self.journal.scope, self.world.read, self.journal.state['engine'],
                                      dict(env, INPUT_ACTION=action), 'c' * 40)

    def test_owner_migration_still_rejects_forged_previous_receipt(self):
        self.world.refs['main'] = 'c' * 40
        self.runs['32'] = dict(self.origin, head_branch='main', head_sha='c' * 40)
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='c' * 40)
        receipt = dict(self.journal.state['engine'], digest='forged')
        with self.assertRaises(PermissionError):
            runtime_engine.attest(self.journal.scope, self.world.read, receipt, env, 'c' * 40)

    def test_legacy_scanner_cannot_interpret_trial_as_main_recovery(self):
        self.journal.defer(RuntimeError('offline'))
        row = next(r for r in self.world.rows if r['body'].startswith('### KappaForge recovery checkpoint\n'))
        wire = json.loads(row['body'].split('<!-- KAPPA_RECOVERY_V1 ')[1].split(' -->')[0])
        self.assertEqual(wire['status'], 'engine_pinned')
        self.assertEqual(wire['engineStatus'], 'waiting')
        self.assertNotIn(wire['status'], ('running', 'recovering', 'waiting', 'dispatching', 'blocked'))
        self.assertEqual(self.world.journal().state['status'], 'waiting')

    def test_current_trial_hands_off_without_old_scanner_or_parallel_worker(self):
        self.runs['31']['status'] = 'in_progress'
        self.journal.defer(RuntimeError('offline'))
        self.assertFalse(self.journal.queue(), 'a scanner must not start alongside an active worker')
        sleeps = []
        def sleep(seconds):
            sleeps.append(seconds)
            self.world.now += seconds
        self.assertTrue(self.journal.handoff_engine(sleep))
        self.assertTrue(all(s <= 30 for s in sleeps))
        self.assertEqual(len([c for c in self.world.calls if c[0].endswith('/dispatches')]), 1)
        self.assertIsNone(runtime_engine.DISPATCH.get())

    def test_expiry_or_owner_cancellation_prevents_engine_handoff(self):
        self.journal.defer(RuntimeError('offline'))
        self.world.issue['state'] = 'closed'
        with self.assertRaises(PermissionError):
            self.journal.handoff_engine(lambda _: None)
        self.assertFalse(any(c[0].endswith('/dispatches') for c in self.world.calls))

    def test_unavailable_engine_provenance_never_creates_a_fallback_dispatch(self):
        self.journal.state.pop('engine')
        before = len(self.world.calls)
        with patch.object(self.journal, 'read', side_effect=urllib.error.URLError('metadata unavailable')):
            with self.assertRaisesRegex(PermissionError, 'no fallback engine'):
                self.journal.begin('fix')
        self.assertEqual(len(self.world.calls), before)

    def test_corrupt_trial_checkpoint_cannot_fall_back_to_fresh_main_state(self):
        row = next(r for r in self.world.rows if r['body'].startswith('### KappaForge recovery checkpoint\n'))
        state = json.loads(row['body'].split('<!-- KAPPA_RECOVERY_V1 ')[1].split(' -->')[0])
        state.pop('engine')
        row['body'] = '### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(state) + ' -->'
        with self.assertRaisesRegex(PermissionError, 'refusing fallback'):
            self.world.journal()


if __name__ == '__main__':
    unittest.main()

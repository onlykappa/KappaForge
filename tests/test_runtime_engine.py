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

    def test_main_and_stale_checkouts_stop_before_task_work(self):
        self.runs['32'] = dict(self.origin, head_branch='main', head_sha='a' * 40)
        env = dict(self.env, GITHUB_RUN_ID='32', GITHUB_REF_NAME='main', GITHUB_SHA='a' * 40)
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

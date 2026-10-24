"""Crash and outage injection at real Session/Journal boundaries; no generated code runs on the host."""
import copy
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from engine import developer, execution, recovery, sandbox, sandbox_repair_controller, task_goal, task_state
from tests.test_recovery_journal import GitHub
from tests.test_sandbox_repair_controller import FakeDocker

TASK = 'Repair value and run the original tests.'
CONTEXT = dict(kind='develop', base='main', model='free:writer', summary='Change value', explanation='Fix value',
               stages=[], design='', open_problems=[])


def session(docker=None, extra=None, sha='a' * 40):
    files = {'app.py': b'value=1\n', 'tests/test_app.py': b'import unittest\n'}
    files.update(extra or {})
    return sandbox.Session(sandbox.Tree(recovery.ROOT, sha, files), docker=docker or FakeDocker())


def fixed(*args, **kwargs):
    return 'free:repair', json.dumps(dict(tool='apply_patch', reason='The test expects value 2, fix the implementation',
        args=dict(edits=[dict(path='app.py', find='value=0', replace='value=2')])))


class ExecutionRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.journal.checkpoint('a' * 40, base='main')
        self.goal = task_goal.CURRENT.set(None)
        self.addCleanup(task_goal.CURRENT.reset, self.goal)
        developer.Progress.latest = None

    def controller(self, work=None, journal=None, progress=None):
        return sandbox_repair_controller.SandboxRepairController(work or session(), journal or self.journal,
                                                                 CONTEXT, progress)

    def reload(self):
        return self.world.journal()

    def test_provider_failure_restores_exact_patch_and_skips_completed_candidate_tests(self):
        def exhausted(*args, **kwargs):
            raise RuntimeError('all free routes unavailable')
        with self.assertRaisesRegex(RuntimeError, 'free routes'):
            self.controller().run_repair(TASK, exhausted, 'key', {'app.py': 'value=0\n'})
        restored = self.reload()
        saved = execution.pending(restored)
        self.assertEqual(saved['changes'], {'app.py': 'value=0\n'})
        self.assertEqual(saved['controller']['actions'], 1)
        self.assertEqual(len(saved['controller']['attempts']), 1)
        self.assertEqual(saved['providerFailures'][0]['category'], 'provider_outage')
        self.assertEqual(saved['originalTask'], TASK)
        work = session()
        result = self.controller(work, restored).run_repair(TASK, fixed, 'key', {'app.py': 'wrong regenerate'})
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['candidate_changes'], {'app.py': 'value=2\n'})
        self.assertEqual(len([c for c in work.docker.calls if c[0][0] == 'run']), 2,
                         'only repaired candidate and final regression execute after restart')
        self.assertEqual(len(result['attempts']), 2)

    def test_partial_suite_reuses_only_completed_command_and_final_regression_is_fresh(self):
        class Outage(FakeDocker):
            def call(self, args, **kwargs):
                if args[:1] == ['run'] and 'npm' in args:
                    raise sandbox.SandboxUnavailable('temporary Docker outage')
                result = super().call(args, **kwargs)
                if args[:1] == ['run']:
                    result.stdout += '\n' + 'trailing diagnostic noise\n' * 500
                return result
        extra = {'package.json': b'{"scripts":{"test":"node --test"}}'}
        with self.assertRaises(execution.CheckpointUnavailable):
            self.controller(session(Outage(), extra)).run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
        work = session(extra=extra)
        result = self.controller(work, self.reload()).run_repair(TASK, fixed, 'key')
        self.assertEqual(result['status'], 'success')
        calls = [c[0] for c in work.docker.calls if c[0][0] == 'run']
        self.assertEqual(len(calls), 3, 'unfinished Node command, then fresh Python + Node final regression')
        self.assertEqual(sum('python' in row for row in calls), 1)
        self.assertTrue(any(row.get('reused') for row in self.journal.state['executionDiagnostics']['commands']) is False)

    def test_completed_validation_restarts_without_inference_or_commands(self):
        result = self.controller().run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
        self.assertEqual(result['status'], 'success')
        work, model = session(), Mock(side_effect=AssertionError('must not regenerate'))
        resumed = self.controller(work, self.reload()).run_repair(TASK, model, 'key')
        self.assertEqual(resumed['status'], 'success')
        self.assertEqual(resumed['candidate_changes'], {'app.py': 'value=2\n'})
        model.assert_not_called()
        self.assertFalse(any(c[0][0] == 'run' for c in work.docker.calls))

    def test_changed_base_tree_revision_or_task_blocks_before_docker(self):
        self.controller().run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
        for work, task in ((session(sha='b' * 40), TASK), (session(extra={'app.py': b'owner edit\n'}), TASK),
                           (session(), 'different requirements')):
            with self.subTest(task=task, sha=work.base.sha), self.assertRaises(execution.CheckpointMismatch):
                self.controller(work, self.reload()).run_repair(task, fixed, 'key')
            self.assertFalse(any(c[0][0] == 'run' for c in work.docker.calls))

    def test_candidate_is_saved_before_fetch_and_can_resume_after_fetch_outage(self):
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        with patch.object(sandbox, 'open_session', side_effect=sandbox.SandboxUnavailable('image registry offline')):
            with self.assertRaises(execution.CheckpointUnavailable):
                developer.run_sandbox_repair(recovery.ROOT, 'a' * 40, 'secret', {'app.py': 'value=2\n'},
                                             TASK, 'key', None, context=CONTEXT)
        saved = execution.pending(self.reload())
        self.assertEqual(saved['changes'], {'app.py': 'value=2\n'})
        self.assertIsNone(saved['identity']['tree'])
        result = self.controller(journal=self.reload()).run_repair(TASK, fixed, 'key')
        self.assertEqual(result['status'], 'success')

    def test_untrusted_or_corrupt_fragment_is_never_applied(self):
        self.controller().run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
        receipt = self.journal.state['executionCheckpoint']
        row = self.world.rows[receipt['parts'][0] - 1]
        original = copy.deepcopy(row)
        row['user']['login'] = 'attacker'
        with self.assertRaises(execution.CheckpointMismatch):
            execution.pending(self.reload())
        row.update(original)
        row['body'] = row['body'].replace('"part":0', '"part":1')
        with self.assertRaises(execution.CheckpointMismatch):
            execution.pending(self.reload())

    def test_secret_values_are_redacted_in_ui_history_and_persistent_fragments(self):
        secret = 'private-env-value-123456'
        class SecretOutput(FakeDocker):
            def call(self, args, **kwargs):
                result = super().call(args, **kwargs)
                if args[:1] == ['run']:
                    result.stdout += '\nPRIVATE=' + secret + '\nAuthorization: Bearer ' + secret
                return result
        updates = []
        progress = Mock(execution_update=lambda value: updates.append(copy.deepcopy(value)))
        with patch.dict(os.environ, {'PRIVATE_SERVICE_VALUE': secret}):
            self.controller(session(SecretOutput()), progress=progress).run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
            data = execution.pending(self.reload())
        self.assertNotIn(secret, json.dumps(data))
        self.assertNotIn(secret, json.dumps(updates))
        self.assertIn('[redacted]', json.dumps(data))
        self.assertEqual(updates[-1]['finalValidation'], 'passed')
        self.assertEqual(updates[-1]['currentCommand']['status'], 'passed')
        self.assertGreater(updates[-1]['currentCommand']['startedAt'], 0)

    def test_secret_in_candidate_blocks_without_persisting_or_executing_it(self):
        secret = 'private-env-value-123456'
        work = session()
        with patch.dict(os.environ, {'PRIVATE_SERVICE_VALUE': secret}), self.assertRaises(execution.CheckpointMismatch):
            self.controller(work).run_repair(TASK, fixed, 'key', {'app.py': 'key="' + secret + '"'})
        self.assertFalse(any(c[0][0] == 'run' for c in work.docker.calls))
        self.assertNotIn(secret, json.dumps(self.world.rows))

    def test_failed_checkpoint_never_runs_next_command_and_retains_previous_receipt(self):
        self.controller().run_repair(TASK, fixed, 'key', {'app.py': 'value=2\n'})
        receipt = copy.deepcopy(self.journal.state['executionCheckpoint'])
        self.journal.write = Mock(side_effect=ConnectionError('journal unavailable'))
        work = session()
        with self.assertRaises(execution.CheckpointUnavailable):
            self.controller(work).run_repair(TASK, fixed, 'key')
        self.assertEqual(self.journal.state['executionCheckpoint'], receipt)
        self.assertFalse(any(c[0][0] == 'run' for c in work.docker.calls))

    def test_infrastructure_recovery_retains_execution_diagnostics(self):
        execution.seed(self.journal, recovery.ROOT, 'a' * 40, {'app.py': 'value=2\n'}, TASK, CONTEXT)
        self.assertEqual(recovery.diagnose(execution.CheckpointUnavailable('offline')),
                         ('infrastructure', 'wait_for_infrastructure'))
        self.assertTrue(self.journal.defer(execution.CheckpointUnavailable('offline')))
        self.assertTrue(self.journal.state['executionCheckpoint'])
        snapshots = [json.loads(row['body'].split('<!-- KAPPA_PROGRESS_V1 ')[1].split(' -->')[0])
                     for row in self.world.rows if '<!-- KAPPA_PROGRESS_V1 ' in row['body']]
        self.assertEqual(snapshots[-1]['execution']['status'], 'blocked')
        self.assertNotIn('Free model capacity is exhausted', snapshots[-1]['steps'][0]['title'])

    def test_provider_usage_persists_measured_counts_without_inventing_missing_tokens(self):
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        task_state.provider_usage('free:model', {'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12,
                                                 'secret': 'never saved', 'input_tokens': True})
        task_state.provider_usage('free:model')
        task_state.provider_usage('free:model', failed=True)
        row = self.reload().state['providerUsage']['free:model']
        self.assertEqual(row, dict(responses=2, failures=1, measuredResponses=1, tokens=dict(input=10, output=2, total=12)))

    def test_usage_storage_outage_is_not_misclassified_as_a_provider_response_failure(self):
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        self.journal.write = Mock(side_effect=ConnectionError('tracker offline'))
        with self.assertRaises(execution.CheckpointUnavailable) as error:
            task_state.provider_usage('free:model', {'total_tokens': 12})
        self.assertEqual(recovery.diagnose(error.exception)[0], 'infrastructure')

    def test_private_code_is_blocked_before_writing_to_a_public_task_tracker(self):
        journal = SimpleNamespace(scope=SimpleNamespace(repo='owner/private'), state={},
                                  target_read=lambda path: {'private': True}, read=lambda path: {'private': False}, write=Mock())
        with self.assertRaises(execution.CheckpointMismatch):
            execution.seed(journal, 'owner/private', 'a' * 40, {'private.py': 'private code'}, TASK)
        journal.write.assert_not_called()

    def test_publication_reuses_saved_commit_after_lost_branch_update_acknowledgement(self):
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        calls = []
        branch, parent, commit_sha = 'kappa/dev-130', 'b' * 40, 'c' * 40
        def gh(path, token, payload=None, method=None):
            if '/git/commits/' in path:
                return {'sha': commit_sha, 'parents': [{'sha': parent}]}
            return self.world.read(path)
        def move(*args, **kwargs):
            calls.append('move')
            self.world.refs[branch] = commit_sha
            raise ConnectionError('lost acknowledgement')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'commit_changes', return_value={'sha': commit_sha}) as commit, \
                patch.object(developer, 'move_branch', side_effect=move):
            with self.assertRaises(ConnectionError):
                developer.publish_candidate(recovery.ROOT, parent, {'value.py': 'value = 2\n'}, {}, 'change', 'fixture', branch)
            # Reload the real journal and retry the same publication, without another commit or branch mutation.
            restored = self.reload()
            recovery.CURRENT.set(restored)
            result = developer.publish_candidate(recovery.ROOT, parent, {'value.py': 'value = 2\n'}, {}, 'change', 'fixture', branch)
        self.assertEqual(result['sha'], commit_sha)
        self.assertEqual(commit.call_count, 1)
        self.assertEqual(calls, ['move'])
        self.assertEqual(restored.state['phase'], 'publication')

    def test_publication_refuses_a_different_patch_after_a_commit_was_saved(self):
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        with patch.object(developer, 'commit_changes', return_value={'sha': 'c' * 40}), \
                patch.object(developer, 'move_branch', side_effect=ConnectionError('offline')):
            with self.assertRaises(ConnectionError):
                developer.publish_candidate(recovery.ROOT, 'b' * 40, {'value.py': 'value = 2\n'}, {}, 'change', 'fixture', 'kappa/dev-130')
        with patch.object(developer, 'commit_changes') as commit, self.assertRaises(execution.CheckpointMismatch):
            developer.publish_candidate(recovery.ROOT, 'b' * 40, {'value.py': 'different patch'}, {}, 'change', 'fixture', 'kappa/dev-130')
        commit.assert_not_called()

    def test_development_resume_bypasses_planning_generation_and_review(self):
        self.world.refs.pop('kappa/dev-130')
        handle = recovery.CURRENT.set(self.journal)
        self.addCleanup(recovery.CURRENT.reset, handle)
        original_task = self.world.issue['title'] + '\n' + self.world.issue['body']
        execution.seed(self.journal, recovery.ROOT, 'a' * 40, {'app.py': 'value=2\n'}, original_task, CONTEXT)
        def gh(path, token, payload=None, method=None):
            if payload is not None and path.endswith('/pulls'):
                return dict(number=133, html_url=self.world.prs[0]['html_url'], head=dict(sha='c' * 40, ref='kappa/dev-130',
                            repo=dict(full_name=recovery.ROOT)), state='open', draft=True)
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'owner_guidance', return_value=[]), \
                patch.object(developer, 'snapshot', side_effect=AssertionError('must keep saved base')), \
                patch.object(developer, 'list_tree', return_value=({'app.py': 8}, {})), \
                patch.object(developer, 'read_source', return_value='value=1\n'), \
                patch.object(developer, 'plan_change', side_effect=AssertionError('must not replan')) as plan, \
                patch.object(developer, 'build_in_stages', side_effect=AssertionError('must not regenerate')) as generate, \
                patch.object(developer, 'check_the_work', side_effect=AssertionError('must not rereview')) as review, \
                patch.object(developer, 'change_flags', return_value={}), \
                patch.object(developer, 'is_private', return_value=False), \
                patch.object(developer, 'code_providers', return_value={'free'}), \
                patch.object(developer, 'push_token', return_value='fixture'), \
                patch.object(developer, 'commit_changes', return_value={'sha': 'c' * 40}), \
                patch.object(developer, 'move_branch', side_effect=lambda *a, **k: self.world.refs.update({'kappa/dev-130': 'c' * 40})), patch.object(developer, 'dispatch_tests'), \
                patch.object(developer, 'notify'), patch.object(sandbox, 'open_session', return_value=session()):
            url = developer.produce_development_pr(self.world.issue, 'key', 'fixture')
        self.assertEqual(url, self.world.prs[0]['html_url'])
        plan.assert_not_called()
        generate.assert_not_called()
        review.assert_not_called()
        self.assertIsNone(execution.pending(self.reload()))
        self.assertEqual(self.journal.state['executionDiagnostics']['finalValidation'], 'passed')

    def test_saved_plan_preserves_the_original_base_and_selected_sources(self):
        execution.save_plan(self.journal, recovery.ROOT, 'a' * 40, TASK,
                            dict(base='main', paths=['app.py'], stages=[], design='Minimal correction'), {'app.py': 'value=1\n'})
        saved = execution.generation_plan(self.reload(), recovery.ROOT, TASK)
        self.assertEqual(saved['base'], 'a' * 40)
        self.assertEqual(saved['sourceHash'], execution.digest({'app.py': 'value=1\n'}))
        self.assertEqual(saved['context']['paths'], ['app.py'])
        with self.assertRaises(execution.CheckpointMismatch):
            execution.generation_plan(self.reload(), recovery.ROOT, 'different owner task')

    def test_publication_recovery_preserves_completed_requirement_review(self):
        context = {**CONTEXT, 'publication': {'title': 'Draft: repaired', 'body': 'Completed requirement review\n' + developer.review_record([])}}
        work = session()
        sandbox_repair_controller.SandboxRepairController(work, self.journal, context).run_repair(
            TASK, fixed, 'key', {'app.py': 'value=2\n'})
        payload = developer.publication_metadata(self.reload())
        self.assertEqual(developer.requirements_open(payload), [])
        self.assertIn('Completed requirement review', payload['body'])
        self.assertIn('passed final regression', payload['body'])

    def test_publication_does_not_accept_unvalidated_or_foreign_pr_heads(self):
        for sha, ref, repo in (('b' * 40, 'kappa/dev-130', recovery.ROOT),
                               ('c' * 40, 'other', recovery.ROOT), ('c' * 40, 'kappa/dev-130', 'other/repo')):
            pr = dict(head=dict(sha=sha, ref=ref, repo=dict(full_name=repo)))
            with self.subTest(head=pr), self.assertRaises(execution.CheckpointMismatch):
                developer.verify_publication(pr, recovery.ROOT, 'kappa/dev-130', 'c' * 40)

    def test_begin_reconciles_exact_bot_publication_after_lost_move_ack(self):
        self.journal.checkpoint('b' * 40, files=['value.py'])
        self.journal.state['executionPublication'] = dict(key='saved-key', sha='c' * 40, branch='kappa/dev-130')
        self.journal.persist()
        self.world.refs['kappa/dev-130'] = 'c' * 40
        original = self.world.read
        def read(path):
            if '/git/commits/' in path:
                return dict(parents=[dict(sha='b' * 40)])
            return original(path)
        self.journal.read = read
        self.assertTrue(self.journal.begin('fix'))
        self.assertEqual(self.journal.state['candidate'], 'c' * 40)
        self.assertEqual(self.journal.state['phase'], 'publication')


if __name__ == '__main__':
    unittest.main()

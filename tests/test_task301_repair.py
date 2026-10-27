"""Regressions from exact task301 checkpoints; no live HTTP or model calls."""
from contextlib import ExitStack
import copy
import io
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from engine import developer, execution, exploration, intent_guard, inventory, operational_review, requirements, verify
from tests.test_operational_review import context, DOC, SOURCE
from tests.test_sandbox_repair_controller import fixture_tree
from engine.sandbox_repair_controller import SandboxRepairController

OUTPUT = 'docs/phase3/policy-publication-review.md'
ASK = ('Create only ' + OUTPUT + ' for 3.1c job 1: document the pre-mutation authorization gate, tracing '
       'engine/runner.py request() into engine/intent_guard.py guard_request(), check_current() and permit(), '
       'against KAPPA.md and .kappaforge/owner-preferences.md; include the inspected main SHA, proven checks '
       'and concrete gaps; label this source inspection and partial 3.1c.')
OLD, NEW = 'a' * 40, 'b' * 40


class SourceReviewTests(unittest.TestCase):
    def test_policy_source_review_uses_four_named_files_without_a_planner_call(self):
        files = {p: 100 for p in ['engine/runner.py', 'engine/intent_guard.py', 'KAPPA.md', '.kappaforge/owner-preferences.md']}
        with patch.object(developer, 'run_model', side_effect=AssertionError('No planner call')):
            plan = inventory.read_plan(ASK, files, 30)
        self.assertEqual(set(plan[0]), set(files))
        self.assertIn('permit()', plan[2])
        self.assertIsNone(inventory.read_plan(ASK + ' Implement an endpoint.', files, 30))
        self.assertIsNone(inventory.read_plan(ASK, {**files, OUTPUT: 1}, 30))

    def test_documenting_functions_does_not_become_a_code_change(self):
        rows = requirements.split(ASK)
        self.assertEqual(len(rows), 1)
        items = [{**rows[0], 'categories': ['code', 'security'], 'source': 'model'}]
        result = requirements.validate(items, ASK)[0]
        self.assertIn('documentation', result.categories)
        self.assertIn('security', result.categories)
        self.assertNotIn('code', result.categories)
        self.assertIn('code', requirements.rule_categories('Implement a new authorization API endpoint.'))

    def test_typographic_rewrite_preserves_exact_owner_text_but_no_changed_clause(self):
        alternate = ASK.replace('pre-mutation', 'pre\u2011mutation')
        self.assertEqual(requirements.canonical_text(alternate, [ASK]), ASK)
        changed = alternate.replace('partial 3.1c', 'complete 3.1c')
        self.assertEqual(requirements.canonical_text(changed, [ASK]), changed)

    def test_later_phase_hold_requires_real_controller_receipts(self):
        text = 'Do not continue to 3.1d or any later job.'
        self.assertEqual(operational_review.kind(text), 'scope')
        self.assertIsNone(operational_review.kind(text + ' Implement phase 3.1d now.'))
        with ExitStack() as stack:
            _, _, _ = context(stack)
            row = {'text': text, 'met': True}
            operational_review.resolve([row], {DOC: SOURCE})
            self.assertFalse(row['met'], 'a controller-recognized phrase absent from owner goal is not authority')

    def test_review_prompt_requires_source_checks_for_policy_documents(self):
        prompt = verify.review_prompt(ASK, 'diff', ['engine/intent_guard.py'], 'literal source')
        self.assertIn('source_checks', prompt)
        self.assertIn('Every function explicitly named', prompt)
        self.assertIn('tests actually run', prompt)


class FailureInvestigationTests(unittest.TestCase):
    def test_assertion_traceback_is_read_before_another_model_call(self):
        path = 'tests/test_app.py'
        session = fixture_tree(files={path: b'import unittest\nclass T(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(2, 3)\n'})
        controller = SandboxRepairController(session)
        controller.state = {'history': [], 'explored': 0}
        diagnostics = json.dumps({'output': 'File "/work/tests/test_app.py", line 4, in test_value\nAssertionError: 2 != 3'})
        controller._investigate_failure(diagnostics)
        observed = controller.state['investigation']
        self.assertIn(path, observed['files'])
        self.assertIn('self.assertEqual(2, 3)', observed['evidence'])
        self.assertGreater(controller.state['explored'], 0)
        session.close()

    def test_tracebacks_cannot_read_host_paths_or_traversal(self):
        text = 'File "/etc/passwd", line 1\nFile "/work/../secret", line 1\nFile "/work/tests/test_app.py", line 4'
        self.assertEqual(exploration.traceback_files(text, {'tests/test_app.py': 1, '../secret': 1}), [('tests/test_app.py', 4)])


class UnpublishedRefreshTests(unittest.TestCase):
    def fixture(self):
        issue = {'number': 301, 'state': 'open', 'user': {'login': 'onlykappa'}, 'created_at': '2099-01-01T00:00:00Z',
                 'body': 'Repository: onlykappa/KappaForge\nMode: develop\n\n' + ASK}
        scope = intent_guard.ExecutionScope(issue)
        receipt = {'hash': 'c' * 64, 'parts': [1]}
        state = dict(candidate=OLD, authorization=scope.identity, digest=scope.digest, files=[], pr='',
                     generationPlan=receipt, repairLoop={'history': ['old-evidence'], 'reviews': 1}, budgets={'modelCalls': 34, 'edits': 0}, budgetSpent={'repairExploration': {'calls': 6}})
        comment = {'id': 99, 'user': {'login': 'onlykappa'}, 'created_at': '2026-10-27T16:01:00Z',
                   'body': f'Refresh unpublished task #301 from reviewed main {NEW}; preserve cumulative budgets and archive saved work.'}
        def target(path):
            if '/compare/' in path:
                return {'status': 'ahead', 'ahead_by': 1, 'commits': [{'commit': {'committer': {'date': '2026-10-27T16:00:00Z'}}}]}
            if path.endswith('git/ref/heads/main'):
                return {'object': {'sha': NEW}}
            if '/pulls?' in path:
                return []
            raise HTTPError('https://api.github.com/' + path, 404, 'missing', {}, io.BytesIO())
        journal = SimpleNamespace(scope=scope, issue=issue, state=state, target_read=Mock(side_effect=target),
                                  read=Mock(return_value=[comment]), archive=Mock(), event=Mock())
        return journal, comment

    def test_owner_receipted_refresh_archives_before_replacing_base_without_resetting_spend(self):
        journal, _ = self.fixture()
        original = copy.deepcopy(journal.state)
        with patch.dict(os.environ, {'GITHUB_SHA': NEW}), patch.object(execution, '_read_blob', return_value={'task': 301, 'repo': journal.scope.repo, 'scope': journal.scope.digest, 'base': OLD}):
            self.assertTrue(execution.refresh_unpublished_main(journal))
        self.assertEqual(journal.state['budgets'], original['budgets'])
        self.assertEqual(journal.state['budgetSpent'], original['budgetSpent'])
        self.assertEqual(journal.state['repairLoop'], original['repairLoop'])
        self.assertEqual(journal.state['candidate'], NEW)
        self.assertNotIn('generationPlan', journal.state)
        self.assertEqual(journal.archive.call_args.args[0][0]['receipts']['generationPlan'], original['generationPlan'])
        self.assertEqual(journal.state['unpublishedRefresh']['ownerReceipt'], 99)

    def test_untrusted_or_stale_refresh_receipts_do_not_replace_saved_work(self):
        for bad in ('foreign', 'stale'):
            journal, comment = self.fixture()
            if bad == 'foreign':
                comment['user']['login'] = 'someone-else'
            else:
                comment['created_at'] = '2026-10-27T15:00:00Z'
            before = copy.deepcopy(journal.state)
            with patch.dict(os.environ, {'GITHUB_SHA': NEW}):
                if bad == 'stale':
                    with self.assertRaises(execution.CheckpointMismatch):
                        execution.refresh_unpublished_main(journal)
                else:
                    self.assertFalse(execution.refresh_unpublished_main(journal))
            self.assertEqual(journal.state, before)
            journal.archive.assert_not_called()

    def test_archive_failure_keeps_live_checkpoint_and_counters(self):
        journal, _ = self.fixture()
        before = copy.deepcopy(journal.state)
        journal.archive.side_effect = OSError('storage refused')
        with patch.dict(os.environ, {'GITHUB_SHA': NEW}), patch.object(execution, '_read_blob', return_value={'task': 301, 'repo': journal.scope.repo, 'scope': journal.scope.digest, 'base': OLD}):
            with self.assertRaises(OSError):
                execution.refresh_unpublished_main(journal)
        self.assertEqual(journal.state, before)

    def test_existing_branch_or_published_work_cannot_be_refreshed(self):
        journal, _ = self.fixture()
        journal.state['files'] = [OUTPUT]
        with patch.dict(os.environ, {'GITHUB_SHA': NEW}):
            self.assertFalse(execution.refresh_unpublished_main(journal))
        journal.target_read.assert_not_called()
        journal.archive.assert_not_called()

    def test_existing_branch_and_wrong_main_are_rejected_without_archival(self):
        for blocked in ('branch', 'main'):
            journal, _ = self.fixture()
            target = journal.target_read.side_effect
            def read(path):
                if blocked == 'branch' and '/git/ref/heads/kappa/' in path:
                    return {'object': {'sha': OLD}}
                if blocked == 'main' and path.endswith('/git/ref/heads/main'):
                    return {'object': {'sha': 'd' * 40}}
                return target(path)
            journal.target_read.side_effect = read
            before = copy.deepcopy(journal.state)
            with patch.dict(os.environ, {'GITHUB_SHA': NEW}):
                with self.assertRaises(execution.CheckpointMismatch):
                    execution.refresh_unpublished_main(journal)
            self.assertEqual(journal.state, before)
            journal.archive.assert_not_called()

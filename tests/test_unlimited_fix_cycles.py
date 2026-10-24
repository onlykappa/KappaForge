"""An explicit null fixCycles budget removes only that cap; every other recovery budget stays enforced."""
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from engine import developer, intent_guard, native_build, projects, recovery, runner, task_goal, task_state
from engine.reliability import RecoveryBudgetExceeded, RecoveryCoordinator
from test_recovery_journal import GitHub

ENTRY = {"enabled": True, "branches": "kappa/dev-[0-9]+", "maxWaitSeconds": 21600}


def journal(budgets=None, used=None):
    return SimpleNamespace(state={'budgets': dict(used or {})}, persist=Mock(), event=Mock(),
                           project={} if budgets is None else {'budgets': budgets})


class ProjectBudgetValidationTests(unittest.TestCase):
    def register(self, budgets):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'projects.json'
            config.write_text(json.dumps({'projects': {'owner/repo': dict(ENTRY, budgets=budgets)}}))
            with patch.object(projects, 'CONFIG', config):
                return projects.registered('owner/repo')

    def test_null_is_accepted_only_for_fix_cycles(self):
        self.assertIsNone(self.register({'fixCycles': None})['budgets']['fixCycles'])
        for budgets in ({'edits': None}, {'modelCalls': None}, {'fixCycles': 0}, {'fixCycles': 1001}, {'fixCycles': -1},
                        {'fixCycles': '12'}, {'fixCycles': 12.0}, {'fixCycles': True}, {'fixCycles': 'unlimited'},
                        {'unknown': None}):
            with self.subTest(budgets=budgets), self.assertRaisesRegex(ValueError, 'recovery budget'):
                self.register(budgets)

    def test_only_kappaforge_is_unlimited_in_the_shipped_config(self):
        config = json.loads(projects.CONFIG.read_text())['projects']
        self.assertIsNone(projects.registered('onlykappa/KappaForge')['budgets']['fixCycles'])
        for repo, entry in config.items():
            with self.subTest(repo=repo):
                self.assertEqual(entry['budgets']['edits'], 120)
                self.assertEqual(entry['budgets']['modelCalls'], 160)
                if repo != 'onlykappa/KappaForge':
                    self.assertEqual(entry['budgets']['fixCycles'], 12)


class FixCycleChargeTests(unittest.TestCase):
    def test_null_permits_fix_cycles_beyond_twelve(self):
        saved = journal({'fixCycles': None}, {'fixCycles': 12})
        for expected in range(13, 31):
            self.assertEqual(RecoveryCoordinator.start_fix(saved), (expected, None))
        self.assertEqual(saved.state['budgets']['fixCycles'], 30)
        self.assertEqual(saved.persist.call_count, 18, 'each cycle is still debited before work')

    def test_absent_setting_keeps_the_default_cap_of_twelve(self):
        for project in ({}, {'edits': 120}):
            saved = journal(project, {'fixCycles': 11})
            with self.subTest(project=project):
                self.assertEqual(RecoveryCoordinator.start_fix(saved), (12, 12))
                with self.assertRaisesRegex(RecoveryBudgetExceeded, 'fixCycles budget exhausted'):
                    RecoveryCoordinator.start_fix(saved)
                self.assertEqual(saved.state['budgets']['fixCycles'], 12)
        legacy = journal(None)
        for _ in range(12):
            RecoveryCoordinator.start_fix(legacy)
        with self.assertRaises(RecoveryBudgetExceeded):
            RecoveryCoordinator.start_fix(legacy)

    def test_an_explicit_integer_cap_is_still_enforced(self):
        saved = journal({'fixCycles': 3}, {'fixCycles': 3})
        with self.assertRaises(RecoveryBudgetExceeded):
            RecoveryCoordinator.start_fix(saved)

    def test_edits_and_model_calls_stay_capped_when_fix_cycles_are_unlimited(self):
        for kind, cap in (('edits', 120), ('modelCalls', 160)):
            with self.subTest(kind=kind):
                saved = journal({'fixCycles': None}, {kind: cap})
                with self.assertRaisesRegex(RecoveryBudgetExceeded, kind + ' budget exhausted'):
                    RecoveryCoordinator.charge(saved, kind)
                configured = journal({'fixCycles': None, kind: 2}, {kind: 2})
                with self.assertRaises(RecoveryBudgetExceeded):
                    RecoveryCoordinator.charge(configured, kind)
                # A null that bypassed registration still cannot lift these caps.
                forged = journal({kind: None}, {kind: cap})
                self.assertEqual(RecoveryCoordinator.limit(forged.project, kind), cap)
                with self.assertRaises(RecoveryBudgetExceeded):
                    RecoveryCoordinator.charge(forged, kind)


class FixCycleFormattingTests(unittest.TestCase):
    def test_progress_label_never_prints_none(self):
        self.assertEqual(developer.fix_label(13, None), 'fix 13')
        self.assertEqual(developer.fix_label(4, 12), 'fix 4 of 12')

    def test_snapshot_reports_unlimited_fix_cycles_without_arithmetic_on_none(self):
        journal_handle, goal_handle = recovery.CURRENT.set(None), task_goal.CURRENT.set(task_goal.from_request('Resume the task.'))
        self.addCleanup(recovery.CURRENT.reset, journal_handle)
        self.addCleanup(task_goal.CURRENT.reset, goal_handle)
        task_state.bind('onlykappa/KappaForge', 232, 'kappa/dev-232', 'c' * 40)
        saved = journal({'fixCycles': None, 'modelCalls': 160}, {'fixCycles': 14, 'modelCalls': 31, 'edits': 9})
        budgets = task_state.snapshot(saved)['budgets']
        self.assertEqual(budgets['fixCycles'], {'used': 14, 'limit': None, 'remaining': None, 'unlimited': True})
        self.assertEqual(budgets['modelCalls'], {'used': 31, 'limit': 160, 'remaining': 129})
        self.assertEqual(budgets['edits'], {'used': 9, 'limit': 120, 'remaining': 111})
        json.dumps(budgets)


class UnlimitedFixPullRequestTests(unittest.TestCase):
    """The real fix_pull_request path resumes a task whose saved record already used 12 cycles."""
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.journal.project = dict(self.journal.project, budgets={'edits': 120, 'modelCalls': 160, 'fixCycles': None})
        self.handle = recovery.CURRENT.set(self.journal)
        self.journal.begin()
        self.journal.checkpoint('b' * 40)
        self.journal.state.setdefault('budgets', {})['fixCycles'] = 12
        self.addCleanup(recovery.CURRENT.reset, self.handle)
        self.addCleanup(intent_guard.ACTIVE.set, None)
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)

    def test_thirteenth_cycle_reaches_repair_and_reports_progress_without_a_cap(self):
        comments = [{'body': developer.FIX_MARKER + 'prior -->'} for _ in range(12)]

        def gh(path, token, payload=None, method=None):
            if '/issues/133/comments?' in path:
                return comments
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'sandbox_result', return_value=dict(id=123, status='completed', conclusion='failure')), \
                patch.object(native_build, 'result', return_value=None), patch.object(developer, 'owner_guidance', return_value=[]), \
                patch.object(developer, 'revise_branch', side_effect=RuntimeError('reached repair')) as repair, \
                patch.object(developer, 'report_stuck') as stopped:
            with self.assertRaisesRegex(RuntimeError, 'reached repair'):
                developer.fix_pull_request(self.world.issue, 'key', 'fixture')
        repair.assert_called_once()
        stopped.assert_not_called()
        self.assertEqual(self.journal.state['budgets']['fixCycles'], 13)
        self.assertEqual(self.world.journal().state['budgets']['fixCycles'], 13)
        bodies = '\n'.join(row['body'] for row in self.world.rows)
        self.assertIn('writing fix 13', bodies)
        self.assertNotRegex(bodies, r'fix 13 of|of None')


if __name__ == '__main__':
    unittest.main()

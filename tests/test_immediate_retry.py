"""A rejected repair round starts the next one at once in the same run; nothing waits without a provider limit."""
import unittest
from unittest.mock import patch

from engine import developer, intent_guard, native_build, recovery, runner
from engine.edit_errors import GenerationFailure
from test_recovery_journal import GitHub


class ImmediateRepairRoundTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.journal.project = dict(self.journal.project, budgets={'edits': 120, 'modelCalls': 160, 'fixCycles': None})
        self.handle = recovery.CURRENT.set(self.journal)
        self.journal.begin()
        self.journal.checkpoint('b' * 40)
        self.addCleanup(recovery.CURRENT.reset, self.handle)
        self.addCleanup(intent_guard.ACTIVE.set, None)
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)

    def fix(self, revise):
        def gh(path, token, payload=None, method=None):
            if '/issues/133/comments?' in path:
                return []
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), \
                patch.object(developer, 'sandbox_result', return_value=dict(id=123, status='completed', conclusion='failure')), \
                patch.object(native_build, 'result', return_value=None), patch.object(developer, 'owner_guidance', return_value=[]), \
                patch.object(developer, 'revise_branch', side_effect=revise) as repair, \
                patch.object(developer, 'report_stuck'):
            try:
                developer.fix_pull_request(self.world.issue, 'key', 'fixture')
            except Exception as error:
                return repair, error
        return repair, None

    def test_a_rejected_round_starts_the_next_round_at_once(self):
        rounds = iter([GenerationFailure('No validated proposal after 5 distinct attempts'), RuntimeError('second round reached')])

        def revise(*args, **kwargs):
            raise next(rounds)
        repair, error = self.fix(revise)
        self.assertEqual(str(error), 'second round reached')
        self.assertEqual(repair.call_count, 2, 'the second round ran in the same run, with no hand-off')
        self.assertEqual(self.journal.state['budgets']['fixCycles'], 2, 'each round is a counted fix cycle')
        self.assertIn('retry_now', [event.get('strategy') for event in self.journal.state['events']])
        self.assertTrue(any('writing fix 2 immediately' in row['body'] for row in self.world.rows))

    def test_rounds_per_run_are_bounded_then_the_failure_is_handed_on(self):
        def revise(*args, **kwargs):
            raise GenerationFailure('rejected again')
        repair, error = self.fix(revise)
        self.assertIsInstance(error, GenerationFailure)
        self.assertEqual(repair.call_count, developer.IMMEDIATE_REPAIR_ROUNDS)

    def test_provider_limits_blocked_work_and_low_time_are_not_retried_in_process(self):
        for failure in (GenerationFailure('routes unavailable', provider_routes=True, retry_at=10),
                        GenerationFailure('scope violation', blocked=True),
                        GenerationFailure('terminal', terminal=True)):
            with self.subTest(failure=str(failure)):
                repair, error = self.fix(lambda *a, **k: (_ for _ in ()).throw(failure))
                self.assertIs(error, failure)
                self.assertEqual(repair.call_count, 1)
        with patch.object(runner, 'TASK_DEADLINE', __import__('time').monotonic() + 60):
            repair, _ = self.fix(lambda *a, **k: (_ for _ in ()).throw(GenerationFailure('rejected')))
        self.assertEqual(repair.call_count, 1, 'too little task time left for another round')


if __name__ == '__main__':
    unittest.main()

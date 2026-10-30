"""A resumed task never regains investigation, repair-exploration or research budget.

Before this fix only the repair loop's exploration call count survived a restart: time, output and context started
over; a planning investigation or research interrupted mid-way started a whole new budget; and the repair loop
charged the time of test runs and model turns to its exploration clock. Spend is now kept per task in the recovery
journal (engine/budget_ledger.py) and recorded before each call or fetch runs.
"""
import copy
import io
import json
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import Mock

from engine import budget_ledger, exploration, research, sandbox, sandbox_repair_controller
from engine.exploration import Budget, Explorer, Repository

FILES = {'a.py': 'def a():\n    return 1\n' * 20, 'b.py': 'from a import a\n'}


class Journal:
    """The recovery journal's budget surface: state that survives a run, and a count of durable writes."""
    def __init__(self, state=None):
        self.state, self.writes = state if state is not None else {}, []

    def persist(self):
        self.writes.append(copy.deepcopy(self.state.get('budgetSpent')))

    def restarted(self):
        """What the next run of the task loads: only what was persisted."""
        return Journal({'budgetSpent': copy.deepcopy(self.writes[-1]) if self.writes else {}})


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class Crash(Exception):
    """The runner dying mid-call: nothing catches it."""


def repo():
    return Repository({p: len(t) for p, t in FILES.items()}, FILES.get)


class LedgerTests(unittest.TestCase):
    def test_saved_totals_are_restored_and_never_go_down(self):
        journal = Journal({'budgetSpent': {'investigation': {'calls': 7, 'seconds': 12.5, 'output_chars': 900}}})
        ledger = budget_ledger.Ledger(journal, 'investigation')
        self.assertEqual((ledger.spent('calls'), ledger.spent('seconds'), ledger.spent('context_chars')), (7, 12.5, 0))
        ledger.record({'calls': 9, 'seconds': 13.0, 'output_chars': 100})
        self.assertEqual(journal.state['budgetSpent']['investigation'], {'calls': 9, 'seconds': 13.0, 'output_chars': 900})
        self.assertEqual(len(journal.writes), 1)
        ledger.record({'calls': 9, 'seconds': 13.0, 'output_chars': 900})
        self.assertEqual(len(journal.writes), 1, 'an unchanged total is not written again')

    def test_tampered_or_foreign_values_are_never_credit(self):
        journal = Journal({'budgetSpent': {'research': {'fetches': -5, 'bytes': 'lots', 'seconds': True, 'other': 3}}})
        ledger = budget_ledger.Ledger(journal, 'research')
        self.assertEqual((ledger.spent('fetches'), ledger.spent('bytes'), ledger.spent('seconds')), (0, 0, 0))
        with self.assertRaises(ValueError):
            budget_ledger.Ledger(journal, 'anything')
        self.assertEqual(budget_ledger.Ledger(None, 'research').spent('fetches'), 0, 'no journal: nothing saved, no error')


class ExplorerResumeTests(unittest.TestCase):
    def explorer(self, journal, budget, clock=None, **kwargs):
        return Explorer(repo(), budget, clock=clock or Clock(), ledger=budget_ledger.Ledger(journal, 'investigation'), **kwargs)

    def test_owner_expanded_investigation_reads_again_without_resetting_retained_spend(self):
        spent = dict(calls=33, seconds=6.119, output_chars=121764, context_chars=97365)
        journal = Journal({'budgetSpent': {'repairExploration': dict(spent)}})
        def restored(budget):
            return Explorer(repo(), budget, clock=Clock(), active_time=True,
                            ledger=budget_ledger.Ledger(journal, 'repairExploration'))
        denied = restored(Budget())
        self.assertEqual(denied.call('read_file', path='a.py')['status'], 'budget_exhausted')
        expanded = restored(Budget.configured())
        self.assertEqual(expanded.call('read_file', path='a.py')['status'], 'ok')
        expanded.finish()
        retained = journal.state['budgetSpent']['repairExploration']
        self.assertEqual(retained['calls'], 34)
        self.assertGreater(retained['output_chars'], spent['output_chars'])
        self.assertGreaterEqual(retained['context_chars'], spent['context_chars'])

    def test_every_budget_continues_from_the_earlier_runs(self):
        cases = {'calls': (Budget(calls=4), 2), 'output_chars': (Budget(output_chars=700), 1),
                 'context_chars': (Budget(context_chars=700), 1)}
        for key, (budget, first_run_calls) in cases.items():
            with self.subTest(budget=key):
                journal = Journal()
                first = self.explorer(journal, budget)
                for _ in range(first_run_calls):
                    first.call('read_file', path='a.py')
                first.finish()
                resumed = self.explorer(journal.restarted(), budget)
                self.assertEqual(resumed.totals()[key], first.totals()[key], 'the restart begins where the run stopped')
                while resumed.call('read_file', path='a.py')['status'] != 'budget_exhausted':
                    pass
                self.assertLessEqual(first.calls + resumed.calls - 1, max(first_run_calls + 1, budget.calls),
                                     'the two runs together stay within one budget')

    def test_time_continues_across_runs(self):
        journal, clock = Journal(), Clock()
        first = self.explorer(journal, Budget(seconds=10), clock)
        first.call('read_file', path='a.py')
        clock.now += 8
        first.finish()
        resumed = self.explorer(journal.restarted(), Budget(seconds=10), Clock())
        self.assertEqual(resumed.remaining()['seconds'], 2.0)
        clock2 = resumed.clock
        clock2.now += 3
        self.assertEqual(resumed.call('search_code', query='a')['status'], 'budget_exhausted')

    def test_a_call_is_paid_before_it_runs_so_a_crash_cannot_regain_it(self):
        journal = Journal()
        explorer = self.explorer(journal, Budget(calls=3))
        explorer._read_file = Mock(side_effect=Crash('runner lost'))
        with self.assertRaises(Crash):
            explorer.call('read_file', path='a.py')
        resumed = self.explorer(journal.restarted(), Budget(calls=3))
        self.assertEqual(resumed.remaining()['calls'], 2, 'the call in flight when the run died still counts')

    def test_a_fully_spent_investigation_is_not_started_again(self):
        journal = Journal({'budgetSpent': {'investigation': {'calls': 40}}})
        model = Mock(side_effect=AssertionError('no model call for a spent budget'))
        added, evidence, summary = exploration.investigate(model, 'k', 'task', repo(), {}, ['Where is a?'], budget=Budget(calls=40),
                                                           ledger=budget_ledger.Ledger(journal, 'investigation'))
        self.assertEqual((added, summary, evidence['stop'], evidence['exhausted']), ({}, '', 'budget_exhausted', 'calls'))

    def test_an_interrupted_investigation_resumes_with_only_what_is_left(self):
        journal = Journal()
        replies = iter([{'tool': 'read_file', 'args': {'path': 'a.py'}, 'reason': 'r'},
                        {'tool': 'read_file', 'args': {'path': 'b.py'}, 'reason': 'r'}])
        def dies(*_a, **_k):
            reply = next(replies, None)
            if reply is None:
                raise Crash('runner lost')
            return 'm', json.dumps(reply)
        with self.assertRaises(Crash):
            exploration.investigate(dies, 'k', 'task', repo(), {}, ['q'], budget=Budget(calls=3),
                                    ledger=budget_ledger.Ledger(journal, 'investigation'))
        steps = []
        def model(_k, prompt, **_kw):
            steps.append(prompt)
            return 'm', json.dumps({'tool': 'search_code', 'args': {'query': 'a'}, 'reason': 'r'})
        _, evidence, _ = exploration.investigate(model, 'k', 'task', repo(), {}, ['q'], budget=Budget(calls=3),
                                                 ledger=budget_ledger.Ledger(journal.restarted(), 'investigation'))
        self.assertEqual(evidence['calls'], 1, 'two of three calls were spent before the crash; one is left')
        self.assertEqual(evidence['stop'], 'budget_exhausted')


class Response(io.BytesIO):
    def __init__(self, body):
        super().__init__(body.encode())
        self.headers = {'Content-Type': 'text/html'}


class ResearchResumeTests(unittest.TestCase):
    URL = 'https://nodejs.org/docs/latest/api/fs.html'

    def settings(self, **limits):
        settings = copy.deepcopy(research.config())
        settings['limits'].update(limits)
        return settings

    def test_fetches_bytes_and_time_continue_from_earlier_runs(self):
        journal, clock = Journal(), Clock()
        def slow(request, timeout):
            clock.now += 4
            return Response('x' * 100)
        first = research.Research(settings=self.settings(fetches=3, seconds=10), opener=slow, monotonic=clock,
                                  ledger=budget_ledger.Ledger(journal, 'research'))
        first.read_doc(self.URL)
        clock.now += 1000  # Model turns and other work between fetches are not research time.
        first.read_doc(self.URL + '?page=2')
        first.finish()
        self.assertEqual(journal.state['budgetSpent']['research'], {'fetches': 2, 'bytes': 200, 'seconds': 8.0})
        resumed = research.Research(settings=self.settings(fetches=3, seconds=10), opener=slow, monotonic=clock,
                                    ledger=budget_ledger.Ledger(journal.restarted(), 'research'))
        self.assertEqual(resumed.remaining_fetches(), 1)
        self.assertEqual(resumed.read_doc(self.URL + '?page=3')['status'], 'ok')
        self.assertEqual(resumed.read_doc(self.URL + '?page=4')['cause'], 'budget_exhausted')

    def test_a_fetch_is_paid_before_the_request(self):
        journal = Journal()
        def dies(request, timeout):
            raise Crash('runner lost')
        r = research.Research(settings=self.settings(fetches=2), opener=dies, ledger=budget_ledger.Ledger(journal, 'research'))
        with self.assertRaises(Crash):
            r.read_doc(self.URL)
        resumed = research.Research(settings=self.settings(fetches=2), opener=dies,
                                    ledger=budget_ledger.Ledger(journal.restarted(), 'research'))
        self.assertEqual(resumed.remaining_fetches(), 1)


class RepairExplorationTests(unittest.TestCase):
    def controller(self, journal, state=None):
        session = sandbox.Session(sandbox.Tree('r', 'a' * 40, {p: t.encode() for p, t in FILES.items()}))
        controller = sandbox_repair_controller.SandboxRepairController(session, journal)
        controller.state = state or {}
        return controller

    def test_repair_exploration_resumes_with_calls_time_output_and_context(self):
        journal = Journal()
        first = self.controller(journal)
        first._explore('read_file', path='a.py')
        first._explore('search_code', query='return')
        spent = first.explorer.totals()
        resumed = self.controller(journal.restarted())
        resumed._workspace_explorer()
        for key in ('calls', 'output_chars', 'context_chars'):
            self.assertEqual(resumed.explorer.totals()[key], spent[key], key)
        self.assertGreater(spent['output_chars'], 0)

    def test_only_time_inside_the_tools_counts_in_the_repair_loop(self):
        controller = self.controller(Journal())
        explorer = controller._workspace_explorer()
        clock = Clock()
        explorer.clock = clock
        explorer.call('read_file', path='a.py')
        clock.now += 600  # A sandbox test run between reads.
        self.assertEqual(explorer.totals()['seconds'], 0.0)
        self.assertGreater(explorer.remaining()['seconds'], 200)

    def test_any_spent_budget_withdraws_the_tools(self):
        journal = Journal({'budgetSpent': {'repairExploration': {'output_chars': 10 ** 9}}})
        controller = self.controller(journal)
        self.assertNotIn('read_file', {k for k, v in controller._loop_tools().items() if callable(v)})
        self.assertEqual(controller._explore('read_file', path='a.py')['status'], 'invalid')

    def test_older_checkpoints_that_saved_only_calls_still_count(self):
        controller = self.controller(Journal(), state={'explored': 40})
        self.assertEqual(controller._workspace_explorer().totals()['calls'], 40)
        exhausted = self.controller(Journal(), state={'explored': Budget.configured().calls})
        self.assertIsNone(exhausted._workspace_explorer())


if __name__ == '__main__':
    unittest.main()

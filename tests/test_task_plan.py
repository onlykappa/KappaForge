"""Phase 2 section 3: the evolving task plan, its recorded revisions and its persistence in the recovery journal."""
import unittest
from unittest.mock import patch

from engine import developer, execution, recovery, task_goal, task_plan
from tests.test_recovery_journal import GitHub

TASK = 'Make add() accept numeric strings.'
SHA = 'a' * 40


def clock():
    return 1000.0


class Recorder:
    def __init__(self):
        self.lines = []

    def act(self, kind, text, write=True, **feed):
        self.lines.append(dict(kind=kind, text=text, **feed))


class RevisionTests(unittest.TestCase):
    def plan(self):
        return task_plan.TaskPlan.initial('Cast inputs', files=['app/main.py'], remaining=['Cast both inputs'],
                                          open_questions=['Where are inputs parsed?'],
                                          hypotheses=['The caller passes strings'])

    def test_every_revision_needs_a_reason_and_a_known_trigger(self):
        plan = self.plan()
        for reason in ('', '   ', None):
            with self.assertRaises(ValueError):
                plan.revise(reason, 'inspection', open_questions=[])
        with self.assertRaises(ValueError):
            plan.revise('because', 'whim', open_questions=[])
        with self.assertRaises(ValueError):
            plan.revise('because', 'inspection', permissions=['merge'])
        self.assertEqual(len(plan.revisions), 1, 'refused changes leave no trace and change nothing')
        self.assertEqual(plan.open_questions, ['Where are inputs parsed?'])

    def test_a_revision_records_what_changed_what_triggered_it_and_why(self):
        plan = self.plan()
        revision = plan.revise('search_code found the parser in app/io.py', 'inspection', clock=clock,
                               open_questions=[], files=['app/main.py', {'path': 'app/io.py', 'why': 'parses inputs',
                                                                         'evidence': [[3, 9]]}])
        self.assertEqual(revision['trigger'], 'inspection')
        self.assertEqual(revision['at'], 1000.0)
        self.assertEqual(revision['changes'], {'open_questions': {'removed': ['Where are inputs parsed?']},
                                               'files': {'added': ['app/io.py']}})
        self.assertIsNone(plan.revise('nothing new', 'inspection', open_questions=[]), 'a no-op is not a revision')
        self.assertEqual(len(plan.revisions), 2)

    def test_work_moves_from_remaining_to_completed_and_hypotheses_resolve_with_evidence(self):
        plan = self.plan()
        plan.add('A test failed on the int parser', 'test', remaining=['Handle blank strings', 'Cast both inputs'])
        self.assertEqual(plan.remaining, ['Cast both inputs', 'Handle blank strings'], 'duplicates are ignored')
        plan.done('The writer cast both inputs', 'progress', 'Cast both inputs')
        self.assertEqual((plan.remaining, plan.completed), (['Handle blank strings'], ['Cast both inputs']))
        plan.resolve('The failing test passes strings', 'test', 'The caller passes strings', 'confirmed', 'tests/test_add.py:4')
        self.assertEqual(plan.hypotheses, [{'text': 'The caller passes strings', 'status': 'confirmed',
                                            'evidence': 'tests/test_add.py:4'}])
        with self.assertRaises(ValueError):
            plan.resolve('x', 'test', 'never stated', 'rejected')
        with self.assertRaises(ValueError):
            plan.resolve('x', 'test', 'The caller passes strings', 'probably')

    def test_history_is_bounded_but_keeps_how_the_plan_started(self):
        plan = self.plan()
        for i in range(task_plan.MAX_REVISIONS + 10):
            plan.add(f'step {i}', 'progress', completed=[f'step {i}'])
        self.assertEqual(len(plan.revisions), task_plan.MAX_REVISIONS)
        self.assertEqual(plan.revisions[0]['trigger'], 'planning')
        self.assertEqual(plan.revisions[-1]['reason'], f'step {task_plan.MAX_REVISIONS + 9}')
        self.assertEqual(len(plan.completed), task_plan.MAX_ITEMS)
        self.assertEqual(plan.completed[-1], f'step {task_plan.MAX_REVISIONS + 9}', 'the newest entry is kept, not dropped')

    def test_render_shows_every_section_and_the_latest_reasons(self):
        plan = self.plan()
        plan.revise('Investigation read app/io.py', 'inspection', files=['app/main.py', {'path': 'app/io.py', 'evidence': [[3, 9]]}])
        text = plan.render()
        for heading in ('## Task plan', '**Objective:** Cast inputs', '**Acceptance criteria**', '**Files and evidence**',
                        '**Dependencies**', '**Open questions**', '**Hypotheses**', '**Completed**', '**Remaining**',
                        '**Verification**', '**Why the plan changed** (latest 2 of 2)'):
            self.assertIn(heading, text)
        self.assertIn('`app/io.py` (lines 3-9)', text)
        self.assertIn('- inspection: Investigation read app/io.py', text)
        self.assertIn('- open: The caller passes strings', text)
        self.assertNotIn('**Objective:**', plan.render(goal=False), 'the draft PR already shows the goal')

    def test_acceptance_criteria_come_from_the_request_list_or_its_sentences(self):
        self.assertEqual(task_plan.acceptance_criteria('Fix it:\n- accept "3"\n2) reject "x"\n* keep ints'),
                         ['accept "3"', 'reject "x"', 'keep ints'])
        self.assertEqual(task_plan.acceptance_criteria('Make add() accept numeric strings. Keep ints working. Ok.'),
                         ['Make add() accept numeric strings.', 'Keep ints working.'])

    def test_a_saved_plan_with_a_tampered_history_is_refused(self):
        data = self.plan().to_dict()
        self.assertEqual(task_plan.TaskPlan.from_dict(data).to_dict(), data)
        for bad in ([{'trigger': 'owner'}], [{'trigger': 'merge', 'reason': 'x'}], 'x'):
            with self.assertRaises(ValueError):
                task_plan.TaskPlan.from_dict(dict(data, revisions=bad))
        with self.assertRaises(ValueError):
            task_plan.TaskPlan.from_dict(dict(data, hypotheses=[{'text': 'y', 'status': 'proven'}]))


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.journal.checkpoint(SHA, base='main')
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(None))
        self.addCleanup(task_plan.CURRENT.reset, task_plan.CURRENT.set(None))

    def test_the_plan_round_trips_through_the_journal_bound_to_its_task(self):
        plan = task_plan.TaskPlan.initial('Cast inputs', files=['app/main.py'])
        plan.revise('A test failed', 'test', remaining=['Handle blanks'])
        task_plan.save(self.journal, plan, recovery.ROOT, SHA, TASK)
        reloaded = self.world.journal()
        self.assertEqual(task_plan.load(reloaded, recovery.ROOT, SHA, TASK).to_dict(), plan.to_dict())
        for repo, sha, task in ((recovery.ROOT, 'b' * 40, TASK), (recovery.ROOT, SHA, 'different request'),
                                ('someone/else', SHA, TASK)):
            with self.assertRaises(execution.CheckpointMismatch):
                task_plan.load(reloaded, repo, sha, task)
        self.assertIsNone(task_plan.load(None, recovery.ROOT, SHA, TASK))

    def test_a_resumed_task_continues_from_its_saved_plan_without_planning_again(self):
        first = Recorder()
        plan = developer.start_plan(first, self.journal, recovery.ROOT, SHA, TASK, {'title': 'Cast inputs'},
                                    'Convert at the boundary.', ['app/main.py'], ['Cast both inputs'],
                                    ['Where are inputs parsed?'], True)
        self.assertEqual(plan.verification[1], 'Add or update a test that fails without the change and passes with it')
        developer.plan_update(first, 'revise', 'Investigation found the parser', 'inspection', open_questions=[])
        self.assertTrue(any(line['text'] == 'Plan revised: Investigation found the parser' for line in first.lines))

        resumed = Recorder()
        with patch.object(task_plan.TaskPlan, 'initial', side_effect=AssertionError('re-planned')):
            again = developer.start_plan(resumed, self.world.journal(), recovery.ROOT, SHA, TASK, {'title': 'Cast inputs'},
                                         'ignored', ['other.py'], [], [], False)
        self.assertEqual(again.to_dict(), task_plan.CURRENT.get().to_dict())
        self.assertEqual(again.open_questions, [])
        self.assertEqual([f['path'] for f in again.files], ['app/main.py'])
        self.assertIn('Resumed the saved plan (2 revisions); no re-planning', resumed.lines[0]['text'])

    def test_plan_updates_without_a_running_plan_do_nothing(self):
        rec = Recorder()
        developer.plan_update(rec, 'add', 'x', 'test', remaining=['y'])
        self.assertEqual(rec.lines, [])

    def test_the_plan_belongs_to_one_run(self):
        @task_plan.scoped
        def run():
            task_plan.CURRENT.set(task_plan.TaskPlan.initial('x'))
            raise RuntimeError
        with self.assertRaises(RuntimeError):
            run()
        self.assertIsNone(task_plan.CURRENT.get())


if __name__ == '__main__':
    unittest.main()

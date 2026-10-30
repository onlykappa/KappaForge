"""A report-only ask is answered by the controller's own report, so it must never become a repair finding, and that
report must actually carry the commands and counts."""
import unittest

from engine import requirements, validation_report, verify

RUN_AND_REPORT = 'Run `npm test` and the existing review-card and intelligence tests; report exact commands, counts and skips.'
STOP_AFTER = ('Stop after reporting the verified patch and any remaining limitations, and do not claim Docker, native '
              'or live tests unless they were actually run.')


class ReportAskTests(unittest.TestCase):
    def test_pure_report_and_run_then_report_asks_are_controller_answered(self):
        for text in (RUN_AND_REPORT, STOP_AFTER, 'Report exact commands, counts and skips.',
                     'Run the unit tests and report the results.', 'Reporting the outcome and any limitations is required.'):
            with self.subTest(text=text):
                self.assertTrue(verify.report_ask(text), text)
                self.assertTrue(verify.lifecycle_requirement(text), text)

    def test_real_work_that_mentions_reports_is_still_work(self):
        for text in ('Add a report page that lists exact commands and counts.', 'Fix the crash report exporter.',
                     'Run the importer on every file.', 'Run `npm test`.', 'Report a bug upstream when the API returns 500.',
                     'Change the report format to CSV and report errors in red.',
                     'Report failure counts on the dashboard.', 'Report the validation status in the app banner.'):
            with self.subTest(text=text):
                self.assertFalse(verify.report_ask(text), text)

    def test_a_report_ask_is_never_a_behavioral_requirement(self):
        for text in (RUN_AND_REPORT, STOP_AFTER):
            row = requirements.classify(text)[0]
            self.assertFalse(row.behavioral, row.categories)

    def test_a_report_ask_is_not_a_repair_problem(self):
        self.assertTrue(verify.lifecycle_problem('Requirement not met: ' + RUN_AND_REPORT))
        self.assertTrue(verify.lifecycle_problem('Requirement not met: ' + STOP_AFTER + " ({'citation': None})"))


class RenderTests(unittest.TestCase):
    UNIT = dict(argv=['python', '-m', 'unittest', 'discover', '-s', 'tests'], status='passed', exit_code=0, duration_s=203.5,
                output='Ran 1421 tests in 203.512s\n\nOK (skipped=38)\n')
    NODE = dict(argv=['npm', 'test'], status='passed', exit_code=0, duration_s=5.0,
                output='# tests 911\n# suites 0\n# pass 911\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')

    def test_exact_commands_status_and_parsed_counts(self):
        text = validation_report.render([self.UNIT, self.NODE])
        self.assertIn('`python -m unittest discover -s tests`', text)
        self.assertIn('ran 1,421, skipped 38, failed 0', text)
        self.assertIn('`npm test`', text)
        self.assertIn('ran 911, skipped 0, failed 0', text)
        self.assertIn('exit 0', text)

    def test_unparseable_output_never_invents_counts(self):
        text = validation_report.render([dict(argv=['make', 'check'], status='passed', exit_code=0, duration_s=1.0, output='done')])
        self.assertIn('`make check`', text)
        self.assertIn('counts not reported by the runner', text)
        self.assertNotIn('ran ', text)

    def test_failures_are_reported_as_failures(self):
        failed = dict(self.UNIT, status='failed', exit_code=1, output='Ran 10 tests in 1s\n\nFAILED (failures=2, errors=1, skipped=3)\n')
        text = validation_report.render([failed])
        self.assertIn('failed', text)
        self.assertIn('ran 10, skipped 3, failed 3', text)

    def test_hostile_text_is_neutralised(self):
        text = validation_report.render([dict(argv=['echo', '`x`', '@someone\n## injected'], status='passed', exit_code=0,
                                             duration_s=0.1, output='')])
        self.assertNotIn('\n## injected', text)
        self.assertNotIn('@someone', text.replace('@​someone', ''))

    def test_nothing_to_report_renders_nothing(self):
        self.assertEqual(validation_report.render([]), '')


if __name__ == '__main__':
    unittest.main()


class StaleUntestedNoteTests(unittest.TestCase):
    """A stored 'Requirement untested' note from an older classification is a review gap, not a source defect."""
    from tests.test_requirement_sections import TASK

    def setUp(self):
        from engine import task_goal
        self.handle = task_goal.CURRENT.set(task_goal.from_request(self.TASK))
        self.addCleanup(task_goal.CURRENT.reset, self.handle)

    @staticmethod
    def note(text):
        return f'Requirement untested: R9 {text[:200]} (add or cite a test that exercises it)'

    def test_notes_for_process_background_headings_and_constraints_are_stale(self):
        for text in ('Start from current main and inspect the actual code before editing.', 'Required behavior:',
                     'Verified problem. review.js treats every human comment as unresolved feedback, so canFix is always true.',
                     'Do not touch engine/, workflows or any deploy path.', 'Do not merge, deploy, release or change permissions.'):
            with self.subTest(text=text):
                self.assertTrue(verify.stale_untested(self.note(text)))
                self.assertTrue(verify.process_problem(self.note(text)))

    def test_notes_for_real_behavior_stay_source_problems(self):
        for text in ('In review-evidence.js, add `createdAt` and `updatedAt` to every feedback item.',
                     'In review.js, reviewFeedback must be true only when an item is unanswered.'):
            with self.subTest(text=text):
                self.assertFalse(verify.stale_untested(self.note(text)))
                self.assertFalse(verify.process_problem(self.note(text)))

    def test_unknown_or_unrelated_text_is_never_stale(self):
        self.assertFalse(verify.stale_untested(self.note('A requirement the task never made.')))
        self.assertFalse(verify.stale_untested('Requirement not met: Start from current main.'))
        self.assertFalse(verify.stale_untested(self.note('Do')))

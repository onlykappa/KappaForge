"""Boundaries, background and headings are not behavior to prove with a test; real requirements still are."""
import unittest

from engine import requirements

TASK = """Phase 3 follow-up: make the review card accurate. Start from current main and inspect the actual code before editing.

Verified problem. review.js treats every human comment as unresolved feedback, so canFix is always true.

Required behavior:
1. In review-evidence.js, add `createdAt` and `updatedAt` to every feedback item.
2. In review.js, reviewFeedback must be true only when an item is unanswered.

Tests. Add behavioral tests in tests/review-evidence.test.mjs covering answered and edited feedback.

Constraints. Change only review.js and files under tests/. Do not touch engine/, workflows or any deploy path. Do not merge, deploy, release or change permissions. Stop after reporting the verified patch."""


def by_text(rows):
    return {row.text: row for row in rows}


class SectionTests(unittest.TestCase):
    def setUp(self):
        self.rows = by_text(requirements.classify(TASK))

    def row(self, start):
        return next(r for t, r in self.rows.items() if t.startswith(start))

    def test_the_real_requirements_still_need_tests(self):
        self.assertTrue(self.row('In review-evidence.js, add').behavioral)
        self.assertTrue(self.row('In review.js, reviewFeedback').behavioral)

    def test_a_process_sentence_and_a_bare_heading_are_not_behavior(self):
        self.assertFalse(self.row('Start from current main').behavioral)
        self.assertFalse(self.row('Required behavior:').behavioral)

    def test_background_is_not_behavior(self):
        self.assertFalse(self.row('Verified problem.').behavioral)

    def test_every_constraint_is_housekeeping_never_a_test_demand(self):
        for start in ('Change only review.js', 'Do not touch engine/', 'Do not merge, deploy', 'Stop after reporting'):
            with self.subTest(start=start):
                row = self.row(start)
                self.assertFalse(row.behavioral, row.categories)
                self.assertIn('housekeeping', row.categories)

    def test_safety_labels_survive_inside_constraints(self):
        row = self.row('Do not merge, deploy')
        self.assertIn('security', row.categories)  # "change permissions" is a security signal, never dropped
        merge = requirements.classify('Constraints. Merge the pull request when the tests pass.')[0]
        self.assertIn('owner_decision', merge.categories)
        self.assertTrue(merge.owner_action)

    def test_behavior_outside_a_constraints_section_is_unchanged(self):
        row = requirements.classify('Do not crash when the input is empty.')[0]
        self.assertTrue(row.behavioral)
        row = requirements.classify('Add validation. Constraints. Keep it fast.\n\nFix the parser so it never returns null.')
        self.assertTrue(any(r.behavioral and r.text.startswith('Fix the parser') for r in row))

    def test_a_short_ask_ending_in_a_colon_is_not_a_heading(self):
        for ask in ('Fix the login bug:', 'Add retry logic:', 'Remove the cache:'):
            with self.subTest(ask=ask):
                self.assertTrue(requirements.classify(ask)[0].behavioral, ask)

    def test_preservation_constraints_are_not_behavior_but_program_behavior_is(self):
        for text in ("Do not change the engine's reply format, the evidence shape or the pagination limits.",
                     'Never remove the existing exports.', "Don't touch any workflow or deploy path.",
                     'Do not weaken those tests.'):
            with self.subTest(text=text):
                self.assertFalse(requirements.classify(text)[0].behavioral, text)
        for text in ('Do not crash when the input is empty.', 'Never return null for missing values.',
                     'Do not delete user data when the account closes.'):
            with self.subTest(text=text):
                self.assertTrue(requirements.classify(text)[0].behavioral, text)

    def test_a_blank_line_ends_the_section(self):
        rows = requirements.classify('Constraints. Do not touch engine/.\n\nThe export must keep the header row.')
        by = by_text(rows)
        self.assertFalse(by['Do not touch engine/.'].behavioral)
        self.assertTrue(by['The export must keep the header row.'].behavioral)

    def test_ids_and_offsets_do_not_move(self):
        rows = requirements.split(TASK)
        self.assertEqual([r['id'] for r in rows], ['R' + str(i) for i in range(1, len(rows) + 1)])
        self.assertIn('Required behavior:', [r['text'] for r in rows])


if __name__ == '__main__':
    unittest.main()

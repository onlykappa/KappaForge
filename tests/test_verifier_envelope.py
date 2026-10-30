"""The finding verifier must be answerable by small free models: short ids, tolerant envelope, safe diagnostics."""
import json
import unittest

from engine import repair_guard


CLAIMS = ['claim one about value.py', 'claim two about other.py']
SOURCES = {'value.py': 'value = 1\n', 'other.py': 'other = 2\n'}


def decision(finding_id, verdict='needs_validation'):
    return dict(id=finding_id, verdict=verdict, in_goal=True, reason='Needs the missing evidence')


class ShortIdTests(unittest.TestCase):
    def data(self):
        return repair_guard.payload(SOURCES, CLAIMS)

    def test_the_model_sees_short_ids_never_the_64_character_digests(self):
        data = self.data()
        seen = [row['id'] for row in repair_guard.public(data)['findings']]
        self.assertEqual(seen, ['F1', 'F2'])
        self.assertTrue(all(len(row['id']) == 64 for row in data['findings']))

    def test_short_ids_map_back_to_the_engine_digests(self):
        data = self.data()
        ids = {row['id'] for row in data['findings']}
        rows = repair_guard.review_shape(json.dumps({'findings': [decision('F2'), decision('F1')]}), ids, data['aliases'])
        self.assertEqual({row['id'] for row in rows}, ids)
        self.assertFalse(any(row.get('unanswered') for row in rows))

    def test_a_full_digest_is_still_accepted(self):
        data = self.data()
        ids = {row['id'] for row in data['findings']}
        first = data['findings'][0]['id']
        rows = repair_guard.review_shape(json.dumps({'findings': [decision(first)]}), ids, data['aliases'])
        self.assertEqual([r['id'] for r in rows if not r.get('unanswered')], [first])

    def test_foreign_or_duplicate_ids_still_fail_closed(self):
        data = self.data()
        ids = {row['id'] for row in data['findings']}
        with self.assertRaisesRegex(ValueError, 'missing_or_foreign_ids'):
            repair_guard.review_shape(json.dumps({'findings': [decision('F9')]}), ids, data['aliases'])
        with self.assertRaisesRegex(ValueError, 'missing_or_foreign_ids'):
            repair_guard.review_shape(json.dumps({'findings': [decision('F1'), decision('F1')]}), ids, data['aliases'])
        first = data['findings'][0]['id']
        with self.assertRaisesRegex(ValueError, 'missing_or_foreign_ids'):
            repair_guard.review_shape(json.dumps({'findings': [decision('F1'), decision(first)]}), ids, data['aliases'])


class EnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.data = repair_guard.payload(SOURCES, CLAIMS)
        self.ids = {row['id'] for row in self.data['findings']}

    def test_a_bare_list_of_decisions_is_the_same_envelope(self):
        rows = repair_guard.review_shape(json.dumps([decision('F1'), decision('F2')]), self.ids, self.data['aliases'])
        self.assertEqual({row['id'] for row in rows}, self.ids)

    def test_an_empty_list_or_object_is_no_decision_and_reports_only_counts(self):
        for output in ('[]', '{}', '{"findings": []}'):
            with self.subTest(output=output):
                with self.assertRaises(ValueError) as caught:
                    repair_guard.review_shape(output, self.ids, self.data['aliases'])
                self.assertEqual(repair_guard.invalid_code(caught.exception), 'missing_or_foreign_ids:0/2')

    def test_other_json_types_are_still_not_an_envelope_and_name_only_their_type(self):
        for output, kind in (('"findings"', 'str'), ('7', 'int'), ('null', 'null'), ('true', 'bool')):
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError) as caught:
                    repair_guard.review_shape(output, self.ids, self.data['aliases'])
                self.assertEqual(repair_guard.invalid_code(caught.exception), 'not_an_object:' + kind)

    def test_the_foreign_id_diagnostic_reports_only_counts(self):
        with self.assertRaises(ValueError) as caught:
            repair_guard.review_shape(json.dumps({'findings': [decision('SECRET-ID-TEXT')]}), self.ids, self.data['aliases'])
        code = repair_guard.invalid_code(caught.exception)
        self.assertEqual(code, 'missing_or_foreign_ids:0/2')
        self.assertNotIn('SECRET', code)


if __name__ == '__main__':
    unittest.main()

"""Repository routing metadata and duplicate requirement text cannot crowd out review evidence."""
import json
import unittest
from engine import verify


class ReviewOverheadTests(unittest.TestCase):
    def test_inventory_is_bounded_and_prioritizes_named_late_paths(self):
        paths = [f'tests/test_component_{n:04}_integration_behavior.py' for n in range(500)]
        target = paths[-1]
        shown = verify.review_inventory(paths, 'Inspect ' + target)
        self.assertLessEqual(len(shown), 2000)
        self.assertTrue(shown.startswith(target))
        self.assertIn('additional repository paths omitted', shown)
        self.assertIn('all changed files still require scope review', shown)
        self.assertEqual(len(paths), 500)

    def test_requirement_spans_reconstruct_every_exact_unicode_and_unmatched_ask(self):
        asks = ['Preserve café input.', 'Keep owner approval.', 'Additional prior requirement not repeated in task.']
        task = 'Owner request: ' + '\n'.join(asks[:2])
        rows = verify.requirement_references(task, asks)
        restored = [task[row['span'][0]:row['span'][1]] if 'span' in row else row['text'] for row in rows]
        self.assertEqual(restored, asks)
        self.assertEqual(rows[-1], {'text': asks[-1]})
        self.assertEqual(verify.requirement_references(task, asks + asks), rows)

    def test_owner_shaped_request_and_full_inventory_leave_room_for_source(self):
        asks = ['Requirement ' + str(i) + ': ' + 'preserve requested behavior ' * 4 for i in range(23)]
        task = '\n'.join(asks)
        retained = ('RETAIN THESE EXACT REQUIREMENTS IN EVERY REVIEW: spans refer to ORIGINAL TASK.\n' +
                    json.dumps(verify.requirement_references(task, asks)) + '\nORIGINAL TASK:\n' + task)
        paths = [f'tests/test_component_{n:04}_integration_behavior.py' for n in range(500)]
        source = 'CURRENT SOURCE app.py:\nreturn owner_requested_value\n'
        prompt = verify.review_prompt(retained, '', paths, source)
        self.assertLess(len(prompt), 11000)
        self.assertEqual(prompt.count(task), 1)
        self.assertIn(source, prompt)
        self.assertIn('Every met:true requirement must include evidence', prompt)

    def test_shared_fragments_preserve_differing_requirement_wording_exactly(self):
        shared = 'Preserve the existing sandbox, repository exploration, requirement classification and owner review behavior'
        task = shared + '; record inspected evidence.'
        text = 'Earlier wording: ' + shared + ' — evidence still pending.'
        row = verify.requirement_references(task, [text])[0]
        self.assertIn('parts', row)
        restored = ''.join(task[p['span'][0]:p['span'][1]] if 'span' in p else p['text'] for p in row['parts'])
        self.assertEqual(restored, text)
        self.assertLess(len(json.dumps(row)), len(json.dumps({'text': text})))

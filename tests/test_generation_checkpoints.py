import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from engine import developer, execution, generation_checkpoint, recovery


class MemoryJournal:
    def __init__(self):
        self.scope = SimpleNamespace(number=17, repo='onlykappa/KappaForge', digest='scope-digest')
        self.state = {'candidate': 'a' * 40}
        self.rows = []
        self.next_id = 1

    def wire(self, value):
        return json.dumps(value, sort_keys=True, ensure_ascii=True)

    def write(self, _path, payload, _method=None):
        row = {'id': self.next_id, 'user': {'login': recovery.BOT}, 'body': payload['body']}
        self.next_id += 1
        self.rows.append(row)
        return row

    def read(self, path):
        if '/comments?' in path:
            return self.rows
        raise AssertionError(path)

    def persist(self):
        pass


class GenerationCheckpointTests(unittest.TestCase):
    def setUp(self):
        developer.UNFINISHED.clear()
        self.journal = MemoryJournal()
        self.token = recovery.CURRENT.set(self.journal)

    def tearDown(self):
        recovery.CURRENT.reset(self.token)
        developer.UNFINISHED.clear()

    def build(self, stages, **kwargs):
        return developer.build_in_stages('key', 'owner task', 'onlykappa/KappaForge',
                                         {'app.py': 'before = 1\n'}, {'app.py': 12}, '', None,
                                         stages, **kwargs)

    def test_completed_stage_is_restored_without_repeating_model_call(self):
        calls = []

        def interrupted(_key, prompt, *_args, **_kwargs):
            calls.append(prompt)
            if 'THIS IS STAGE 1' in prompt:
                return 'model-a', 'stage one', {'app.py': 'before = 2\n'}, 'changed one'
            raise RuntimeError('runner interrupted')

        with patch.object(developer, 'generate', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'runner interrupted'):
                self.build(['first', 'second'])
        self.assertEqual(len(self.journal.state['generationCheckpoint']['parts']), 1)
        self.assertEqual(len(calls), 2)

        with patch.object(developer, 'generate', return_value=('model-b', 'stage two', {'app.py': 'before = 3\n'}, 'changed two')) as generate:
            _model, _summary, changes, _explanation = self.build(['first', 'second'])
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(changes['app.py'], 'before = 3\n')

    def test_completed_no_edit_stage_is_restored_without_repeating_model_call(self):
        calls = []

        def interrupted(_key, prompt, *_args, **_kwargs):
            calls.append(prompt)
            if 'THIS IS STAGE 1' in prompt:
                return 'model-a', 'already complete', {}, 'no edit needed'
            raise RuntimeError('runner interrupted')

        with patch.object(developer, 'generate', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'runner interrupted'):
                self.build(['first', 'second'])
        expected = generation_checkpoint.identity(self.journal, 'owner task', 'onlykappa/KappaForge',
                                                  {'app.py': 'before = 1\n'}, {'app.py': 12}, '',
                                                  ['first', 'second'], '', False)
        saved = generation_checkpoint.load(self.journal, expected)
        self.assertIn('Stage 1: already complete', saved['summaries'])
        with patch.object(developer, 'generate', return_value=('model-b', 'stage two', {'app.py': 'before = 3\n'}, 'changed two')) as generate:
            self.build(['first', 'second'])
        self.assertEqual(generate.call_count, 1)

    def test_changed_stage_plan_rejects_unpublished_checkpoint(self):
        with patch.object(developer, 'generate', return_value=('model-a', 'one', {'app.py': 'before = 2\n'}, 'change')):
            self.build(['first'])
        with self.assertRaises(execution.CheckpointMismatch):
            self.build(['different'])

    def test_no_stage_generation_is_saved_and_reused(self):
        result = ('model-a', 'summary', {'app.py': 'before = 2\n'}, 'explanation')
        with patch.object(developer, 'generate', return_value=result) as generate:
            self.assertEqual(self.build([]), result)
        with patch.object(developer, 'generate', side_effect=AssertionError('must reuse saved generation')) as generate:
            self.assertEqual(self.build([]), result)
        generate.assert_not_called()

    def test_generated_secret_is_blocked_before_checkpoint(self):
        with patch.dict(os.environ, {'KAPPA_TEST_SECRET': 'private-value'}):
            with patch.object(developer, 'generate', return_value=('model-a', 'summary', {'app.py': 'token="private-value"\n'}, 'explanation')):
                with self.assertRaises(execution.CheckpointMismatch):
                    self.build(['first'])
        self.assertNotIn('generationCheckpoint', self.journal.state)


if __name__ == '__main__':
    unittest.main()

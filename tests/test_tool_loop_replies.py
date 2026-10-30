"""A small free model must be able to recover from a malformed tool reply: tolerant envelope, a precise safe diagnosis,
a hint it sees on the next call, and room to rewrite a test file in one reply."""
import json
import unittest

from engine import tool_loop


class Model:
    def __init__(self, *replies):
        self.replies, self.prompts, self.kwargs = list(replies), [], []

    def __call__(self, key, prompt, **kwargs):
        self.prompts.append(prompt)
        self.kwargs.append(kwargs)
        return 'scripted', self.replies.pop(0)


CALL = {'tool': 'run_tests', 'args': {}, 'reason': 'check'}


def ran(model, steps=1):
    seen = []
    tools = {'run_tests': lambda **a: seen.append(a) or {'status': 'ok'}}
    return tool_loop.run_tool_loop(model, 'k', 't', tools, max_steps=steps), seen


class EnvelopeTests(unittest.TestCase):
    def test_a_single_fenced_json_object_is_the_same_call(self):
        for fence in ('```json\n%s\n```', '```\n%s\n```', '  ```JSON\n%s\n```  '):
            with self.subTest(fence=fence):
                result, seen = ran(Model(fence % json.dumps(CALL)))
                self.assertEqual(result['steps'][0]['tool'], 'run_tests')
                self.assertEqual(seen, [{}])

    def test_a_list_holding_one_call_is_the_same_call(self):
        result, seen = ran(Model(json.dumps([CALL])))
        self.assertEqual(result['steps'][0]['tool'], 'run_tests')
        self.assertEqual(len(seen), 1)

    def test_several_calls_in_one_reply_are_not_guessed_at(self):
        result, seen = ran(Model(json.dumps([CALL, CALL])))
        self.assertEqual(seen, [])
        self.assertIn('list', result['steps'][0]['result']['reason'])

    def test_text_around_json_is_still_refused(self):
        result, seen = ran(Model('Sure! ' + json.dumps(CALL)))
        self.assertEqual(seen, [])
        self.assertEqual(result['steps'][0]['result']['status'], 'invalid')

    def test_an_unknown_tool_inside_a_fence_is_still_refused(self):
        result, seen = ran(Model('```json\n' + json.dumps(dict(CALL, tool='rm_rf')) + '\n```'))
        self.assertEqual(seen, [])
        self.assertEqual(result['steps'][0]['result']['status'], 'invalid')


class DiagnosisTests(unittest.TestCase):
    def invalid(self, reply):
        result, _ = ran(Model(reply))
        return result['steps'][0]['result']

    def test_the_reason_names_the_kind_of_failure_and_the_length_never_the_content(self):
        secret = 'SECRET-TOKEN-1234'
        for reply, kind in (('{"tool": "run_tests", "args": {"x": "' + secret + '" ', 'not JSON'),
                            (json.dumps([secret, secret]), 'JSON list'), (json.dumps(secret), 'JSON string'),
                            ('7', 'JSON number'), ('null', 'JSON null')):
            with self.subTest(kind=kind):
                result = self.invalid(reply)
                self.assertIn(kind, result['reason'])
                self.assertEqual(result['reply_chars'], len(reply))
                self.assertNotIn('SECRET', json.dumps(result))

    def test_an_unknown_tool_is_told_the_real_ones_and_nothing_it_sent(self):
        result = self.invalid(json.dumps({'tool': 'review', 'args': {}, 'reason': 'x'}))
        self.assertIn('unknown or unavailable tool', result['reason'])
        self.assertIn('run_tests', result['reason'])
        self.assertNotIn('review', result['reason'].replace('use one of', ''))

    def test_the_reason_keeps_its_original_prefix(self):
        self.assertTrue(self.invalid('not json')['reason'].startswith('invalid JSON reply: expected an object'))

    def test_a_cut_off_reply_is_told_to_split_the_edit(self):
        result = self.invalid('{"tool": "apply_patch", "args": {"edits": [{"path": "a", "find": "x", "replace": "' + 'y' * 9000)
        self.assertIn('not JSON', result['reason'])
        self.assertIn('several', result['reason'])

    def test_the_hint_reaches_the_model_on_its_next_call(self):
        model = Model('{"tool": "run_tests"', json.dumps(CALL))
        result, _ = ran(model, steps=2)
        self.assertIn('exactly one JSON object', model.prompts[1])
        self.assertEqual(result['steps'][-1]['tool'], 'run_tests')


class ReplyRoomTests(unittest.TestCase):
    def test_a_reply_has_room_for_a_whole_test_file(self):
        model = Model(json.dumps(CALL))
        ran(model)
        self.assertGreaterEqual(model.kwargs[0]['max_output_tokens'], 3500)
        self.assertEqual(model.kwargs[0]['max_output_tokens'], tool_loop.TOOL_REPLY_TOKENS)


if __name__ == '__main__':
    unittest.main()

"""The live task transcript: narration, grouped actions, command output and changed-line counts on the feed."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine import developer, execution, sandbox_repair_controller, tool_loop


class Recorder:
    def __init__(self):
        self.lines = []

    def act(self, kind, text, write=True, **feed):
        self.lines.append(dict(kind=kind, text=text, **feed))


def progress():
    with patch.object(developer, 'gh', return_value={'id': 1}):
        p = developer.Progress(5, 'not-published')
    p._write = lambda: None
    return p


class FeedLineTests(unittest.TestCase):
    def test_step_starts_are_narration_and_actions_carry_structure(self):
        p = progress()
        p.now('Reading the repository')
        p.act('code', 'Edited 1 file: a.py', tool='edit', detail='a.py', added=3, removed=1, count=1, status='weird')
        say, edit = p.activity[-2:]
        self.assertTrue(say['say'])
        self.assertEqual({k: edit[k] for k in ('tool', 'detail', 'added', 'removed', 'count')},
                         dict(tool='edit', detail='a.py', added=3, removed=1, count=1))
        self.assertNotIn('status', edit, 'unknown statuses are dropped')
        p.act('work', 'x', tool='deploy', added=-1, count=True)
        self.assertEqual(set(p.activity[-1]) - {'kind', 'text', 'at'}, set(), 'unknown tools and bad counts are dropped')

    def test_a_command_result_replaces_its_running_line(self):
        p = progress()
        p.act('test', 'Running pytest', tool='test', detail='pytest', status='running')
        p.act('test', 'Ran pytest', tool='test', detail='pytest', status='passed', output='3 passed')
        p.act('test', 'Running pytest', tool='test', detail='pytest', status='running')
        self.assertEqual([(a['text'], a['status']) for a in p.activity], [('Ran pytest', 'passed'), ('Running pytest', 'running')])

    def test_only_the_latest_outputs_are_kept_so_the_feed_fits_one_comment(self):
        p = progress()
        for i in range(developer.ACTIVITY_OUTPUTS + 5):
            p.act('work', f'Ran step {i}', tool='run', detail=f'step {i}', output='x' * 1000, status='passed')
        kept = [a for a in p.activity if 'output' in a]
        self.assertEqual(len(kept), developer.ACTIVITY_OUTPUTS)
        self.assertEqual(kept[-1]['text'], f'Ran step {developer.ACTIVITY_OUTPUTS + 4}')
        self.assertTrue(all(len(a['output']) == 400 for a in kept))
        self.assertLess(len(json.dumps(p.activity)), 20000)

    def test_written_files_are_counted_as_created_or_edited_with_line_deltas(self):
        p = progress()
        with patch.object(developer.Progress, 'latest', p):
            developer.note_changes('m', {'new.py': 'a\nb\n', 'old.py': 'x\nY\nz\n', 'big.py': 'q'},
                                   {'old.py': 'x\ny\nz\n'}, {'old.py': 6, 'big.py': 900000})
        created, edited = p.activity[-2:]
        self.assertEqual((created['tool'], created['count'], created['added'], created['removed']), ('create', 1, 2, 0))
        self.assertEqual((edited['tool'], edited['count'], edited['detail']), ('edit', 2, 'old.py\nbig.py'))
        self.assertNotIn('added', edited, 'a file shown only as excerpts cannot be counted, so the group claims no count')
        self.assertEqual(developer.line_delta('x\ny\nz\n', 'x\nY\nz\nw\n'), (2, 1))


class SandboxTranscriptTests(unittest.TestCase):
    def test_sandbox_commands_report_running_then_result_with_a_sanitized_output_tail(self):
        rec = Recorder()
        owner = SimpleNamespace(progress=rec)
        execution.Execution._feed(owner, ['npm', 'test', '--', 'a b'], 'test', 'tests', 'running')
        execution.Execution._feed(owner, ['npm', 'test', '--', 'a b'], 'test', 'tests', 'failed',
                                  'boom GITHUB_TOKEN=ghp_' + 'a' * 36)
        execution.Execution._feed(owner, [], 'install', 'node', 'skipped')
        running, failed = rec.lines
        self.assertEqual((running['tool'], running['status'], running['detail']), ('test', 'running', "npm test -- 'a b'"))
        self.assertEqual((failed['kind'], failed['status']), ('error', 'failed'))
        self.assertTrue(failed['text'].endswith('(failed)'))
        self.assertNotIn('ghp_' + 'a' * 36, failed['output'])
        execution.Execution._feed(owner, ['make'], 'test', 'model', 'passed', 'ok')
        self.assertEqual(rec.lines[-1]['tool'], 'run', 'a model-chosen command is a command, not the test suite')

    def test_the_model_reason_is_narrated_before_its_action_runs(self):
        order = []
        tools = {'run_command': lambda argv, profile='test': order.append('ran') or {'ok': True, 'status': 'passed'}}
        reply = json.dumps({'tool': 'run_command', 'args': {'argv': ['ls']}, 'reason': 'Check what is there'})
        tool_loop.run_tool_loop(lambda *a, **k: ('m', reply), 'k', 'task', tools, max_steps=1,
                                on_call=lambda tool, args, reason: order.append(('say', reason)))
        self.assertEqual(order, [('say', 'Check what is there'), 'ran'])

    def test_edits_reverts_and_reads_become_transcript_lines(self):
        rec = Recorder()
        controller = SimpleNamespace(progress=rec)
        report = sandbox_repair_controller.SandboxRepairController._report
        sandbox_repair_controller.SandboxRepairController._narrate(controller, 'apply_patch', {}, '  Fix the off-by-one  ')
        report(controller, 'apply_patch', {'edits': [{'path': 'a.py', 'find': 'x\n', 'replace': 'y\nz\n'}]},
               {'ok': True, 'status': 'applied', 'changed_paths': ['a.py']})
        report(controller, 'apply_patch', {'edits': []}, {'ok': False, 'status': 'invalid'})
        report(controller, 'inspect_diff', {}, {'ok': True, 'status': 'ok'})
        report(controller, 'run_command', {'argv': ['ls']}, {'ok': True, 'status': 'passed'})
        say, edit, read = rec.lines
        self.assertEqual((say['text'], say['say']), ('Fix the off-by-one', True))
        self.assertEqual((edit['tool'], edit['added'], edit['removed'], edit['count']), ('edit', 2, 1, 1))
        self.assertEqual((read['tool'], read['text']), ('read', 'Reviewed the candidate diff'))


if __name__ == '__main__':
    unittest.main()

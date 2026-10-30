import hashlib
import unittest
from engine import exploration, sandbox_repair_controller
from engine.sandbox_tools import SandboxTools
from tests.test_sandbox_tools import FakeSession

class VersionedPatchTests(unittest.TestCase):
    def setUp(self):
        self.session = FakeSession({'x.py': 'a = 1\nb = 2\nc = 3\n'})
        self.tools = SandboxTools(self.session)
        self.digest = hashlib.sha256(self.session.current()['x.py']).hexdigest()

    def test_ranges_share_one_version_and_apply_atomically(self):
        result = self.tools.apply_line_patch('x.py', self.digest, [
            dict(start_line=1, end_line=1, replace='a = 10\nextra = 0\n'),
            dict(start_line=3, end_line=3, replace='c = 30\n')])
        self.assertEqual(result['status'], 'applied')
        self.assertEqual(self.session.current()['x.py'], b'a = 10\nextra = 0\nb = 2\nc = 30\n')

    def test_stale_version_conflict_requires_new_observation(self):
        self.session.apply({'x.py':'other = 4\n'})
        result = self.tools.apply_line_patch('x.py', self.digest,[dict(start_line=1,end_line=1,replace='bad\n')])
        self.assertEqual(result['status'], 'conflict')
        self.assertIn('read_hint', result)
        self.assertEqual(self.session.current()['x.py'], b'other = 4\n')

    def test_invalid_batch_never_applies_partial_changes(self):
        for edits in [[dict(start_line=1,end_line=1,replace='a = 10\n'),dict(start_line=50,end_line=50,replace='bad')],
                      [dict(start_line=1,end_line=2,replace='bad'),dict(start_line=2,end_line=3,replace='bad')],
                      [dict(start_line=True,end_line=1,replace='bad')]]:
            self.assertEqual(self.tools.apply_line_patch('x.py',self.digest,edits)['status'],'invalid')
            self.assertEqual(self.session.current()['x.py'], b'a = 1\nb = 2\nc = 3\n')

    def test_path_escape_and_missing_file_refused(self):
        for path in ['../outside.py', 'missing.py']:
            self.assertEqual(self.tools.apply_line_patch(path,self.digest,[dict(start_line=1,end_line=1,replace='bad')])['status'],'invalid')

    def test_read_file_digest_matches_exact_candidate_bytes(self):
        repo=exploration.Repository({'x.py':len(self.session.current()['x.py'])},lambda p:self.session.current()[p].decode())
        explorer=exploration.Explorer(repo)
        result=explorer.call('read_file',path='x.py',start_line=2,end_line=2)
        self.assertEqual(result['sha256'],self.digest)
        self.assertEqual(result['text'],'b = 2')

    def test_new_tool_cannot_bypass_recurring_failure_plan_guard(self):
        controller=sandbox_repair_controller.SandboxRepairController(self.session)
        controller.state={'failure_family':'same','failure_families':{'same':2}}
        result=controller._planned_line_patch('x.py',self.digest,[dict(start_line=1,end_line=1,replace='bad')])
        self.assertEqual(result['status'],'invalid')
        self.assertEqual(self.session.current()['x.py'],b'a = 1\nb = 2\nc = 3\n')

"""Failed anchors are observed once per exact source, retained across controller state restore."""
import copy
import unittest
from unittest.mock import patch
from engine import sandbox_repair_controller
from tests.test_sandbox_tools import FakeSession


class RejectedEditMemoryTests(unittest.TestCase):
    def controller(self):
        work = FakeSession({'app.py': 'value=1\n', 'other.py': 'unchanged\n'})
        return sandbox_repair_controller.SandboxRepairController(work)

    def test_different_replacement_or_unrelated_file_cannot_reexecute_failed_anchor(self):
        agent = self.controller()
        with patch.object(agent.tools, 'apply_patch', wraps=agent.tools.apply_patch) as dispatch:
            first = agent._planned_patch([dict(path='app.py', find='missing', replace='value=2')])
            self.assertEqual(first['category'], 'edit_anchor')
            agent.session.apply({'other.py': 'different but irrelevant\n'})
            again = agent._planned_patch([dict(path='app.py', find='missing', replace='value=3')])
            self.assertTrue(again['repeated'])
            self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(agent.session.current()['app.py'], b'value=1\n')

    def test_restored_state_retains_rejected_anchor_and_corrected_arguments_can_succeed(self):
        old = self.controller()
        old._planned_patch([dict(path='app.py', find='missing', replace='value=2')])
        new = self.controller(); new.state = copy.deepcopy(old.state)
        with patch.object(new.tools, 'apply_patch', wraps=new.tools.apply_patch) as dispatch:
            result = new._planned_patch([dict(path='app.py', find='missing', replace='value=2')])
            self.assertTrue(result['repeated']); dispatch.assert_not_called()
            corrected = new._planned_patch([dict(path='app.py', find='value=1', replace='value=2')])
            self.assertEqual(corrected['status'], 'applied')
            self.assertEqual(dispatch.call_count, 1)

    def test_changed_actual_source_is_a_new_condition(self):
        agent = self.controller()
        agent._planned_patch([dict(path='app.py', find='missing', replace='value=2')])
        agent.session.apply({'app.py':'missing\n'})
        result = agent._planned_patch([dict(path='app.py', find='missing', replace='value=2')])
        self.assertEqual(result['status'], 'applied')

    def test_changed_same_file_prefix_can_make_later_anchor_valid(self):
        agent = self.controller()
        first = [dict(path='app.py',find='value=1',replace='value=3'),
                 dict(path='app.py',find='value=2',replace='value=4')]
        self.assertEqual(agent._planned_patch(first)['category'], 'edit_anchor')
        self.assertEqual(agent.session.current()['app.py'], b'value=1\n', 'Failed batch must be atomic')
        fixed = [dict(path='app.py',find='value=1',replace='value=2'),first[1]]
        self.assertEqual(agent._planned_patch(fixed)['status'], 'applied')
        self.assertEqual(agent.session.current()['app.py'], b'value=4\n')

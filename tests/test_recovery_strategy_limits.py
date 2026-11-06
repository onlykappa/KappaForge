"""A bounded source-backed repair allowance survives restart independently of provider waits."""
import copy
import json
import unittest
from unittest.mock import Mock, patch
from engine import execution, intent_guard, recovery, repair_strategy, sandbox_repair_controller, task_goal
from engine.reliability import ProviderRoutesUnavailable
from tests.test_repair_strategy import NamedFailureDocker
from tests.test_sandbox_repair_controller import fixture_tree
from tests.test_recovery_journal import GitHub
from tests.test_execution_recovery import session as authorized_session

MECHANISMS=['Initialize from the configured default','Normalize the public input contract',
            'Preserve the explicitly supplied value','Read the calling object argument','Use the public setter boundary']


class RecoveryStrategyLimitTests(unittest.TestCase):
    def setUp(self):
        for var in (recovery.CURRENT,intent_guard.ACTIVE,task_goal.CURRENT):
            token=var.set(None);self.addCleanup(var.reset,token)

    def test_five_applied_mechanisms_stop_without_a_sixth_model_request(self):
        agent=sandbox_repair_controller.SandboxRepairController(fixture_tree(NamedFailureDocker()))
        replies=[]
        for index,strategy in enumerate(MECHANISMS):
            old=1 if index==0 else index+2
            replies.extend([
                dict(tool='record_repair_plan',args=dict(cause='The isolated assertion still fails its value contract',
                    strategy=strategy,evidence=[dict(path='app.py',line=1)],expected_result='The unchanged assertion and regression should pass',
                    differs_from='' if not index else 'The preceding source-bound mechanism did not satisfy the unchanged assertion')),
                dict(tool='apply_patch',args=dict(edits=[dict(path='app.py',find='value='+str(old),replace='value='+str(index+3))]))])
        model=Mock(side_effect=[('scripted:fixture',json.dumps(dict(reason='Controlled cap fixture, not model intelligence',**reply))) for reply in replies])
        result=agent.run_repair('Repair the unchanged value assertion',model,'fixture')
        self.assertEqual(result['stop_reason'],'strategy_limit')
        self.assertEqual(result['status'],'failed');self.assertEqual(model.call_count,10)
        self.assertEqual(result['strategy_budget']['used'],5)
        self.assertEqual(agent.session.current()['app.py'],b'value=7\n')
        self.assertEqual(len(agent.state['repair_plans']),5)
        self.assertTrue(all(p['evidence'] and isinstance(p['revision'],str) for p in agent.state['repair_plans']))
        self.assertEqual(agent.state['repair_plans'][0]['revision'],'','Empty fingerprint identifies the observed unchanged base')
        self.assertTrue(all(len(p['revision'])==64 for p in agent.state['repair_plans'][1:]))
        self.assertEqual(agent._record_repair_plan('A sixth diagnosis is not admitted','A sixth mechanism must not execute',
            [dict(path='app.py',line=1)],'Original unchanged suite passes','Earlier hypotheses failed')['budget'],'repair_strategies')

    def test_unplanned_first_repair_counts_and_rejected_edits_do_not(self):
        agent=sandbox_repair_controller.SandboxRepairController(fixture_tree())
        agent.state={'failure_family':'same test'}
        self.assertEqual(agent._planned_patch([dict(path='app.py',find='missing',replace='value=3')])['status'],'invalid')
        self.assertEqual(repair_strategy.usage(agent.state)['used'],0)
        self.assertEqual(agent._planned_patch([dict(path='app.py',find='value=1',replace='value=3')])['status'],'applied')
        self.assertEqual(repair_strategy.usage(agent.state)['used'],1)
        self.assertEqual(agent.state['unplanned_repairs']['same test'],1)

    def test_category_allowance_and_unknown_legacy_history_are_explicit(self):
        state={'failure_family':'first','repair_plans':[dict(family='first') for _ in range(5)],
               'attempts':[dict(why_different='Legacy candidate',repair_plan=None)]}
        self.assertEqual(repair_strategy.exhausted(state)['remaining'],0)
        self.assertTrue(repair_strategy.usage(state)['legacy_unattributed'])
        state['failure_family']='second'
        self.assertIsNone(repair_strategy.exhausted(state),'Another failing test is a different bounded family')
        state['unplanned_repairs']={'second':-1}
        blocked=repair_strategy.exhausted(state)
        self.assertTrue(blocked['invalid_counter'],'Malformed saved counter fails closed')
        self.assertIsNone(blocked['used'],'A corrupted count is unknown; never invent five used strategies')
        self.assertEqual(blocked['reason'],'strategy_state_invalid')

    def test_provider_wait_and_journal_restart_do_not_consume_a_strategy(self):
        world=GitHub();journal=world.journal();journal.checkpoint('a'*40)
        first=sandbox_repair_controller.SandboxRepairController(authorized_session(),journal)
        with self.assertRaises(ProviderRoutesUnavailable):
            first.run_repair('Fix value while preserving tests',Mock(side_effect=ProviderRoutesUnavailable('429 capacity wait',retry_at=world.now+60)),'fixture')
        saved=execution.pending(world.journal())['controller']
        self.assertEqual(repair_strategy.usage(saved)['used'],0)
        spent=saved['actions'];self.assertEqual(spent,1,'Real request remains charged independently')
        second=sandbox_repair_controller.SandboxRepairController(authorized_session(),world.journal())
        model=Mock(return_value=('scripted',json.dumps(dict(tool='apply_patch',reason='Fix actual source',
            args=dict(edits=[dict(path='app.py',find='value=1',replace='value=2')])))))
        result=second.run_repair('Fix value while preserving tests',model,'fixture')
        self.assertEqual(result['status'],'success',result['summary'])
        self.assertEqual(result['strategy_budget']['used'],1)
        self.assertEqual(second.state['actions'],spent+1)

    def test_explicit_fix_rechecks_but_cannot_reset_an_exhausted_allowance(self):
        world=GitHub();journal=world.journal();journal.checkpoint('a'*40)
        first=sandbox_repair_controller.SandboxRepairController(authorized_session(),journal)
        def exhaust(*args,**kwargs):
            family=first.state['failure_family']
            first.state['unplanned_repairs']={family:5};first.execution._save()
            return 'scripted',json.dumps(dict(tool='read_file',args={'path':'app.py'},reason='Read retained source before stopping'))
        result=first.run_repair('Fix unchanged value test',exhaust,'fixture')
        self.assertEqual(result['stop_reason'],'strategy_limit')
        retained=copy.deepcopy(execution.pending(world.journal())['controller'])
        second=sandbox_repair_controller.SandboxRepairController(authorized_session(),world.journal())
        with patch.dict('os.environ',{'INPUT_ACTION':'fix'}):
            result=second.run_repair('Fix unchanged value test',Mock(side_effect=AssertionError('No extra model request after exhausted recheck')),'fixture')
        self.assertEqual(result['stop_reason'],'strategy_limit')
        self.assertEqual(second.state['unplanned_repairs'],retained['unplanned_repairs'])
        self.assertEqual(second.state['actions'],retained['actions'])

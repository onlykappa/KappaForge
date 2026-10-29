"""Distinct, evidence-backed repair mechanisms and recurrence across changed errors."""
import json
import unittest
from unittest.mock import Mock

from engine import repair_strategy, sandbox, sandbox_repair_controller as controller
from tests.test_sandbox_repair_controller import FakeDocker, fixture_tree


class NamedFailureDocker(FakeDocker):
    def call(self, args, **kwargs):
        result = super().call(args, **kwargs)
        if args[:1] == ['run'] and result.returncode != 0:
            return sandbox.Exec(1, 'ERROR: test_value (tests.test_app.ValueTests)\n'
                'Traceback (most recent call last):\n  File "app.py", line 1, in setup\n'
                'AttributeError: broken fixture\nRan 1 test in 0.001s\nFAILED (errors=1)\n', '')
        return result


class RepairStrategyTests(unittest.TestCase):
    def test_different_mechanism_can_overcome_the_same_error_after_a_failed_plan(self):
        work = fixture_tree(NamedFailureDocker())
        agent = controller.SandboxRepairController(work)
        replies = [
            dict(tool='record_repair_plan', args=dict(cause='Value initialization disagrees with expected contract',
                strategy='Adjust the default initialization to three', evidence=[dict(path='app.py', line=1)],
                expected_result='The original value assertion should pass')),
            dict(tool='apply_patch', args=dict(edits=[dict(path='app.py', find='value=1', replace='value=3')])),
            dict(tool='record_repair_plan', args=dict(cause='The assertion requires exactly two rather than another positive value',
                strategy='Implement the exact public value contract rather than an estimated default',
                evidence=[dict(path='app.py', line=1)], expected_result='The unchanged value assertion and full suite pass',
                differs_from='The previous guessed default still failed; implement the actual contract')),
            dict(tool='apply_patch', args=dict(edits=[dict(path='app.py', find='value=3', replace='value=2')]))]
        prompts = []
        def model(_key, prompt, **kw):
            prompts.append(prompt)
            self.assertTrue(replies, 'unexpected extra model call')
            return 'scripted', json.dumps(dict(reason='Investigate and fix the same authorized requirement', **replies.pop(0)))
        result = agent.run_repair('Fix value without weakening its test', model, 'fixture')
        self.assertEqual(result['status'], 'success', result['summary'])
        self.assertEqual(len(prompts), 4)
        self.assertIn('Adjust the default initialization', prompts[2])
        self.assertEqual([a['status'] for a in agent.attempts], ['failed', 'passed'])
        self.assertNotEqual(agent.attempts[0]['repair_plan']['strategy'], agent.attempts[1]['repair_plan']['strategy'])
        self.assertEqual(len(agent.state['repair_plans']), 2)

    def test_repeated_named_test_needs_a_new_plan_even_when_exception_details_change(self):
        first = [dict(status='failed', argv=['python', '-m', 'unittest'],
                      first_failure='ERROR: test_context (tests.test_reviews.T)\nAttributeError: missing project')]
        second = [dict(first[0], first_failure='ERROR: test_context (tests.test_reviews.T)\nAttributeError: missing events')]
        family = repair_strategy.family(first)
        self.assertEqual(family, repair_strategy.family(second))
        agent = controller.SandboxRepairController(fixture_tree())
        agent.state = dict(failure_family=family, failure_families={family: 2})
        before = agent.session.current()
        result = agent._planned_patch([dict(path='app.py', find='value=1', replace='value=3')])
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(agent.session.current(), before)

    def test_plan_needs_observed_current_source_and_cannot_relabel_a_failed_strategy(self):
        agent = controller.SandboxRepairController(fixture_tree())
        agent.state = dict(failure_family='same failing test')
        plan = dict(cause='The test state is initialized on the wrong object', strategy='Install the real task context before use',
                    evidence=[dict(path='app.py', line=1)], expected_result='The original state assertion now passes')
        self.assertEqual(agent._record_repair_plan(**plan)['status'], 'invalid', 'invented citations are refused')
        agent._explore('read_file', path='app.py', start_line=1, end_line=2)
        self.assertEqual(agent._record_repair_plan(**plan)['status'], 'planned')
        self.assertEqual(agent._planned_patch([dict(path='app.py', find='value=1', replace='value=3')])['status'], 'applied')
        self.assertEqual(agent._record_repair_plan(**dict(plan, differs_from='A new label is not a different mechanism'))['status'], 'invalid')
        agent._explore('read_file', path='app.py', start_line=1, end_line=2)
        self.assertEqual(agent._record_repair_plan(**dict(plan, strategy='Install the real task context before use! 2',
            differs_from='A new label is not a different mechanism'))['status'], 'invalid')
        self.assertEqual(agent._planned_patch([dict(path='app.py', find='value=3', replace='value=2')])['status'], 'invalid')

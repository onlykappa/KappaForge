"""Task330 command receipts must include its exact module test as well as full regression."""
from contextlib import ExitStack
import unittest
from engine import command_contract, sandbox, sandbox_repair_controller, task_goal
from tests.test_sandbox_repair_controller import fixture_tree

class OwnerValidationCommands(unittest.TestCase):
    def test_task330_exact_command_is_kept_without_replacing_mandatory_suite(self):
        request='Create direct tests. Run `python -m unittest tests.test_budget_ledger` and report exact counts.'
        self.assertEqual(command_contract.requested_tests(request),[['python','-m','unittest','tests.test_budget_ledger']])
        session=fixture_tree();session.required_commands=command_contract.requested_tests(request)
        commands=session.test_commands()
        self.assertEqual(commands[0][1],['python','-B','-m','unittest','discover','-s','tests'])
        self.assertEqual(commands[-1],('owner validation',['python','-m','unittest','tests.test_budget_ledger']))

    def test_report_or_provider_text_cannot_inject_a_command_contract(self):
        self.assertEqual(command_contract.requested_tests('Example: Run `python -m unittest` when appropriate.'),[])
        self.assertEqual(command_contract.requested_tests('Background. Run `python -m unittest`.'),[])
        for text in ['Run `bash -c echo`.', 'Run `python -c dangerous()`.', 'Run `curl https://example.test`.' ]:
            with self.assertRaises(ValueError):command_contract.requested_tests(text)
        session=fixture_tree();session.required_commands=[['python','-m','unittest',';','curl']]
        with self.assertRaises(sandbox.CommandRejected):session.test_commands()

    def test_real_controller_runs_requested_command_and_fresh_regression(self):
        session=fixture_tree();session.apply({'app.py':'value=2\n'})
        goal=task_goal.from_request('Run `python -m unittest tests.test_app` and report exact counts.')
        token=task_goal.CURRENT.set(goal)
        try:
            result=sandbox_repair_controller.SandboxRepairController(session).run_repair(goal.original,
                lambda *a,**kw: self.fail('Passing candidate needs no model call'),'fixture')
        finally:task_goal.CURRENT.reset(token)
        self.assertEqual(result['status'],'success',result.get('summary'))
        observed=[r.argv for r in session.results]
        self.assertEqual(observed.count(['python','-m','unittest','tests.test_app']),2)
        self.assertEqual(observed.count(['python','-B','-m','unittest','discover','-s','tests']),2)

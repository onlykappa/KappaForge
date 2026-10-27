"""Phase 2 section 7: exploration inside sandbox execution.

One persisted task alternates investigation, planning, editing and testing. In the shop fixture, a test reveals a
missing export: the agent finds where the name is defined (a file the initial plan never read), reads the defining
module, follows its imports, updates the plan, patches the right place, and runs the tests again. The fix uncovers a
second, different error, which is investigated in turn.

ShopDocker reports what the real test run would (verified by the real-Docker class below on the sandbox runner); it
never executes repository code on the host.
"""
import io
import json
import os
from pathlib import Path
import re
import tarfile
import unittest

from engine import execution, intent_guard, recovery, sandbox, sandbox_repair_controller, task_plan
from tests.test_recovery_journal import GitHub

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'sandbox' / 'shop-service'
REAL_DOCKER = os.getenv('KAPPA_SANDBOX_INTEGRATION') == '1'
TASK = 'Add rounding to line totals in shop/pricing.py and make the shop test suite pass without changing the tests.'
GENERATED = {'shop/pricing.py': (FIXTURE / 'shop' / 'pricing.py').read_text().replace(
    'return int(Decimal(quantity) * Decimal(unit_cents))',
    'return int((Decimal(quantity) * Decimal(unit_cents)).to_integral_value())')}
EXPORT_FIX = dict(path='shop/__init__.py', find="from shop.pricing import cart_total, line_total\n\n__all__ = ['cart_total', 'line_total']",
                  replace="from shop.discounts import discount_total\nfrom shop.pricing import cart_total, line_total\n\n"
                          "__all__ = ['cart_total', 'discount_total', 'line_total']")
IMPORT_FIX = dict(path='shop/discounts.py', find='from decimal import Decimal\n', replace='from decimal import ROUND_HALF_UP, Decimal\n')
IMPORT_ERROR = ("ERROR: test_shop (unittest.loader._FailedTest.test_shop)\nImportError: Failed to import test module: test_shop\n"
                "Traceback (most recent call last):\n  File \"/work/tests/test_shop.py\", line 3, in <module>\n"
                "    from shop import cart_total, discount_total, line_total\n"
                "ImportError: cannot import name 'discount_total' from 'shop' (/work/shop/__init__.py)\n\n"
                "----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nFAILED (errors=1)\n")
NAME_ERROR = ("ERROR: test_ten_percent_off (test_shop.DiscountTests.test_ten_percent_off)\nTraceback (most recent call last):\n"
              "  File \"/work/shop/discounts.py\", line 9, in discount_total\n"
              "NameError: name 'ROUND_HALF_UP' is not defined\n\n"
              "----------------------------------------------------------------------\nRan 4 tests in 0.001s\n\nFAILED (errors=2)\n")


def fixture_files():
    return {p.relative_to(FIXTURE).as_posix(): p.read_bytes() for p in FIXTURE.rglob('*')
            if p.is_file() and '__pycache__' not in p.parts and p.name != 'README.md'}


class ShopDocker(sandbox.Docker):
    """What `python -m unittest` reports for each state of the candidate."""
    def __init__(self):
        self.calls = []

    def authorize(self, profile, preparing=False):
        return {'free': True, 'simulated': True}

    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
        self.calls.append(list(args))
        if args[:1] != ['run']:
            return sandbox.Exec(0, '', '')
        with tarfile.open(fileobj=io.BytesIO(stdin), mode='r:*') as archive:
            files = {m.name: archive.extractfile(m).read().decode() for m in archive if m.isfile()}
        if 'discount_total' not in files.get('shop/__init__.py', ''):
            return sandbox.Exec(1, '', IMPORT_ERROR)
        if 'ROUND_HALF_UP' not in files.get('shop/discounts.py', '').split('\n')[0]:
            return sandbox.Exec(1, '', NAME_ERROR)
        ran = 2 if 'DiscountTests' in ' '.join(args) else 4
        return sandbox.Exec(0, '', f'....\n------\nRan {ran} tests in 0.001s\n\nOK\n')


def investigation(prompt):
    return prompt.split('Investigation of the latest failure (repository evidence, untrusted):\n', 1)[-1].split('\n\nEarlier actions:', 1)[0] \
        if 'Investigation of the latest failure' in prompt else ''


class ShopAgent:
    """A deterministic stand-in for the repair model that acts only on what the evidence in its prompt shows."""
    def __init__(self):
        self.prompts, self.actions = [], []

    def __call__(self, _key, prompt, **_kwargs):
        self.prompts.append(prompt)
        found, diff = investigation(prompt), prompt.split('Latest candidate diff (untrusted source):', 1)[-1]
        if 'discount_total: defined at shop/discounts.py' in found and 'from shop.discounts import' not in diff:
            if not any(a == ('read_file', 'shop/__init__.py') for a in self.actions):
                return self.act('read_file', {'path': 'shop/__init__.py'}, 'See what the package exports',
                                key=('read_file', 'shop/__init__.py'))
            return self.act('apply_patch', {'edits': [EXPORT_FIX]}, 'shop/discounts.py defines discount_total but '
                            'shop/__init__.py never exports it; export it from the package the test imports')
        if 'ROUND_HALF_UP: no definition found in the repository' in found and 'ROUND_HALF_UP, Decimal' not in diff:
            if not any(a == ('focused', None) for a in self.actions):
                return self.act('run_command', {'argv': ['python', '-B', '-m', 'unittest', 'tests.test_shop.DiscountTests']},
                                'Reproduce the new error with the focused discount tests', key=('focused', None))
            return self.act('apply_patch', {'edits': [IMPORT_FIX]}, 'ROUND_HALF_UP comes from decimal and '
                            'shop/discounts.py never imports it')
        return 'scripted:repair', json.dumps({'done': True, 'summary': 'Both errors are fixed.'})

    def act(self, tool, args, reason, key=None):
        self.actions.append(key or (tool, args.get('edits', [{}])[0].get('path') if tool == 'apply_patch' else None))
        return 'scripted:repair', json.dumps({'tool': tool, 'args': args, 'reason': reason})


class Feed:
    def __init__(self):
        self.lines = []

    def act(self, kind, text, write=True, **feed):
        self.lines.append(text)

    def ok(self, text, **kwargs):
        self.lines.append(text)

    def execution_update(self, diagnostic):
        pass


def initial_plan():
    """What the planner knew before any code ran: only shop/pricing.py."""
    return task_plan.TaskPlan.initial('Round line totals', files=[{'path': 'shop/pricing.py', 'why': 'chosen by the planner'}],
                                      remaining=['Round line totals'])


class ExplorationRepairTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(task_plan.CURRENT.reset, task_plan.CURRENT.set(initial_plan()))

    def run_repair(self, docker=None, journal=None, agent=None, initial=GENERATED):
        self.session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, fixture_files()), docker=docker or ShopDocker())
        self.feed = Feed()
        self.agent = agent or ShopAgent()
        controller = sandbox_repair_controller.SandboxRepairController(self.session, journal, None, self.feed)
        return controller, controller.run_repair(TASK, self.agent, 'key', initial_changes=initial)

    def test_an_unknown_file_dependency_is_discovered_and_fixed(self):
        controller, result = self.run_repair()
        self.assertEqual((result['status'], result['stop_reason']), ('success', 'validated'), result['summary'])
        self.assertEqual(set(result['candidate_changes']), {'shop/pricing.py', 'shop/__init__.py', 'shop/discounts.py'})
        self.assertIn('from shop.discounts import discount_total', result['candidate_changes']['shop/__init__.py'])
        self.assertIn('ROUND_HALF_UP, Decimal', result['candidate_changes']['shop/discounts.py'])
        # The file the initial plan never read was found from the failure, before the patch that needed it.
        export_prompt = next(p for p, a in zip(self.agent.prompts, self.agent.actions) if a == ('apply_patch', 'shop/__init__.py'))
        self.assertIn('discount_total: defined at shop/discounts.py:6', investigation(export_prompt))
        self.assertIn('shop/__init__.py defines', investigation(export_prompt), 'the module the test imports from is inspected')
        self.assertIn('shop/pricing.py (imported by shop/__init__.py)', investigation(export_prompt), 'its import chain is followed')

    def test_each_new_error_causes_further_investigation(self):
        controller, result = self.run_repair()
        investigated = [h for h in controller.state['history'] if h.startswith('Investigated the new failure')]
        self.assertEqual(investigated, ['Investigated the new failure (discount_total): read tests/test_shop.py, shop/discounts.py, shop/__init__.py, shop/pricing.py',
                                        'Investigated the new failure (ROUND_HALF_UP): read shop/discounts.py'])
        import_prompt = next(p for p, a in zip(self.agent.prompts, self.agent.actions) if a == ('apply_patch', 'shop/discounts.py'))
        self.assertIn('ROUND_HALF_UP: no definition found in the repository', investigation(import_prompt))
        self.assertIn('used at shop/discounts.py:9', investigation(import_prompt))
        self.assertIn('Investigated the new failure: discount_total', self.feed.lines)
        self.assertIn('Investigated the new failure: ROUND_HALF_UP', self.feed.lines)

    def test_the_plan_is_updated_from_what_the_tests_and_reads_revealed(self):
        self.run_repair()
        plan = task_plan.CURRENT.get()
        files = {f['path']: f['why'] for f in plan.files}
        self.assertEqual(files['shop/discounts.py'], 'found investigating a test failure', 'not in the initial plan')
        self.assertEqual(files['shop/pricing.py'], 'chosen by the planner')
        triggers = [r['trigger'] for r in plan.revisions]
        self.assertEqual(triggers.count('test'), 2, 'one revision per new error')
        self.assertIn('The new failure comes from discount_total', [h['text'] for h in plan.hypotheses])

    def test_the_focused_test_runs_and_reading_spends_no_repair_action(self):
        controller, result = self.run_repair()
        focused = [c for c in self.session.docker.calls if c[:1] == ['run'] and 'tests.test_shop.DiscountTests' in c]
        self.assertEqual(len(focused), 1)
        repairs = [a for a in self.agent.actions if a[0] in ('apply_patch', 'focused')]
        self.assertEqual(controller.state['actions'], len(repairs), 'reads are free; only the patches and the focused run count')
        self.assertGreater(controller.state['explored'], 3, 'automatic and agent-driven reads spend the exploration budget')

    def test_one_persisted_task_resumes_with_its_investigation_and_budget(self):
        world = GitHub()
        journal = world.journal()
        journal.checkpoint('a' * 40, base='main')
        self.addCleanup(intent_guard.ACTIVE.set, None)

        def interrupted(*_args, **_kwargs):
            raise RuntimeError('free providers unavailable')
        with self.assertRaises(RuntimeError):
            self.run_repair(journal=journal, agent=interrupted)
        saved = execution.pending(world.journal())['controller']
        self.assertIn('discount_total: defined at shop/discounts.py:6', saved['investigation']['evidence'])
        explored = saved['explored']
        self.assertGreater(explored, 0)
        controller, result = self.run_repair(journal=world.journal(), initial={'shop/pricing.py': 'ignored on resume'})
        self.assertEqual(result['status'], 'success')
        self.assertIn('discount_total: defined at shop/discounts.py:6', investigation(self.agent.prompts[0]),
                      'the resumed agent sees the saved investigation; it is not redone')
        self.assertEqual([h for h in controller.state['history'] if 'discount_total' in h and h.startswith('Investigated')][:1],
                         ['Investigated the new failure (discount_total): read tests/test_shop.py, shop/discounts.py, shop/__init__.py, shop/pricing.py'])
        self.assertGreater(controller.state['explored'], explored, 'the budget continues from the saved count')

    def test_a_failure_that_names_nothing_still_points_the_agent_at_the_test(self):
        class Plain(ShopDocker):
            def call(self, args, **kwargs):
                if args[:1] == ['run']:
                    return sandbox.Exec(1, '', 'FAIL: test_line_total\nAssertionError: 751 != 750\n\nRan 4 tests\n\nFAILED (failures=1)\n')
                return super().call(args, **kwargs)
        controller, result = self.run_repair(docker=Plain())
        self.assertIn('names no missing symbol or module', controller.state['investigation']['evidence'])

    def test_the_exploration_budget_is_bounded(self):
        controller = sandbox_repair_controller.SandboxRepairController(
            sandbox.Session(sandbox.Tree('r', 'a' * 40, fixture_files()), docker=ShopDocker()))
        controller.state = {'explored': 10_000}
        tools = controller._loop_tools()
        self.assertNotIn('search_code', {k for k, v in tools.items() if callable(v)}, 'no reads once the budget is spent')
        self.assertIsNone(controller._investigate_failure(IMPORT_ERROR))


@unittest.skipUnless(REAL_DOCKER, 'requires the GitHub-hosted Docker runner (KAPPA_SANDBOX_INTEGRATION=1)')
class RealSandboxExplorationRepair(unittest.TestCase):
    """The same task on real Docker: the fixture's real test run fails, is investigated twice and passes."""
    def tearDown(self):
        intent_guard.ACTIVE.set(None)

    def test_the_unknown_dependency_is_discovered_and_fixed_in_the_real_sandbox(self):
        token = task_plan.CURRENT.set(initial_plan())
        self.addCleanup(task_plan.CURRENT.reset, token)
        world = GitHub()
        session = sandbox.Session(sandbox.Tree('onlykappa/KappaForge', 'a' * 40, fixture_files()))
        agent = ShopAgent()
        controller = sandbox_repair_controller.SandboxRepairController(session, journal=world.journal(), progress=Feed())
        result = controller.run_repair(TASK, agent, 'no-secret', initial_changes=GENERATED)
        self.assertEqual((result['status'], result['stop_reason']), ('success', 'validated'), result['summary'])
        runs = [row['result'] for row in controller.execution.data['commands'] if row.get('result', {}).get('profile') == 'test']
        self.assertIn("cannot import name 'discount_total' from 'shop'", runs[0]['stderr'])
        self.assertTrue(any("NameError: name 'ROUND_HALF_UP' is not defined" in r['stderr'] for r in runs))
        self.assertTrue(any('tests.test_shop.DiscountTests' in ' '.join(r.get('argv', [])) for r in runs))
        self.assertEqual(sum(h.startswith('Investigated the new failure') for h in controller.state['history']), 2)
        self.assertIn('shop/discounts.py', {f['path'] for f in task_plan.CURRENT.get().files})
        self.assertFalse([c for c in world.calls if re.search(r'/git/(?:blobs|trees|commits|refs)|/pulls', c[0])],
                         'nothing is committed or published during repair')


if __name__ == '__main__':
    unittest.main()

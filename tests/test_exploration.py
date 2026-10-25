"""Phase 2 section 2: the read-only exploration tools, their budgets and the investigation loop.

Started by KappaForge task #269 (the search, read, listing, instructions, many-reads and symbol tests). Its budget and
investigation tests were corrected: a constant clock never spends time, a budget is checked before each call, and
investigate() adds only files the agent actually read."""
import json
import unittest

from engine import exploration, tool_loop
from engine.exploration import Budget, Explorer, Repository, investigate


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class ExplorationToolTests(unittest.TestCase):
    def setUp(self):
        self.sources = {
            'app.py': "from lib.money import total\n\ndef main():\n    print('hello')\n    return total([1, 2])\n",
            'lib/money.py': 'def total(values):\n    return sum(values)\n\n\nclass Ledger:\n    def add(self, value):\n        return value\n',
            'web/utils.js': 'export function add(a, b) { return a + b; }\nexport const ZERO = 0;\n',
            'web/main.js': "import { add } from './utils.js';\nconsole.log(add(1, 2));\n",
            'KAPPA.md': '# Policy\nTest command: python -m unittest\n',
            'AGENTS.md': '# Agents',
            'logo.png': '\0PNG binary',
            'notes.txt': '\n'.join(f'line {n} hello' for n in range(1, 61)),
        }
        self.repo = Repository.from_sources(self.sources)

    def test_search_code_finds_text_pages_results_and_refuses_backtracking_regex(self):
        explorer = Explorer(self.repo)
        found = explorer.call('search_code', query='hello')
        self.assertEqual(found['status'], 'ok')
        self.assertEqual((found['total'], found['pages'], len(found['matches'])), (61, 4, 20))
        self.assertEqual(found['matches'][0], {'path': 'app.py', 'line': 4, 'text': "print('hello')"})
        self.assertEqual(explorer.call('search_code', query='hello', page=4)['matches'][-1]['line'], 60)
        self.assertEqual(explorer.call('search_code', query='hello', path_prefix='app')['total'], 1)
        self.assertEqual(explorer.call('search_code', query=r'def \w+\(', regex=True)['total'], 3)
        for pattern in ('(a+)+b', r'(\w*)*x', r'(a)\1'):
            with self.subTest(pattern=pattern):
                self.assertEqual(explorer.call('search_code', query=pattern, regex=True)['status'], 'invalid')
        self.assertNotIn('logo.png', [m['path'] for m in explorer.call('search_code', query='PNG')['matches']])

    def test_read_file_returns_ranges_and_refuses_unsafe_or_unreadable_paths(self):
        explorer = Explorer(self.repo)
        part = explorer.call('read_file', path='notes.txt', start_line=10, end_line=12)
        self.assertEqual((part['start_line'], part['end_line'], part['total_lines'], part['more']), (10, 12, 60, True))
        self.assertEqual(part['text'], 'line 10 hello\nline 11 hello\nline 12 hello')
        whole = explorer.call('read_file', path='app.py')
        self.assertEqual((whole['end_line'], whole['more']), (5, False))
        for path in ('../etc/passwd', '/etc/passwd', 'missing.py', 'logo.png', '.git/config', 'web/../app.py'):
            with self.subTest(path=path):
                self.assertEqual(explorer.call('read_file', path=path)['status'], 'invalid')
        big = Repository({'huge.py': exploration.MAX_FILE_CHARS + 1}, lambda p: 'x')
        self.assertIn('too large', Explorer(big).call('read_file', path='huge.py')['error'])
        self.assertEqual(explorer.evidence()['read'], {'notes.txt': [(10, 12)], 'app.py': [(1, 5)]})

    def test_list_directory_groups_folders_and_files(self):
        explorer = Explorer(self.repo)
        root = explorer.call('list_directory')
        names = [(e['name'], e['type']) for e in root['entries']]
        self.assertEqual(names[:2], [('lib', 'directory'), ('web', 'directory')])
        self.assertIn(('app.py', 'file'), names)
        self.assertEqual([e['name'] for e in explorer.call('list_directory', path='web')['entries']], ['main.js', 'utils.js'])
        self.assertEqual(explorer.call('list_directory', path='nowhere')['status'], 'invalid')
        self.assertEqual(explorer.call('list_directory', path='../x')['status'], 'invalid')

    def test_find_references_separates_definitions_from_uses_in_python_and_javascript(self):
        explorer = Explorer(self.repo)
        total = explorer.call('find_references', symbol='total')
        self.assertEqual([(d['path'], d['line']) for d in total['definitions']], [('lib/money.py', 1)])
        self.assertEqual(sorted((r['path'], r['line']) for r in total['references']), [('app.py', 1), ('app.py', 5)])
        add = explorer.call('find_references', symbol='add')
        self.assertIn(('web/utils.js', 1), [(d['path'], d['line']) for d in add['definitions']])
        self.assertIn(('web/main.js', 1), [(r['path'], r['line']) for r in add['references']])
        self.assertEqual(explorer.call('find_references', symbol='not an identifier')['status'], 'invalid')

    def test_inspect_symbols_lists_definitions_exports_and_imports(self):
        explorer = Explorer(self.repo)
        money = explorer.call('inspect_symbols', path='lib/money.py')
        self.assertEqual([(s['name'], s['line'], s['member']) for s in money['symbols']],
                         [('total', 1, False), ('Ledger', 5, False), ('add', 6, True)])
        utils = explorer.call('inspect_symbols', path='web/utils.js')
        self.assertEqual(utils['exports'], ['ZERO', 'add'])
        self.assertEqual(explorer.call('inspect_symbols', path='web/main.js')['imports'], ['web/utils.js'])
        self.assertEqual(explorer.call('inspect_symbols', path='app.py')['imports'], ['lib/money.py'])

    def test_read_project_instructions_returns_the_trusted_instruction_files(self):
        found = Explorer(self.repo).call('read_project_instructions')
        self.assertEqual([i['path'] for i in found['instructions']], ['KAPPA.md', 'AGENTS.md'])
        self.assertIn('never override', found['note'])

    def test_more_than_eight_follow_up_reads_fit_the_configured_budget(self):
        budget = Budget.configured()
        self.assertGreater(budget.calls, 8)
        explorer = Explorer(self.repo, budget)
        for n in range(1, 13):
            read = explorer.call('read_file', path='notes.txt', start_line=n * 4, end_line=n * 4 + 3)
            self.assertEqual(read['status'], 'ok', n)
        self.assertEqual(explorer.calls, 12)

    def test_unknown_tools_and_bad_arguments_are_reported_not_raised(self):
        explorer = Explorer(self.repo)
        self.assertEqual(explorer.call('write_file', path='x')['status'], 'invalid')
        self.assertEqual(explorer.call('read_file')['status'], 'invalid')
        self.assertEqual(explorer.call('read_file', path='app.py', start_line='x')['status'], 'invalid')


class BudgetTests(unittest.TestCase):
    """A budget is checked before each call, so the call that crosses a limit completes and the next one stops."""
    def setUp(self):
        self.repo = Repository.from_sources({'a.py': 'x = 1\n' * 50})

    def spend_until_exhausted(self, explorer, limit=20):
        for _ in range(limit):
            result = explorer.call('read_file', path='a.py')
            if result['status'] == 'budget_exhausted':
                return result
        self.fail('budget never ran out')

    def test_each_budget_runs_out_and_says_which(self):
        clock = Clock()
        cases = {
            'calls': (Budget(calls=2), None),
            'seconds': (Budget(seconds=5), clock),
            'output_chars': (Budget(output_chars=500), None),
            'context_chars': (Budget(context_chars=500), None),
        }
        for name, (budget, tick) in cases.items():
            with self.subTest(budget=name):
                explorer = Explorer(self.repo, budget, clock=tick or Clock())
                if tick:
                    explorer.call('read_file', path='a.py')
                    clock.now += 6
                stop = self.spend_until_exhausted(explorer)
                self.assertEqual((stop['budget'], explorer.exhausted), (name, name))
                calls = explorer.calls
                self.assertEqual(explorer.call('search_code', query='x')['status'], 'budget_exhausted')
                self.assertEqual(explorer.calls, calls, 'no further tool runs once a budget is spent')

    def test_the_tool_loop_stops_safely_when_a_budget_is_spent(self):
        explorer = Explorer(self.repo, Budget(calls=3))
        reply = json.dumps({'tool': 'read_file', 'args': {'path': 'a.py', 'start_line': 1}, 'reason': 'look'})
        asked = []
        def model(*_args, **_kwargs):
            asked.append(1)
            return 'scripted', reply.replace('"start_line": 1', '"start_line": %d' % len(asked))
        out = tool_loop.run_tool_loop(model, 'k', 'task', explorer.tools(), max_steps=50)
        self.assertEqual(out['stop_reason'], 'budget_exhausted')
        self.assertEqual(len(asked), 4, 'three reads, then the call that found the budget spent; no more model calls')

    def test_configured_budgets_are_validated(self):
        self.assertEqual(Budget.configured(calls=12).calls, 12)
        for bad in ({'calls': 0}, {'seconds': 99999}, {'output_chars': -1}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                Budget.configured(**bad)


class InvestigationTests(unittest.TestCase):
    def test_a_file_absent_from_the_initial_plan_is_discovered_read_and_added(self):
        repo = Repository.from_sources({
            'app.py': 'from pricing import rate\n\ndef price(x):\n    return x * rate()\n',
            'pricing.py': 'def rate():\n    return 0.2  # should be 0.25\n',
            'unrelated.py': 'VALUE = 1\n'})
        script = iter([
            {'tool': 'find_references', 'args': {'symbol': 'rate'}, 'reason': 'Where is rate defined?'},
            {'tool': 'read_file', 'args': {'path': 'pricing.py', 'start_line': 1, 'end_line': 2}, 'reason': 'Read its definition'},
            {'done': True, 'summary': 'rate() is in pricing.py lines 1-2'}])
        lines = []
        added, evidence, summary = investigate(
            lambda *a, **k: ('scripted', json.dumps(next(script))), 'k', 'Fix the price rate',
            repo, {'app.py': repo.text('app.py')}, ['Where is rate() defined?'],
            report=lambda kind, text, **feed: lines.append((kind, text, feed)))
        self.assertEqual(list(added), ['pricing.py'], 'only the file it actually read, not unrelated or already-known ones')
        self.assertEqual(evidence['read'], {'pricing.py': [(1, 2)]})
        self.assertEqual((evidence['stop'], summary), ('done', 'rate() is in pricing.py lines 1-2'))
        self.assertIn(('plan', 'Where is rate defined?', {'say': True}), lines)
        self.assertIn('Read pricing.py lines 1-2', [text for _k, text, _f in lines])

    def test_claiming_a_file_without_reading_it_adds_nothing(self):
        repo = Repository.from_sources({'app.py': 'x = 1\n', 'utils.js': 'export const y = 2;\n'})
        model = lambda *a, **k: ('scripted', json.dumps({'done': True, 'summary': 'found it', 'added': ['utils.js']}))
        added, evidence, _ = investigate(model, 'k', 'task', repo, {'app.py': 'x = 1\n'}, ['find utils.js'])
        self.assertEqual((added, evidence['read']), ({}, {}))

    def test_added_files_respect_the_context_limit(self):
        repo = Repository.from_sources({'a.py': 'a' * 300, 'b.py': 'b' * 300})
        script = iter([{'tool': 'read_file', 'args': {'path': 'a.py'}, 'reason': 'r'},
                       {'tool': 'read_file', 'args': {'path': 'b.py'}, 'reason': 'r'}, {'done': True, 'summary': 's'}])
        added, _, _ = investigate(lambda *a, **k: ('s', json.dumps(next(script))), 'k', 't', repo, {}, ['q'], add_limit=400)
        self.assertEqual(list(added), ['a.py'])

    def test_the_task_context_is_cleared_when_a_run_ends(self):
        @exploration.scoped
        def run():
            exploration.CURRENT.set('repository')
            exploration.REQUEST.set(('question',))
            raise RuntimeError('task failed')
        with self.assertRaises(RuntimeError):
            run()
        self.assertEqual((exploration.CURRENT.get(), exploration.REQUEST.get()), (None, ()))


if __name__ == '__main__':
    unittest.main()

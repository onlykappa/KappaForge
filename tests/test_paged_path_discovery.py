"""KF-AUDIT-014: discover omitted paths with real production tools, no provider calls."""
import ast
from dataclasses import asdict
from types import SimpleNamespace
import json
import unittest
from unittest.mock import patch
from engine import developer, exploration, budget_ledger


class PagedPathDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.token = exploration.REQUEST.set(())

    def tearDown(self):
        exploration.REQUEST.reset(self.token)

    def test_inventory_pages_all_paths_without_reading_source_or_increasing_limits(self):
        files = {f'code/item{i:04}.py': 12 for i in range(1001)}
        repo = exploration.Repository(files, lambda _: self.fail('Listing inventory must not download source'))
        explorer = exploration.Explorer(repo)
        page = explorer.call('find_paths', page=51)
        self.assertEqual(page['paths'], [{'path':'code/item1000.py','bytes':12}])
        self.assertEqual((page['total'],page['pages'],page['repository_paths']),(1001,51,1001))
        self.assertIs(page['content_read'], False)
        self.assertIs(page['authority'], False)
        self.assertEqual(explorer.evidence()['read'], {})
        self.assertEqual(explorer.context, 0)
        result = explorer.call('find_paths', query='ITEM1000', path_prefix='code/')
        self.assertEqual(result['paths'][0]['path'], 'code/item1000.py')
        self.assertEqual(repo._text, {})

    def test_invalid_paths_arguments_and_exhausted_budget_never_read_or_escape(self):
        explorer = exploration.Explorer(exploration.Repository({'safe.py':12},lambda _:self.fail('No source read')),
                                        exploration.Budget(calls=10))
        for args in ({'query':[]},{'query':'x'*201},{'path_prefix':'../outside'}, {'path_prefix':'/etc'},
                     {'page':True},{'page':0},{'query':'bad\0query'}):
            self.assertEqual(explorer.call('find_paths', **args)['status'],'invalid')
        limited = exploration.Explorer(explorer.repo, exploration.Budget(calls=1))
        self.assertEqual(limited.call('find_paths')['status'],'ok')
        self.assertEqual(limited.call('find_paths')['status'],'budget_exhausted')

    def test_planner_can_request_investigation_without_guessing_an_unlisted_file(self):
        files = {f'code/item{i:04}.py':12 for i in range(1000)}
        answer = json.dumps({'read':[],'investigate':['Locate the settlement ledger and its dependencies.']})
        with patch.object(developer,'run_model',return_value=('scripted',answer)) as model:
            paths, stages, design = developer.select_files('fixture','Find settlement logic',files,with_stages=True)
        self.assertEqual(paths,[]);self.assertEqual(stages,[]);self.assertEqual(design,'')
        self.assertEqual(model.call_count,1,'A valid investigation must not trigger another blind planning attempt')
        prompt = model.call_args.args[1]
        self.assertIn('60 paths shown out of 1000',prompt)
        self.assertIn('940 omitted',prompt)
        self.assertTrue(exploration.REQUEST.get())

    def test_path_inventory_calls_cannot_regain_spent_budget_after_restart(self):
        journal=SimpleNamespace(state={},persist=lambda:None)
        repo=exploration.Repository({'safe.py':12},lambda _:self.fail('No source read'))
        first=exploration.Explorer(repo,exploration.Budget(calls=1),ledger=budget_ledger.Ledger(journal,'investigation'))
        self.assertEqual(first.call('find_paths')['status'],'ok')
        saved=json.loads(json.dumps(journal.state))
        restored=SimpleNamespace(state=saved,persist=lambda:None)
        second=exploration.Explorer(repo,exploration.Budget(calls=1),ledger=budget_ledger.Ledger(restored,'investigation'))
        self.assertEqual(second.call('find_paths')['status'],'budget_exhausted')
        self.assertEqual(second.calls,0)

    def test_actual_investigation_discovers_target_and_unplanned_dependency_beyond_path700(self):
        texts = {f'code/item{i:04}.py':'# unrelated\n' for i in range(800)}
        texts.update({'z_payment/ledger.py':'from z_payment.rules import RATE\n\ndef total(value):\n    return value * RATE\n',
                      'z_payment/rules.py':'RATE = 0.25\n'})
        reads=[]
        def read(path):
            reads.append(path);return texts[path]
        repo = exploration.Repository({p:len(t) for p,t in texts.items()},read)
        self.assertGreater(sorted(repo.files).index('z_payment/ledger.py'),700)
        calls=[]
        def model(_key,prompt,**_options):
            turn=len(calls);calls.append(prompt)
            if turn==0:
                reply={'tool':'find_paths','args':{'query':'ledger'},'reason':'Find omitted implementation paths'}
            elif turn==1:
                observed=json.loads(prompt.rsplit('\nResult: ',1)[1])
                reply={'tool':'read_file','args':{'path':observed['paths'][0]['path']},'reason':'Read the discovered implementation'}
            elif turn==2:
                observed=json.loads(prompt.rsplit('\nResult: ',1)[1])
                module=next(node.module for node in ast.walk(ast.parse(observed['text'])) if isinstance(node,ast.ImportFrom))
                reply={'tool':'read_file','args':{'path':module.replace('.','/')+'.py'},'reason':'Follow the actual unplanned import'}
            else:
                reply={'done':True,'summary':'Read the implementation and actual imported rule; no code executed.'}
            return 'scripted:offline',json.dumps(reply)
        original_budget=asdict(exploration.Budget.configured())
        added,evidence,_summary=exploration.investigate(model,'fixture','Locate settlement ledger behavior',repo,{},
            ['Find the implementation and dependency outside the initial listing.'])
        self.assertEqual(set(added),{'z_payment/ledger.py','z_payment/rules.py'})
        self.assertEqual(reads,['z_payment/ledger.py','z_payment/rules.py'])
        self.assertEqual(evidence['calls'],3)
        self.assertEqual(evidence['stop'],'done')
        self.assertEqual(evidence['budget'],original_budget,'No investigation budget/context cap is raised')
        self.assertEqual(evidence['read']['z_payment/rules.py'],[(1,1)])
        self.assertNotIn('code/item0799.py',calls[0],'The tool loop does not dump the full inventory into context')

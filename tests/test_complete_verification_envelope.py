import json
import unittest
from types import SimpleNamespace
from engine import gateway, projects, recovery, repair_guard, task_goal, task_state


class CompleteEnvelopeTests(unittest.TestCase):
    def test_receipt_and_post_answer_state_fit_without_losing_source_or_scope(self):
        task = ('Do only checkpoint 3.1a: verify main and Phase 1/2 provenance. '
                'Update only docs/audit.md with commit IDs and GitHub links; distinguish inspected evidence from checks run. '
                'Keep the PR a draft. Do not merge, deploy, release, or begin later checkpoints. '
                'Fix only missing commit links and leave other findings for later.')
        goal = task_goal.from_request(task)
        goal.title = 'Phase 3 — job 1: verify main and Phase 1/2 provenance (3.1a only)'
        handle = task_goal.CURRENT.set(goal)
        sha = 'a' * 40
        journal = SimpleNamespace(state=dict(repo='onlykappa/KappaForge', task=282, candidate=sha, files=[],
            budgets=dict(modelCalls=51, edits=7, fixCycles=5), gatewayResourceBudgets={'verify':4074}),
            project=projects.registered('onlykappa/KappaForge'), persist=lambda:None)
        jhandle = recovery.CURRENT.set(journal)
        task_state.bind('onlykappa/KappaForge',282,'kappa/dev-282',sha,journal)
        task_state.observe_pr(dict(html_url='https://github.com/onlykappa/KappaForge/pull/284',state='open',draft=True,
            head=dict(sha=sha,ref='kappa/dev-282',repo={'full_name':'onlykappa/KappaForge'})), 'onlykappa/KappaForge','kappa/dev-282')
        task_state.observe_validation('sandbox',sha,dict(id=40400807991,status='completed',conclusion='success'))
        check_label = goal.record.checks['sandbox']['evidence']
        source='| 3.1a | INSPECTED | Phase 1: '+ 'b'*40 +'; Phase 2: '+ 'c'*40 +' |'
        calls=[]
        def model(key,prompt,**kwargs):
            wrapped=task_state.add_to_prompt(prompt,journal)
            gateway.require_prompt_fits(wrapped)
            data=json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n',1)[1])[0]
            self.assertEqual(data['owner_goal'],task)
            self.assertIn('Phase 1:',data['sources']['docs/audit.md']['text'])
            shown=task_state.decode_prompt(wrapped)
            self.assertEqual(shown['identity'],goal.record.identity)
            self.assertEqual(shown['facts']['checks'][0]['runId'],40400807991)
            self.assertEqual(shown['facts']['checks'][0]['candidate'],sha)
            self.assertEqual(shown['facts']['checks'][0]['conclusion'],'success')
            self.assertTrue(shown['ownerReviewRequired'])
            calls.append(gateway.prompt_budget(wrapped)['promptChars'])
            with task_state.inference(wrapped,'gateway') as call:
                call.event('attempted','fixture')
                rows=[dict(id=r['id'],verdict='confirmed',in_goal=True,reason='Missing requested link',
                    owner_quote='Fix only missing commit links',evidence=[dict(path='docs/audit.md',quote='Phase 1:')])
                    for r in data['findings']]
                call.event('answered','fixture')
            return 'fixture',json.dumps({'findings':rows})
        try:
            for revision, claims in enumerate((['missing Phase 1 link','missing Phase 2 link'], ['missing Phase 1 link'])):
                # A source change requires a fresh inference, exercising the full
                # post-answer envelope rather than the immutable-decision cache.
                rows=repair_guard.verify_all_findings(model,'unused',task,claims,{'docs/audit.md':source + '\n' * revision})
                self.assertTrue(all(row['verdict']=='confirmed' for row in rows))
            self.assertGreaterEqual(len(calls),2)
            self.assertTrue(all(n<=4074 for n in calls))
            self.assertEqual(journal.state['gatewayResourceBudgets'],{'verify':4074})
            self.assertEqual(goal.request,task)
            self.assertEqual(goal.record.checks['sandbox']['runId'],40400807991)
            self.assertEqual(goal.record.checks['sandbox']['evidence'],check_label)
        finally:
            recovery.CURRENT.reset(jhandle)
            task_goal.CURRENT.reset(handle)

"""Fresh validated review supersedes only the historical diagnostics it actually resolves."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from engine import developer, requirements, task_goal, task_state, verify


class ReviewDiagnosticRetirementTests(unittest.TestCase):
    def setUp(self):
        self.ask = 'Fix add accepting numeric strings. Add invalid-input refusal to add.'
        self.goal = task_goal.from_request(self.ask)
        token = task_goal.CURRENT.set(self.goal);self.addCleanup(task_goal.CURRENT.reset,token)
        self.classified = requirements.classify(self.ask)
        token = requirements.CURRENT.set(self.classified);self.addCleanup(requirements.CURRENT.reset,token)
        task_state.bind(developer.ROOT,9,'kappa/dev-9','a'*40)
        self.source={'app.py':'def add(a,b):\n    return int(a)+int(b)\n',
                     'tests/test_app.py':'from app import add\ndef test_add():\n    assert add("1","2")==3\n'}
        self.goal.review_paths=tuple(self.source)
        before=list(developer.UNFINISHED);self.addCleanup(lambda:developer.UNFINISHED.__setitem__(slice(None),before))
        self.first,self.second=self.classified
        self.stale=[
            'Requirement review unavailable; task completion is not verified: ScopeReviewUnavailable: old malformed response',
            'Requirement not reviewed: '+self.first.id+' '+self.first.text[:200],
            'Requirement untested: '+self.first.id+' '+self.first.text[:200]+' (add or cite a test that exercises it)',
            'Requirement evidence does not match executable current source: '+self.first.text,
            'Requirement not met: '+self.first.text,
        ]
        self.sentinel='Independent validation is still required by the owner.'
        self.finding='app.py: unresolved independent source finding'
        self.lookalike='Requirement review unavailable; task completion is not verified by an unresolved source defect'

    def run_review(self, broken=False, missing=False):
        calls=[]
        developer.UNFINISHED[:]=self.stale+[self.sentinel,self.finding,self.lookalike]
        def model(key,prompt,**kw):
            calls.append(prompt)
            schema=json.JSONDecoder().raw_decode(prompt.split('Return ONLY strict JSON:\n',1)[1])[0]
            catalog=json.JSONDecoder().raw_decode(prompt.split('SOURCE_CITATION_CATALOG\n',1)[1])[0]
            refs={p:next(c['id'] for c in catalog if c['path']==p) for p in self.source}
            rows=schema['requirements'][:1] if missing else schema['requirements']
            for i,row in enumerate(rows):
                row.update(met=True,evidence={'path':'app.py','quote':'invented'} if broken and i==0 else {'citation':refs['app.py']},
                           test={'citation':refs['tests/test_app.py']} if i==0 else None)
            return 'fixture',json.dumps(dict(requirements=rows,problems=[],file_scope=[dict(path=p,necessary=True,
                reason='Implements or tests the requested inputs',citation=refs[p]) for p in self.source]))
        with patch.object(developer,'run_model',side_effect=model),patch.object(developer,'gh',side_effect=AssertionError('No GitHub mutation')):
            changed,_,problems=developer.check_the_work('fixture',self.ask,developer.ROOT,'a'*40,'fixture',self.source,
                {p:len(s) for p,s in self.source.items()},{},'',[],'',False,None,review_only=True)
        self.assertEqual(changed,{})
        return problems,calls

    def test_fresh_subset_replaces_resolved_history_but_keeps_current_missing_test_and_source_finding(self):
        problems,calls=self.run_review()
        self.assertEqual(len(calls),1)
        for old in self.stale:self.assertNotIn(old,problems)
        self.assertIn(self.sentinel,problems)
        self.assertIn(self.finding,problems)
        self.assertIn(self.lookalike,problems)
        self.assertTrue(any(p.startswith('Requirement untested: '+self.second.id+' ') for p in problems))

    def test_invalid_incomplete_review_does_not_retire_history(self):
        problems,calls=self.run_review(missing=True)
        self.assertEqual(len(calls),2)
        for old in self.stale:self.assertIn(old,problems)

    def test_bad_current_source_quote_cannot_retire_old_unmet_or_evidence_failure(self):
        problems,_=self.run_review(broken=True)
        for old in self.stale[-2:]:self.assertIn(old,problems)
        self.assertIn(self.sentinel,problems)

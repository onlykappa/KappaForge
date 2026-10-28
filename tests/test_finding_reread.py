"""Unseen verifier citations trigger one bounded investigation, never automatic acceptance."""
import json
import unittest
from unittest.mock import Mock
from engine import recovery, repair_guard, task_goal, task_state


class FindingRereadTests(unittest.TestCase):
    def setUp(self):
        self.goal = task_goal.from_request('Correct the output')
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(self.goal))
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(None))
        task_state.bind('onlykappa/KappaForge', 9, 'kappa/dev-9', 'a' * 40)
        self.source = '\n'.join(['# filler line ' + str(i) for i in range(400)] + ['return wrong_value'])
        self.inputs = []

    def response(self, prompt, span=None, path='app.py', owner='R1'):
        data = json.loads(prompt.split('REVIEW_INPUT\n')[1])
        self.inputs.append(data)
        return 'fixture', json.dumps({'findings': [dict(id=r['id'], verdict='confirmed', in_goal=True,
            reason='The return value violates the owner requirement', owner_ref=owner,
            evidence=[dict(path=path, lines=span or [401, 401])]) for r in data['findings']]})

    def assess(self, model):
        return repair_guard.verify_findings(model, 'key', self.goal.request,
                                            ['Fix app.py behavior'], {'app.py': self.source})

    def test_unseen_valid_citation_is_shown_and_freshly_verified_before_confirmation(self):
        model = Mock(side_effect=lambda key, prompt, **kw: self.response(prompt))
        rows = self.assess(model)
        self.assertEqual(model.call_count, 2)
        self.assertNotIn('401| return wrong_value', self.inputs[0]['sources']['app.py']['text'])
        self.assertIn('401| return wrong_value', self.inputs[1]['sources']['app.py']['text'])
        self.assertEqual(rows[0]['verdict'], 'confirmed')
        self.assertEqual(rows[0]['evidence'][0]['quote'], 'return wrong_value')

    def test_bad_citations_allow_only_protocol_retries_and_never_source_followup(self):
        for fields in (dict(path='../private.txt'), dict(span=[9999, 9999]), dict(span=[400, 390]),
                       dict(span=[1, 20]), dict(span=[True]), dict(owner='R99')):
            with self.subTest(fields=fields):
                self.inputs.clear()
                model = Mock(side_effect=lambda key, prompt, **kw: self.response(prompt, **fields))
                rows = self.assess(model)
                self.assertEqual(model.call_count, 1 if fields.get("owner") else repair_guard.VERIFIER_ATTEMPTS)
                self.assertTrue(all(data["sources"] == self.inputs[-1]["sources"] for data in self.inputs))
                self.assertEqual(rows[0]['verdict'], 'needs_validation')

    def test_followup_cannot_loop_or_convert_another_unseen_citation_into_proof(self):
        def model(key, prompt, **kw):
            return self.response(prompt, span=[401, 401] if not self.inputs else [200, 200])
        rows = self.assess(Mock(side_effect=model))
        self.assertEqual(len(self.inputs), 2)
        self.assertEqual(rows[0]['verdict'], 'needs_validation')
        self.assertIn('evidence:lines_not_shown', rows[0]['gate'])

    def test_candidate_change_during_followup_discards_the_decision(self):
        def model(key, prompt, **kw):
            if self.inputs:
                task_state.checkpoint('b' * 40)
            return self.response(prompt)
        with self.assertRaises(task_state.CandidateChanged):
            self.assess(Mock(side_effect=model))

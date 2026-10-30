"""Task330 scope receipts are exact-candidate observations, never model assertions."""
from contextlib import ExitStack
import json
import unittest
from unittest.mock import patch
from engine import operational_review, task_state, verify
from engine.evidence_contract import scope_constraint, scope_satisfied
from tests.test_operational_review import context, SHA

PATH = 'tests/test_budget_ledger.py'
ALLOW = 'Create only tests/test_budget_ledger.py.'
DENY = 'Do not change engine/, chat-backend/, config/, workflows, preview/, ios/ or any deploy path.'

class ScopeEvidenceTests(unittest.TestCase):
    def resolved(self, paths, proposal=None, candidate=SHA, receipt=True):
        with ExitStack() as stack:
            stack.enter_context(patch('tests.test_operational_review.TASK', ALLOW + '\n' + DENY))
            goal, journal, active = context(stack)
            record = task_state.current()[1]
            if receipt:
                record.control['file_scope'] = dict(identity={**record.identity, 'candidate': candidate},
                    authorization=active.identity, digest=active.digest, paths=paths)
            rows = [dict(text=x, met=True, evidence={'type': 'diff_scope', 'paths': [PATH]}) for x in (ALLOW, DENY)]
            reqs, _, _ = verify.parse_review(json.dumps({'requirements': rows}))
            return operational_review.resolve(reqs, proposal or {PATH: 'test source'})

    def test_actual330_constraints_use_diff_receipt_without_source_quote(self):
        rows = self.resolved([PATH])
        self.assertTrue(all(r['met'] for r in rows))
        self.assertTrue(all(r['evidence']['type'] == 'diff_scope' for r in rows))

    def test_second_published_file_and_forbidden_directory_fail(self):
        for path in ['tests/extra.py', 'engine/budget_ledger.py', '.github/workflows/evil.yml']:
            with self.subTest(path=path):
                self.assertFalse(self.resolved([PATH, path])[0]['met'])
        self.assertFalse(self.resolved([PATH, 'engine/x.py'])[1]['met'])

    def test_proposal_paths_and_renamed_from_paths_must_also_be_in_scope(self):
        self.assertFalse(self.resolved([PATH], {PATH: '', 'config/x.json': '{}'})[0]['met'])
        self.assertFalse(self.resolved([PATH, 'engine/renamed.py'])[1]['met'])

    def test_model_receipt_missing_or_stale_never_proves_scope(self):
        self.assertFalse(self.resolved([PATH], receipt=False)[0]['met'])
        self.assertFalse(self.resolved([PATH], candidate='b' * 40)[0]['met'])

    def test_runtime_evidence_cannot_prove_source_behavior(self):
        with self.assertRaises(ValueError):
            verify.parse_review(json.dumps({'requirements': [{'text':'Return the correct sum', 'met':True,
                'evidence': {'type':'runtime_result', 'path':'x.py', 'quote':'return 1'}}]}))

    def test_unknown_behavior_is_not_exempted_and_traversal_is_refused(self):
        self.assertIsNone(scope_constraint("Do not change the engine's reply format."))
        self.assertIsNone(scope_constraint('Create only ../secret.py.'))
        self.assertFalse(scope_satisfied(scope_constraint('Change only tests/.'), ['tests-evil/x.py']))

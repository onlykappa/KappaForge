"""Controller success and tested candidate do not erase unresolved task review (#330)."""
import json
from types import SimpleNamespace
from unittest.mock import Mock
import unittest
from engine import recovery

SHA = 'a' * 40
URL = 'https://github.com/onlykappa/KappaForge/pull/331'

def journal(problems=(), status='testing'):
    pr = dict(state='open', draft=True, head=dict(sha=SHA, ref='kappa/dev-330'),
              body='<!-- KAPPA_REVIEW_V1 ' + json.dumps({'complete': not problems, 'problems': list(problems)}) + ' -->')
    return SimpleNamespace(scope=SimpleNamespace(repo='onlykappa/KappaForge', number=330),
        state=dict(candidate=SHA, status=status), target_read=Mock(return_value=pr),
        persist=Mock(), publish=Mock(), clock=lambda: 1234)

class ObjectiveFinalizationTests(unittest.TestCase):
    def test_green_controller_with_passed_tests_and_review_failure_is_blocked(self):
        j = journal(['File-scope evidence unavailable'])
        recovery.finalize_attempt(j, URL)
        self.assertEqual(j.state['status'], 'blocked')
        self.assertEqual(j.state['objectiveReceipt']['state'], 'blocked_verification')
        self.assertEqual(j.state['objectiveReceipt']['candidate'], SHA)
        j.persist.assert_called_once()
        self.assertEqual(j.publish.call_args.args[0], 'blocked')

    def test_published_draft_alone_never_implies_completed(self):
        j = journal(); recovery.finalize_attempt(j, URL)
        self.assertEqual(j.state['objectiveReceipt']['state'], 'awaiting_independent_checks')
        self.assertEqual(j.state['status'], 'testing')

    def test_independently_ready_candidate_can_complete_without_merging(self):
        j = journal(status='ready'); recovery.finalize_attempt(j, URL)
        self.assertEqual(j.state['objectiveReceipt']['state'], 'completed')
        self.assertEqual(j.state['objectiveReceipt']['delivery'], 'draft')

    def test_closed_or_different_candidate_cannot_produce_success_receipt(self):
        for mutation in [dict(state='closed'), dict(head=dict(sha='b'*40, ref='kappa/dev-330'))]:
            j = journal(); j.target_read.return_value.update(mutation)
            with self.assertRaises(PermissionError): recovery.finalize_attempt(j, URL)
            j.persist.assert_not_called()

    def test_no_delivery_is_blocked_and_clarification_remains_paused(self):
        j = journal(); recovery.finalize_attempt(j, None)
        self.assertEqual(j.state['status'], 'blocked')
        j.target_read.assert_not_called()
        j = journal(status='needs_clarification'); recovery.finalize_attempt(j, None)
        j.persist.assert_not_called()
        self.assertEqual(j.state['status'], 'needs_clarification')

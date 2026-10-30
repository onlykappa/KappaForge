"""Persisted source-verified review decisions, scope isolation and publication barriers."""
from copy import deepcopy
import json
import unittest
from unittest.mock import Mock, patch

from engine import execution, recovery, review_repair as reviews, task_goal, task_state
from tests import test_review_ingestion as fixture


class ReviewRepairTests(unittest.TestCase):
    def setUp(self):
        fixture.ReviewIngestionTests.setUp(self)
        task_goal.CURRENT.set(task_goal.Goal('Change value to 2 and test it.', paths=('value.py',)))
        recovery.CURRENT.set(self.journal)
        task_state.bind(fixture.REPO, 130, 'kappa/dev-130', fixture.SHA, journal=self.journal)
        self.world.feedback['inline'] = [fixture.comment(7, path='value.py', line=1, commit_id=fixture.SHA)]
        self.world.feedback['inline'][0]['body'] = 'value.py still returns one rather than the required two'
        self.journal.ingest_reviews(133)

    def model(self, verdict='confirmed', quote='value = 1', in_goal=True):
        def reply(key, prompt, **kw):
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'scripted:review', json.dumps({'findings': [dict(id=row['id'], verdict=verdict,
                in_goal=in_goal, reason='The current value violates the unchanged owner contract',
                owner_quote='Change value to 2', evidence=[dict(path='value.py', quote=quote)])
                for row in data['findings']]})
        return Mock(side_effect=reply)

    def prepare(self, model=None):
        return reviews.prepare(self.journal, self.world.pr, lambda p: 'value = 1\n',
                               ['value.py'], model or self.model(), 'fixture')

    def test_confirmed_feedback_is_durable_and_not_reclassified_on_reconnect(self):
        model = self.model()
        batch = self.prepare(model)
        self.assertEqual(len(batch), 1)
        self.assertEqual(batch[0]['status'], 'actionable')
        self.assertEqual(batch[0]['source'], fixture.REPO + '#133:inline:7')
        self.assertEqual(reviews.load(self.world.journal(), 133)['decisions'][batch[0]['id']], batch[0])
        self.assertEqual(self.prepare(Mock(side_effect=AssertionError('already investigated'))), batch)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(task_goal.CURRENT.get().request, 'Change value to 2 and test it.')

    def test_rejected_unproven_and_out_of_scope_feedback_never_reaches_coder(self):
        for verdict, quote in (('rejected', 'value = 1'), ('confirmed', 'invented source')):
            with self.subTest(verdict=verdict, quote=quote):
                self.journal.state.pop('reviewDecisions', None)
                self.assertEqual(self.prepare(self.model(verdict, quote)), [])
        self.world.feedback['inline'][0]['path'] = '.github/workflows/deploy.yml'
        self.journal.ingest_reviews(133)
        self.assertEqual(self.prepare(Mock(side_effect=AssertionError('scope denied before inference'))), [])

    def test_resolved_outdated_deleted_and_stale_feedback_are_historical(self):
        for field, value in (('isResolved', True), ('isOutdated', True), ('commit_id', 'b' * 40)):
            with self.subTest(field=field):
                self.world.feedback['inline'][0] = fixture.comment(7, path='value.py', line=1, **{field: value})
                self.journal.ingest_reviews(133)
                self.assertEqual(self.prepare(Mock(side_effect=AssertionError('historical feedback'))), [])
        self.world.feedback['inline'] = []
        self.journal.ingest_reviews(133)
        self.assertEqual(self.prepare(Mock(side_effect=AssertionError('deleted feedback'))), [])

    def test_feedback_edit_or_head_movement_blocks_stale_publication(self):
        batch = self.prepare()
        self.world.feedback['inline'][0]['body'] = 'A different concern arrived during repair'
        with self.assertRaises(execution.CheckpointMismatch): reviews.fresh(self.journal, self.world.pr, batch)
        self.world.pr['head']['sha'] = 'b' * 40
        with self.assertRaises(PermissionError): self.prepare()

    def test_unrelated_passing_change_and_unfixed_defect_cannot_publish(self):
        batch = self.prepare()
        with self.assertRaises(execution.CheckpointMismatch):
            reviews.verify_corrections(batch, {'value.py': 'value = 1\n'}, {'other.py': 'pass\n'},
                                       self.model(), 'fixture')
        with self.assertRaises(execution.CheckpointMismatch):
            reviews.verify_corrections(batch, {}, {'value.py': 'value = 1\n'}, self.model(), 'fixture')
        reviews.verify_corrections(batch, {}, {'value.py': 'value = 2\n'}, self.model('rejected', 'value = 2'), 'fixture')

    def test_failed_decision_persistence_keeps_previous_pointer(self):
        original = self.journal.state.get('reviewDecisions')
        persist = self.journal.persist
        def interrupted():
            if self.journal.state.get('reviewDecisions'):
                raise OSError('lost journal acknowledgement')
            return persist()
        with patch.object(self.journal, 'persist', side_effect=interrupted):
            with self.assertRaises(OSError): self.prepare()
        self.assertEqual(self.journal.state.get('reviewDecisions'), original)

    def test_failed_or_empty_validation_is_not_a_correction_receipt(self):
        batch = self.prepare()
        with self.assertRaises(execution.CheckpointMismatch):
            reviews.published(self.journal, self.world.pr, batch, fixture.SHA, 'b' * 40,
                              dict(status='failed', stop_reason='identical_error', test_results=[]))

    def test_controller_comments_never_receive_replies_across_repeated_fixes(self):
        self.world.feedback['conversation'].append(dict(
            fixture.comment(900), user=dict(id=1, login=recovery.BOT, type='Bot'), body='### KappaForge fix ready\n\nDetails'))
        self.journal.ingest_reviews(133)
        self.prepare()
        self.journal.scope.own_prs.add(133)
        from engine import intent_guard
        intent_guard.ACTIVE.get().own_prs.add(133)
        writes = self.journal.write
        def post(path, payload, method):
            result = writes(path, payload, method)
            if path.endswith('/issues/133/comments'):
                self.world.feedback['conversation'].append(deepcopy(result))
            return result
        with patch.object(self.journal, 'write', side_effect=post):
            for _ in range(3):
                reviews.report(self.journal, self.world.pr)
                self.journal.ingest_reviews(133)
                self.prepare(Mock(side_effect=AssertionError('controller comments are never investigated')))
            bodies = [c['body'] for c in self.world.feedback['conversation']]
        # Only the original controller comment plus one decision reply for the human's inline feedback.
        self.assertEqual(len(bodies), 2, bodies)
        self.assertFalse(any('Controller report' in body for body in bodies))

    def test_reply_uses_a_stable_receipt_and_never_resolves_thread(self):
        batch = self.prepare()
        self.journal.scope.own_prs.add(133)
        from engine import intent_guard
        intent_guard.ACTIVE.get().own_prs.add(133)
        # World is an API fixture: include its bot reply in subsequent conversation reads.
        writes = self.journal.write
        def post(path, payload, method):
            result = writes(path, payload, method)
            if path.endswith('/issues/133/comments'):
                self.world.feedback['conversation'].append(deepcopy(result))
            return result
        with patch.object(self.journal, 'write', side_effect=post):
            reviews.report(self.journal, self.world.pr)
            count = len(self.world.feedback['conversation'])
            reviews.report(self.journal, self.world.pr)
        self.assertEqual(count, 1)
        self.assertEqual(len(self.world.feedback['conversation']), 1)
        self.assertIn(batch[0]['source'], self.world.feedback['conversation'][0]['body'])
        self.assertFalse(any('resolveReviewThread' in str(call) for call in self.world.calls))

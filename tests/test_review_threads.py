"""Thread pagination and the real HTTP scope gate, using deterministic API fixtures."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from engine import execution, intent_guard, review_threads as threads
from tests import test_review_ingestion as fixture

REPO, SHA, comment = fixture.REPO, fixture.SHA, fixture.comment


class ThreadConnectionTests(unittest.TestCase):
    setUp = fixture.ReviewIngestionTests.setUp

    def response(self, ids, more=False, cursor=None, thread='t'):
        pull = dict(number=133, headRefOid=SHA, repository=dict(nameWithOwner=REPO))
        return dict(id=thread, isResolved=False, isOutdated=True, pullRequest=pull,
                    comments=dict(nodes=[dict(fullDatabaseId=n) for n in ids],
                                  pageInfo=dict(hasNextPage=more, endCursor=cursor)))

    def read(self, replies):
        def transport(path, payload, method):
            self.assertEqual(path, 'graphql')
            intent_guard.guard_request('https://api.github.com/graphql', payload, method, lambda n: self.world.issue)
            return deepcopy(replies.pop(0))
        return transport

    def test_nested_comment_and_thread_pagination_preserve_state(self):
        first = self.response([1], True, 'comments-next')
        second = self.response([2])
        third = self.response([3], thread='t2')
        def page(node, more=False):
            return dict(data=dict(repository=dict(nameWithOwner=REPO, pullRequest=dict(
                number=133, headRefOid=SHA, reviewThreads=dict(nodes=[node],
                pageInfo=dict(hasNextPage=more, endCursor='threads-next' if more else None))))))
        replies = [page(first, True), dict(data=dict(node=second)), page(third)]
        with patch.object(self.journal, 'write', side_effect=self.read(replies)):
            result = threads.inventory(self.journal, 133, SHA)
        self.assertEqual(set(result), {1, 2, 3})
        self.assertEqual(result[2], dict(thread_id='t', resolved=False, outdated=True))
        self.assertFalse(replies)
        self.assertIsNone(threads.GATE.get())

    def test_errors_partial_response_and_candidate_drift_preserve_inbox(self):
        self.world.feedback['inline'] = [comment(1)]
        self.journal.ingest_reviews(133)
        pointer = deepcopy(self.journal.state['reviewInbox'])
        for response in ({'errors': [{'message': 'rate limit'}], 'data': {}}, {'data': {}},
                         {'data': {'repository': {'nameWithOwner': 'other/repo'}}}):
            with self.subTest(response=response), patch.object(self.journal, 'write', return_value=response):
                with self.assertRaises((execution.CheckpointMismatch, execution.CheckpointUnavailable)):
                    self.journal.ingest_reviews(133)
                self.assertEqual(self.journal.state['reviewInbox'], pointer)
                self.assertIsNone(threads.GATE.get())

    def test_graphql_is_denied_outside_the_scoped_read_even_for_query_text(self):
        for query in (threads.THREADS, 'mutation { mergePullRequest(input:{pullRequestId:"x"}) { clientMutationId } }'):
            with self.assertRaises(PermissionError):
                intent_guard.guard_request('https://api.github.com/graphql', {'query': query, 'variables': {}},
                                           'POST', lambda n: self.world.issue)

    def test_complete_rest_and_graphql_inventories_must_agree(self):
        self.world.feedback['inline'] = [comment(1)]
        with patch.object(threads, 'inventory', return_value={}):
            with self.assertRaises(execution.CheckpointMismatch): self.journal.ingest_reviews(133)
        self.assertNotIn('reviewInbox', self.journal.state)

    def test_repeated_cursor_and_global_page_bound_are_rejected(self):
        with self.assertRaises(ValueError):
            threads._page(dict(nodes=[], pageInfo=dict(hasNextPage=True, endCursor='again')), {'again'})
        from engine import review_ingestion
        with patch.object(review_ingestion, 'MAX_PAGES', 0):
            with self.assertRaises(ValueError): threads.inventory(self.journal, 133, SHA)

    def test_full_database_identity_preserves_64_bit_comment_ids(self):
        number = 2 ** 55 + 7
        thread = self.response([])
        thread['comments']['nodes'] = [dict(fullDatabaseId=str(number))]
        data = dict(data=dict(repository=dict(nameWithOwner=REPO, pullRequest=dict(number=133,
            headRefOid=SHA, reviewThreads=dict(nodes=[thread], pageInfo=dict(hasNextPage=False))))))
        with patch.object(self.journal, 'write', side_effect=self.read([data])):
            self.assertEqual(set(threads.inventory(self.journal, 133, SHA)), {number})

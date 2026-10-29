"""Bounded, read-only GraphQL thread inventory for an already authorized draft PR."""
from contextvars import ContextVar
import os
import re

from engine import execution

PAGE_INFO = 'pageInfo { hasNextPage endCursor }'
THREAD_FIELDS = '''id isResolved isOutdated
  pullRequest { number headRefOid repository { nameWithOwner } }
  comments(first:100, after:$commentsAfter) { nodes { fullDatabaseId } ''' + PAGE_INFO + ' }'
THREADS = '''query($owner:String!, $name:String!, $pr:Int!, $after:String, $commentsAfter:String) {
  repository(owner:$owner, name:$name) { nameWithOwner
    pullRequest(number:$pr) { number headRefOid reviewThreads(first:100, after:$after) {
      nodes { ''' + THREAD_FIELDS + ' } ' + PAGE_INFO + ' } } } }'
COMMENTS = '''query($thread:ID!, $commentsAfter:String) {
  node(id:$thread) { ... on PullRequestReviewThread { ''' + THREAD_FIELDS + ' } } }'
GATE = ContextVar('review_thread_read', default=None)


def permits(scope, payload):
    """POST is permitted only during this controller's exact read, never a mutation."""
    gate = GATE.get()
    return bool(gate and gate[:3] == (scope.repo, scope.number, scope.digest)
                and isinstance(payload, dict) and payload.get('query') in (THREADS, COMMENTS)
                and execution.digest(payload) == gate[3])


def _request(journal, pr, query, variables):
    from engine import review_ingestion, recovery
    review_ingestion._authorize(journal, pr)
    payload = dict(query=query, variables=variables)
    token = GATE.set((journal.scope.repo, journal.scope.number, journal.scope.digest, execution.digest(payload)))
    try:
        if journal.scope.repo == recovery.ROOT:
            result = journal.write('graphql', payload, 'POST')
        else:
            from engine.projects import access
            from engine.runner import github
            result = github('graphql', access(journal.scope.repo, os.getenv('GITHUB_TOKEN', '')), payload, 'POST')
    finally:
        GATE.reset(token)
    review_ingestion._authorize(journal, pr)
    if not isinstance(result, dict) or result.get('errors') or not isinstance(result.get('data'), dict):
        raise execution.CheckpointUnavailable('Review thread query failed; previous inbox retained')
    return result['data']


def _page(connection, seen):
    if (not isinstance(connection, dict) or not isinstance(connection.get('nodes'), list)
            or len(connection['nodes']) > 100 or not isinstance(connection.get('pageInfo'), dict)
            or type(connection['pageInfo'].get('hasNextPage')) is not bool):
        raise ValueError('Incomplete review thread inventory')
    info = connection['pageInfo']
    cursor = info.get('endCursor')
    if info['hasNextPage']:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512 or cursor in seen:
            raise ValueError('Review thread pagination did not advance')
        seen.add(cursor)
        return connection['nodes'], cursor
    return connection['nodes'], None


def inventory(journal, pr, candidate):
    """Collect complete thread/comment connections, or retain the previous inbox."""
    from engine.review_ingestion import MAX_PAGES
    owner, name = journal.scope.repo.split('/')
    result, thread_ids, thread_cursor, seen = {}, set(), None, set()
    reads = 0
    def request(query, variables):
        nonlocal reads
        reads += 1
        if reads > MAX_PAGES:
            raise ValueError('Review thread inventory exceeds the bounded page limit')
        return _request(journal, pr, query, variables)
    def identity(value):
        if (not isinstance(value, dict) or value.get('number') != pr
                or value.get('headRefOid') != candidate
                or (value.get('repository') or {}).get('nameWithOwner') != journal.scope.repo):
            raise execution.CheckpointMismatch('Review thread candidate or repository changed')
    while True:
        data = request(THREADS, dict(owner=owner, name=name, pr=pr, after=thread_cursor, commentsAfter=None))
        repository = data.get('repository') or {}
        pull = repository.get('pullRequest') or {}
        identity(dict(pull, repository=repository))
        threads, thread_cursor = _page(pull.get('reviewThreads'), seen)
        for thread in threads:
            if (not isinstance(thread, dict) or not isinstance(thread.get('id'), str)
                    or not 1 <= len(thread['id']) <= 256 or thread['id'] in thread_ids
                    or type(thread.get('isResolved')) is not bool or type(thread.get('isOutdated')) is not bool):
                raise ValueError('Malformed or duplicate review thread')
            identity(thread.get('pullRequest'))
            thread_ids.add(thread['id'])
            states = dict(thread_id=thread['id'], resolved=thread['isResolved'], outdated=thread['isOutdated'])
            current, cursors = thread, set()
            while True:
                comments, cursor = _page(current.get('comments'), cursors)
                for comment in comments:
                    number = comment.get('fullDatabaseId') if isinstance(comment, dict) else None
                    if isinstance(number, str) and re.fullmatch(r'[1-9][0-9]{0,18}', number):
                        number = int(number)
                    if type(number) is not int or not 0 < number < 2 ** 63 or number in result:
                        raise ValueError('Malformed or duplicate review thread comment')
                    result[number] = states
                if cursor is None:
                    break
                current = request(COMMENTS, dict(thread=thread['id'], commentsAfter=cursor)).get('node')
                if not isinstance(current, dict) or current.get('id') != thread['id']:
                    raise execution.CheckpointMismatch('Review thread changed during pagination')
                identity(current.get('pullRequest'))
                if current.get('isResolved') != states['resolved'] or current.get('isOutdated') != states['outdated']:
                    raise execution.CheckpointMismatch('Review thread state changed during pagination')
        if thread_cursor is None:
            return result

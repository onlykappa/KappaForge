"""Authenticated, durable review evidence. Feedback never grants execution authority."""
from copy import deepcopy
import re

from engine import execution, intent_guard, recovery

MAX_PAGES = 20
SOURCES = {'conversation': 'issues/{pr}/comments', 'inline': 'pulls/{pr}/comments',
           'review': 'pulls/{pr}/reviews'}
FIELDS = ('node_id', 'body', 'html_url', 'created_at', 'updated_at', 'submitted_at',
          'state', 'commit_id', 'original_commit_id', 'pull_request_review_id',
          'in_reply_to_id', 'path', 'line', 'start_line', 'side', 'start_side',
          'original_line', 'original_start_line', 'position', 'original_position',
          'diff_hunk', 'thread_id', 'resolved', 'outdated', 'isResolved', 'isOutdated')


def _authorize(journal, pr):
    scope, state = journal.scope, journal.state
    active = intent_guard.ACTIVE.get()
    if (not isinstance(active, intent_guard.ExecutionScope)
            or any(getattr(active, k) != getattr(scope, k) for k in ('repo', 'number', 'digest', 'identity'))
            or scope.mode != 'develop'
            or type(pr) is not int or pr < 1
            or state.get('repo') != scope.repo or state.get('task') != scope.number
            or state.get('digest') != scope.digest
            or state.get('pr') != f'https://github.com/{scope.repo}/pull/{pr}'
            or not re.fullmatch(r'[a-f0-9]{40}', str(state.get('candidate', '')))):
        raise PermissionError('Review ingestion requires this task\'s saved authorized PR')
    current = journal.read(f'repos/{recovery.ROOT}/issues/{scope.number}')
    scope.check_current(current)
    active.check_current(current)


def _read(journal, pr, suffix):
    _authorize(journal, pr)
    return journal.target_read(f'repos/{journal.scope.repo}/' + suffix)


def _candidate(journal, pr):
    value = _read(journal, pr, f'pulls/{pr}')
    if (not isinstance(value, dict) or value.get('number') != pr
            or value.get('html_url') != journal.state['pr']
            or value.get('state') != 'open' or value.get('draft') is not True
            or (value.get('head') or {}).get('ref') != f'kappa/dev-{journal.scope.number}'
            or (value.get('head') or {}).get('sha') != journal.state['candidate']
            or journal.state.get('base') and (value.get('base') or {}).get('ref') != journal.state['base']
            or any(((value.get(side) or {}).get('repo') or {}).get('full_name') != journal.scope.repo
                   for side in ('head', 'base'))):
        raise PermissionError('Review PR is closed, foreign or differs from the saved candidate/base')
    return value['head']['sha']


def _inventory(journal, pr):
    items = {}
    repo = journal.scope.repo
    for kind, endpoint in SOURCES.items():
        for page in range(1, MAX_PAGES + 1):
            rows = _read(journal, pr, endpoint.format(pr=pr) + f'?per_page=100&page={page}')
            if not isinstance(rows, list) or len(rows) > 100:
                raise ValueError('Review inventory is incomplete or malformed')
            for row in rows:
                if (not isinstance(row, dict) or type(row.get('id')) is not int or row['id'] < 1
                        or 'user' not in row
                        or (row['user'] is not None and (not isinstance(row['user'], dict)
                            or not isinstance(row['user'].get('login'), str)))):
                    raise ValueError('Review source identity is missing')
                key = f'{repo}#{pr}:{kind}:{row["id"]}'
                # Endpoint, scope and IDs come from controller-selected API reads.
                # All text and location fields remain untrusted evidence, including links.
                item = dict(repository=repo, pr=pr, source=kind, id=row['id'],
                            # GitHub may retain evidence with a null user after account deletion.
                            author={k: (row['user'] or {}).get(k) for k in ('id', 'login', 'type')},
                            evidence_only=True, deleted=False)
                item.update({k: row[k] for k in FIELDS if k in row})
                item = execution.sanitized(item)
                if key in items:
                    raise ValueError('Review pagination repeated a source identity')
                items[key] = item
            if len(rows) < 100:
                break
        else:
            raise ValueError('Review inventory exceeds the bounded page limit')
    from engine.review_threads import inventory
    threads = inventory(journal, pr, journal.state['candidate'])
    inline = {row['id'] for row in items.values() if row['source'] == 'inline'}
    if set(threads) != inline:
        raise execution.CheckpointMismatch('REST comments and review threads disagree; retry a fresh snapshot')
    for row in items.values():
        if row['source'] == 'inline':
            row.update(threads[row['id']])
    return items


def load(journal, pr):
    """Restore only an intact inbox belonging to this exact owner scope and PR."""
    _authorize(journal, pr)
    pointer = journal.state.get('reviewInbox')
    if not pointer:
        return None
    saved = execution._read_blob(journal, pointer)
    if (not isinstance(saved, dict) or saved.get('version') != 1
            or saved.get('task') != journal.scope.number or saved.get('scope') != journal.scope.digest
            or saved.get('repo') != journal.scope.repo or saved.get('pr') != pr
            or not isinstance(saved.get('items'), dict)
            or type(saved.get('revision')) is not int or saved['revision'] < 1):
        raise execution.CheckpointMismatch('Review inbox belongs to another task or PR')
    for key, row in saved['items'].items():
        if (not isinstance(row, dict) or row.get('repository') != saved['repo'] or row.get('pr') != pr
                or row.get('source') not in SOURCES or type(row.get('id')) is not int
                or row['id'] < 1 or key != f'{saved["repo"]}#{pr}:{row["source"]}:{row["id"]}'
                or row.get('evidence_only') is not True or type(row.get('deleted')) is not bool):
            raise execution.CheckpointMismatch('Review inbox contains a foreign source identity')
    return deepcopy(saved)


def sync(journal, pr):
    """Take a stable bounded snapshot; failure never replaces the durable inbox.

    REST comments are joined to a complete authenticated GraphQL thread inventory.
    Two complete scans reject observed concurrent edits, thread changes and page
    shifts; feedback arriving after the snapshot is picked up on the next call.
    """
    _authorize(journal, pr)
    execution.require_storage(journal, journal.scope.repo)
    candidate = _candidate(journal, pr)
    previous = load(journal, pr)
    items = _inventory(journal, pr)
    if items != _inventory(journal, pr) or candidate != _candidate(journal, pr):
        raise execution.CheckpointMismatch('Review sources changed during ingestion; retry a fresh snapshot')
    # Absence is evidence only after complete stable scans; keep removed feedback
    # as tombstones rather than silently forgetting processed identities.
    if previous:
        for key, value in previous['items'].items():
            if key not in items:
                items[key] = dict(value, deleted=True)
        if previous.get('candidate') == candidate and previous['items'] == items:
            return previous
    saved = dict(version=1, task=journal.scope.number, scope=journal.scope.digest,
                 repo=journal.scope.repo, pr=pr, candidate=candidate,
                 revision=previous['revision'] + 1 if previous else 1, items=items)
    old = journal.state.get('reviewInbox')
    _authorize(journal, pr)
    pointer = execution._write_blob(journal, saved, old)
    journal.state['reviewInbox'] = pointer
    try:
        journal.persist()
    except Exception:
        if old is None:
            journal.state.pop('reviewInbox', None)
        else:
            journal.state['reviewInbox'] = old
        raise
    return deepcopy(saved)

"""Controller receipts for narrow execution constraints, never source-proof exemptions.

Missing authority, history or evidence stays unmet and cannot authorize a code repair.
"""
import re
import time
from engine import intent_guard, recovery, task_state

FOREIGN_RE = re.compile(r'^Leave task #([1-9][0-9]*) and draft PR #([1-9][0-9]*) untouched for later owner audit[.]?$', re.I)
LIMITS = 'Keep model requests small and retain existing request/provider limits and validation gates.'


def kind(text):
    from engine import requirements
    text = ' '.join(str(text or '').split())
    from engine import report_claims
    if report_claims.constraint(text):
        return 'reporting'
    if requirements.FRESH_BRANCH_RE.fullmatch(text):
        return 'origin'
    if FOREIGN_RE.fullmatch(text):
        return 'foreign'
    if requirements.SCOPE_RESTRICTION_RE.fullmatch(text):
        return 'scope'
    if text.rstrip('.').lower() == LIMITS.rstrip('.').lower():
        return 'limits'
    return None


def authority():
    goal, record = task_state.current()
    journal = recovery.CURRENT.get()
    active = intent_guard.ACTIVE.get()
    scope = getattr(journal, 'scope', None)
    state = getattr(journal, 'state', {})
    if not (goal and record and isinstance(active, intent_guard.ExecutionScope)
            and isinstance(scope, intent_guard.ExecutionScope)):
        return None
    identity = record.identity
    if (active.mode != 'develop' or scope.mode != 'develop'
            or active.state not in ('authorized', 'planning', 'executing', 'verifying') or active.expires <= time.time()
            or any(getattr(active, k) != getattr(scope, k) for k in ('number', 'repo', 'digest', 'identity'))
            or identity.get('task') != scope.number or state.get('task') != scope.number
            or identity.get('repository') != scope.repo or state.get('repo') != scope.repo
            or identity.get('branch') != f'kappa/dev-{scope.number}'
            or identity.get('candidate') != state.get('candidate')
            or not re.fullmatch('[a-f0-9]{40}', str(identity.get('candidate', '')))
            or state.get('authorization') != scope.identity or state.get('digest') != scope.digest):
        return None
    return goal, record, journal, active


def origin_valid(origin, scope):
    return (isinstance(origin, dict) and origin.get('authorization') == scope.identity
            and origin.get('digest') == scope.digest and origin.get('repo') == scope.repo
            and origin.get('task') == scope.number and origin.get('ref') == 'main'
            and origin.get('unused') is True
            and all(re.fullmatch('[a-f0-9]{40}', str(origin.get(k, ''))) for k in ('sha', 'candidate')))


def observe_origin(base, sha, unused):
    observed = authority()
    if not observed or base != 'main' or unused is not True:
        return
    _, record, journal, scope = observed
    if sha != record.identity['candidate']:
        return
    origin = dict(authorization=scope.identity, digest=scope.digest, repo=scope.repo, task=scope.number,
                  ref=base, sha=sha, candidate=sha, unused=True)
    journal.state['branchOrigin'] = origin
    record.control['origin'] = dict(origin)


def restore_origin(get=None):
    observed = authority()
    if not observed:
        return
    _, record, journal, scope = observed
    origin = journal.state.get('branchOrigin')
    if not origin_valid(origin, scope):
        return
    candidate = record.identity['candidate']
    if origin['candidate'] != candidate:
        if get is None:
            return
        result = get(f'repos/{scope.repo}/compare/{origin["sha"]}...{candidate}')
        if (result.get('status') not in ('ahead', 'identical')
                or result.get('merge_base_commit', {}).get('sha') != origin['sha']):
            return
        origin = dict(origin, candidate=candidate)
        journal.state['branchOrigin'] = origin
    record.control['origin'] = dict(origin)


def published(parent, child):
    observed = authority()
    if not observed:
        return
    _, record, journal, scope = observed
    origin = record.control.get('origin')
    if origin_valid(origin, scope) and origin['candidate'] == parent:
        origin = dict(origin, candidate=child)
        record.control['origin'] = origin
        journal.state['branchOrigin'] = dict(origin)


def bounded_request(budget):
    observed = authority()
    if not observed or 'failedChecks' not in budget or budget['failedChecks']:
        return
    _, record, journal, scope = observed
    # Persist with the next existing checkpoint/counter write; no additional GitHub write.
    with record.lock:
        stats = journal.state.get('boundedRequests', {})
        if not isinstance(stats, dict):
            record.control.pop('requests', None)
            return
        if stats.get('authorization') != scope.identity or stats.get('digest') != scope.digest:
            stats = dict(authorization=scope.identity, digest=scope.digest, calls=0, maxChars=0)
        if any(type(stats.get(k)) is not int or stats[k] < 0 for k in ('calls', 'maxChars')):
            record.control.pop('requests', None)
            return  # Malformed diagnostics cannot become a proof receipt.
        stats = dict(stats, calls=stats['calls'] + 1, maxChars=max(stats['maxChars'], budget['promptChars']))
        journal.state['boundedRequests'] = stats
        record.control['requests'] = dict(stats)


def resolve(reqs, changes):
    from engine import requirements
    goal, record = task_state.current()
    observed = authority()
    owned = {' '.join(row['text'].split()).rstrip('.') for row in requirements.split(getattr(goal, 'request', ''))}
    paths = set(changes or ()) | set(getattr(goal, 'review_paths', ()))
    allowed = set(re.findall(r'\bdocs/[A-Za-z0-9_./-]+\.(?:md|rst|txt)\b', getattr(goal, 'original', '')))
    docs_only = bool(paths and paths <= allowed and all(p.endswith(('.md', '.rst', '.txt')) for p in paths))
    for req in reqs:
        category = kind(req.get('text'))
        if not category:
            continue
        req.update(kind='controller', met=False, evidence={'missing': 'Fresh task-bound operational receipt required'})
        if not observed or ' '.join(req['text'].split()).rstrip('.') not in owned:
            continue
        _, record, journal, scope = observed
        proof = None
        if category == 'reporting':
            from engine import report_claims
            proof = report_claims.controller_proof()
        elif category == 'origin':
            origin = record.control.get('origin')
            if (origin_valid(origin, scope) and origin['candidate'] == record.identity['candidate']
                    and ('default branch' not in req['text'].lower() or origin.get('default') is True)):
                proof = dict(origin=origin)
        elif category == 'foreign':
            match = FOREIGN_RE.fullmatch(' '.join(req['text'].split()))
            task, pr = map(int, match.groups())
            if docs_only and scope.repo == 'onlykappa/KappaForge' and task != scope.number and pr not in scope.own_prs:
                # Check the actual active guard, not a model declaration that a task was left alone.
                probes = [(f'issues/{task}/comments', {'body': 'report'}),
                          (f'pulls/{pr}', {'body': 'edit'})]
                denied = []
                for path, payload in probes:
                    try:
                        scope.permit(f'https://api.github.com/repos/{scope.repo}/{path}', payload,
                                     'PATCH' if path == f'pulls/{pr}' else 'POST')
                    except PermissionError:
                        denied.append(path)
                if len(denied) == len(probes):
                    proof = dict(excludedTask=task, excludedPR=pr, guard='foreign mutations prohibited')
        elif category in ('scope', 'limits') and docs_only:
            if category == 'scope':
                denied = False
                try:
                    scope.permit(f'https://api.github.com/repos/{scope.repo}/actions/workflows/deploy-chat.yml/dispatches',
                                 {'ref': 'main', 'inputs': {'branch': record.identity['branch']}}, 'POST')
                except PermissionError:
                    denied = True
                if denied and scope.release_pr is None:
                    proof = dict(paths=sorted(paths), guard='task draft workflow only; no release authority')
            else:
                stats = record.control.get('requests')
                from engine import gateway
                if stats and stats.get('calls', 0) > 0 and stats.get('maxChars', gateway.engine_prompt_cap() + 1) <= gateway.engine_prompt_cap():
                    proof = dict(paths=sorted(paths), boundedRequests=stats['calls'], maxPromptChars=stats['maxChars'],
                                 guard='unchanged gateway/provider gates; documentation-only diff')
        if proof:
            req.update(met=True, evidence={'controller_receipt': dict(record.identity, proof=proof)})
    return reqs

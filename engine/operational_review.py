"""Controller receipts for narrow execution constraints, never source-proof exemptions.

Missing authority, history or evidence stays unmet and cannot authorize a code repair.
"""
import re
import time
from urllib.parse import quote
import urllib.error
from engine import intent_guard, recovery, task_state

FOREIGN_RE = re.compile(r'^Leave task #([1-9][0-9]*) and draft PR #([1-9][0-9]*) untouched for later owner audit[.]?$', re.I)
BRANCH_HOLD_RE = re.compile(r'^Leave its branch untouched so the verified fix can be folded into #([1-9][0-9]*) after independent review[.]?$', re.I)
LIMITS = 'Keep model requests small and retain existing request/provider limits and validation gates.'


def file_scope_paths(text):
    from engine.evidence_contract import scope_constraint
    constraint = scope_constraint(text)
    if constraint and constraint[0] == 'allow':
        return constraint[1]
    match = re.fullmatch(r'Keep this task to (.+?)[.]?', ' '.join(str(text or '').split()), re.I)
    if not match:
        return None
    paths = re.split(r'\s*(?:,\s*(?:and\s+)?|\s+and\s+)\s*', match[1])
    if not 0 < len(paths) <= 64 or any(not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\.[A-Za-z0-9_-]+', p)
            or any(part in ('.', '..', '.git') for part in p.split('/')) for p in paths):
        return None
    return tuple(paths)


def kind(text):
    from engine import requirements
    text = ' '.join(str(text or '').split())
    from engine.evidence_contract import authorization_actions
    if authorization_actions(text):
        return 'authorization_boundary'
    from engine import report_claims
    if report_claims.constraint(text):
        return 'reporting'
    if requirements.FRESH_BRANCH_RE.fullmatch(text):
        return 'origin'
    if FOREIGN_RE.fullmatch(text):
        return 'foreign'
    if BRANCH_HOLD_RE.fullmatch(text):
        return 'branch_hold'
    from engine.evidence_contract import scope_constraint
    if scope_constraint(text):
        return 'file_scope'
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


def observe_branch_holds(read):
    """Read only owner-named protected branches; model declarations supply no receipt."""
    observed = authority()
    if not observed:
        return
    _, record, _, scope = observed
    from engine import requirements
    holds = {}
    record.control['branch_holds'] = holds
    for row in requirements.split(scope.body):
        match = BRANCH_HOLD_RE.fullmatch(' '.join(row['text'].split()))
        if not match:
            continue
        number = int(match[1])
        try:
            pr = read(f'repos/{scope.repo}/pulls/{number}')
        except (urllib.error.URLError, TimeoutError, ValueError):
            continue  # An unreadable named PR yields no hold receipt; the requirement stays unmet.
        if not isinstance(pr, dict) or not isinstance(pr.get('head'), dict):
            continue
        head = pr['head']
        if not isinstance(head.get('repo'), dict):
            continue
        branch = head.get('ref')
        if (type(pr.get('number')) is int and pr['number'] == number and head['repo'].get('full_name') == scope.repo
                and isinstance(branch, str) and branch and branch != record.identity['branch']
                and re.fullmatch('[a-f0-9]{40}', str(head.get('sha', '')))):
            holds[number] = dict(branch=branch, observedHead=head['sha'], authorization=scope.identity, digest=scope.digest)


def observe_file_scope(read):
    """Observe the complete published delta; proposals are checked separately at resolution."""
    observed = authority()
    if not observed:
        return
    goal, record, journal, scope = observed
    record.control.pop('file_scope', None)
    from engine import requirements
    from engine.evidence_contract import scope_constraint
    if not any(scope_constraint(r['text']) for r in requirements.split(goal.request)):
        return
    candidate = record.identity['candidate']
    def paths(rows):
        if not isinstance(rows, list) or any(not isinstance(r, dict) or not isinstance(r.get('filename'), str)
                or r.get('status') not in ('added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged')
                or (r.get('status') == 'renamed' and not isinstance(r.get('previous_filename'), str)) for r in rows):
            return None
        if len({r['filename'] for r in rows}) != len(rows):
            return None
        return {p for r in rows for p in (r['filename'], r.get('previous_filename') if r['status'] == 'renamed' else None) if p}
    url = (goal.receipt.get('url') if isinstance(goal.receipt, dict) else '') or journal.state.get('pr', '')
    match = re.fullmatch(r'https://github.com/'+re.escape(scope.repo)+r'/pull/([1-9][0-9]*)', url)
    if url and not match:
        return
    try:
        if match:
            number = int(match[1]); endpoint = f'repos/{scope.repo}/pulls/{number}'
            pr = read(endpoint)
            if not isinstance(pr, dict):
                return
            head = pr.get('head', {})
            base = pr.get('base', {})
            count = pr.get('changed_files')
            if (not isinstance(base, dict) or not re.fullmatch('[a-f0-9]{40}', str(base.get('sha', '')))
                    or not isinstance(head, dict) or pr.get('number') != number or pr.get('state') != 'open'
                    or head.get('sha') != candidate or head.get('ref') != record.identity['branch']
                    or not isinstance(head.get('repo'), dict) or head['repo'].get('full_name') != scope.repo
                    or type(count) is not int or not 0 <= count <= 1000):
                return
            rows = []
            for page in range(1, 12):
                batch = read(endpoint+f'/files?per_page=100&page={page}')
                if not isinstance(batch, list):
                    return
                rows.extend(batch)
                if len(batch) < 100:
                    break
            else:
                return
            current = read(endpoint)
            if (len(rows) != count or not isinstance(current, dict) or not isinstance(current.get('head'), dict)
                    or current['head'].get('sha') != candidate
                    or current.get('changed_files') != count or not isinstance(current.get('base'), dict)
                    or (current['base'].get('sha'), current['base'].get('ref')) != (base.get('sha'), base.get('ref'))):
                return
            actual = paths(rows)
        else:
            try:
                branch = read(f"repos/{scope.repo}/git/ref/heads/{record.identity['branch']}")
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                actual = set()  # No published task branch: only the current proposal exists.
            else:
                if branch.get('object', {}).get('sha') != candidate:
                    return
                origin = journal.state.get('branchOrigin')
                previous = getattr(scope, 'resume_from', None)
                from types import SimpleNamespace
                prior = SimpleNamespace(number=scope.number, repo=scope.repo,
                    digest=previous['digest'], identity=previous['authorization']) if previous else scope
                if not (origin_valid(origin, scope) or origin_valid(origin, prior)):
                    return
                delta = read(f"repos/{scope.repo}/compare/{origin['sha']}...{candidate}")
                if (delta.get('status') not in ('ahead', 'identical') or delta.get('merge_base_commit', {}).get('sha') != origin['sha']
                        or not isinstance(delta.get('files'), list) or len(delta['files']) >= 300):
                    return
                actual = paths(delta['files'])
        if actual is not None:
            record.control['file_scope'] = dict(identity=dict(record.identity), authorization=scope.identity, digest=scope.digest, paths=sorted(actual))
    except (OSError, KeyError, TypeError, ValueError, AttributeError):
        return  # Missing metadata cannot establish that no other file changed.


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
        if category == 'file_scope':
            from engine.evidence_contract import scope_constraint, scope_satisfied
            constraint = scope_constraint(req['text'])
            receipt = record.control.get('file_scope', {})
            if (receipt.get('identity') == record.identity and receipt.get('authorization') == scope.identity
                    and receipt.get('digest') == scope.digest
                    and scope_satisfied(constraint, set(receipt.get('paths', ())) | paths)):
                proof = dict(paths=sorted(set(receipt['paths']) | paths), guard='observed candidate and proposal stay within owned file restriction')
        elif category == 'authorization_boundary':
            from engine.evidence_contract import authorization_actions
            operations = authorization_actions(req['text'])
            base = f'https://api.github.com/repos/{scope.repo}/'
            probes = {
                'merge': (base + 'pulls/1/merge', {}, 'PUT'),
                'deploy': (base + 'actions/workflows/deploy-chat.yml/dispatches', {'ref': 'main'}, 'POST'),
                'release': (base + 'releases', {'tag_name': 'v0.0.0'}, 'POST'),
                'mark ready': ('https://api.github.com/graphql', {'query': 'mutation { markPullRequestReadyForReview(input:{pullRequestId:"untrusted"}){clientMutationId} }'}, 'POST'),
                'change permissions': (base + 'actions/permissions/workflow', {'default_workflow_permissions': 'write'}, 'PUT'),
                'advance phases': ('https://api.github.com/projects/columns/1/cards', {'note': 'advance'}, 'POST'),
            }
            denied = []
            for action in operations:
                url, payload, method = probes[action]
                try:
                    scope.permit(url, payload, method)
                except PermissionError:
                    denied.append(action)
            if (len(denied) == len(operations) and scope.release_pr is None
                    and ('advance phases' not in operations or not getattr(scope, 'queue_guard', None))):
                proof = dict(deniedOperations=denied, guard='active task denies these operations; external actors are not asserted')
        elif category == 'branch_hold':
            number = int(BRANCH_HOLD_RE.fullmatch(' '.join(req['text'].split()))[1])
            hold = record.control.get('branch_holds', {}).get(number)
            if hold and hold.get('authorization') == scope.identity and hold.get('digest') == scope.digest:
                branch = hold['branch']
                probes = [('git/refs/heads/' + quote(branch, safe='/'), {'sha': record.identity['candidate'], 'force': False}, 'PATCH'),
                          ('git/refs', {'ref': 'refs/heads/' + branch, 'sha': record.identity['candidate']}, 'POST'),
                          ('git/refs/heads/' + quote(branch, safe='/'), None, 'DELETE')]
                denied = 0
                for path, payload, method in probes:
                    try:
                        scope.permit(f'https://api.github.com/repos/{scope.repo}/{path}', payload, method)
                    except PermissionError:
                        denied += 1
                if denied == len(probes):
                    proof = dict(protectedPR=number, branch=branch, observedHead=hold['observedHead'],
                                 guard='active task denies protected-branch mutations; external actors not asserted')
        elif category == 'reporting':
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
            from engine.evidence_contract import EvidenceType
            evidence_type = (EvidenceType.DIFF if category == 'file_scope' else
                             EvidenceType.RUNTIME if category == 'reporting' else EvidenceType.AUTHORIZATION)
            req.update(met=True, evidence={'type': evidence_type.value,
                                          'controller_receipt': dict(record.identity, proof=proof)})
    return reqs

"""Candidate-bound reporting invariants; model text never supplies execution receipts."""
import hashlib
import re

ASK = 'Do not claim Docker/native/live tests unless actually run'
TYPES = {
    'docker': re.compile(r'\b(?:docker|sandbox)\b', re.I),
    'native': re.compile(r'\b(?:native|ios|iphone|xcode|simulator)\b', re.I),
    'live': re.compile(r'\blive\b', re.I),
    'device': re.compile(r'\b(?:real (?:device|iphone|ipad)|physical (?:device|iphone|ipad)|on (?:my|the|a) iphone)\b', re.I),
}
SUCCESS = re.compile(r'\b(?:passed|succeeded|successful|success|validated|completed|executed|performed|ran|built|compiled|tested|worked|checked)\b|\b(?:was|were|have|has)\s+(?:been\s+)?run\b', re.I)
FAILURE = re.compile(r'\b(?:failed|failure)\b', re.I)
NEGATIVE = re.compile(r'\b(?:not|never)\s+(?:been\s+)?(?:run|passed|executed|performed|validated|completed|tested|attempted)\b|\bno\s+(?:\w+[/-]?\s*){0,5}(?:were|was|have been)\s+run\b', re.I)


def constraint(text):
    return ' '.join(str(text or '').split()).rstrip('.').lower() == ASK.lower()


def requested(scope=None):
    from engine import intent_guard, requirements
    scope = scope or intent_guard.ACTIVE.get()
    return bool(scope and any(constraint(r['text']) for r in requirements.split(scope.body)))


def authority():
    from engine import operational_review
    observed = operational_review.authority()
    return observed if observed and requested(observed[3]) else None


def observe_pr(pr, repo, branch):
    observed = authority()
    if not observed or not isinstance(pr, dict):
        return
    _, record, _, scope = observed
    record.control.pop('claim_report', None)
    head = pr.get('head') or {}
    if (repo == scope.repo and branch == record.identity['branch'] and head.get('sha') == record.identity['candidate']
            and head.get('ref') == branch and (head.get('repo') or {}).get('full_name') == repo
            and pr.get('state') == 'open' and type(pr.get('number')) is int and 'body' in pr
            and (pr['body'] is None or isinstance(pr['body'], str))):
        text = (pr.get('title') or '') + '\n' + (pr['body'] or '')
        record.control['claim_report'] = dict(candidate=head['sha'], number=pr['number'], body=text,
            digest=hashlib.sha256(text.encode()).hexdigest())


def observe_ci(kind, candidate, run):
    observed = authority()
    if not observed or not isinstance(run, dict):
        return
    _, record, _, _ = observed
    if candidate != record.identity['candidate']:
        return
    origins = record.control.setdefault('claim_checks', {})
    origins[kind] = dict(candidate=candidate, **{k: run.get(k) for k in
        ('id', 'path', 'head_branch', 'event', 'display_title', 'status', 'conclusion')},
        repository=(run.get('repository') or {}).get('full_name'))


def receipts(observed):
    from engine import developer, native_build
    _, record, journal, scope = observed
    sha, branch = record.identity['candidate'], record.identity['branch']
    found = {}
    for kind, row in record.control.get('claim_checks', {}).items():
        expected_path, expected_title = ('.github/workflows/sandbox-tests.yml', developer.test_workflow(scope.repo, branch, sha)[1]) if kind == 'sandbox' else ('.github/workflows/ios-build.yml', native_build.title(branch, sha))
        if (kind not in ('sandbox', 'native') or scope.repo != developer.ROOT or row.get('candidate') != sha
                or row.get('repository') != developer.ROOT or row.get('path') != expected_path
                or row.get('head_branch') != 'main' or row.get('event') != 'workflow_dispatch'
                or row.get('display_title') != expected_title or type(row.get('id')) is not int
                or row.get('id', 0) <= 0 or row.get('status') != 'completed'):
            continue
        found['docker' if kind == 'sandbox' else 'native'] = dict(source='GitHub', runId=row['id'], conclusion=row.get('conclusion'))
    pending = record.control.get('claim_precommit') or {}
    if (pending.get('checkpoint') and pending.get('candidate') == sha
            and pending.get('checkpoint') == (journal.state.get('executionCheckpoint') or {}).get('hash')):
        found['docker'] = dict(source='sandbox checkpoint', checkpoint=pending['checkpoint'], conclusion='success')
    return found


def claimed(body, scope):
    from engine import requirements, task_state
    # Quoted owner instructions describe obligations, not an assertion that a check ran.
    texts = [r['text'] for r in requirements.split(scope.body)]
    goal, _ = task_state.current()
    if goal:
        texts += [r['text'] for r in requirements.split(goal.request)]
    for text in sorted(set(texts), key=len, reverse=True):
        if len(text) >= 12:
            body = body.replace(text, '')
    # Internal checkpoint fields/logs are typed state, not prose asserting an entire validation ran.
    # Fixed producer headings delimit this exception; validation-result markers are never stripped.
    if body.startswith(('### KappaForge recovery checkpoint', '### KappaForge execution checkpoint',
                        '### KappaForge is working on it', '### KappaForge PROGRESS.md',
                        '### KappaForge failure ledger', '### KappaForge recovery history')):
        body = re.sub(r'<!-- KAPPA_(?:RECOVERY(?:_ARCHIVE)?|EXECUTION|PROGRESS|FAILURES|TASK_STATE|PLAN|REQUIREMENTS|GENERATION)_V1 .*? -->', '', body, flags=re.S)
    claims = []
    for line in re.split(r'[\n;]|\bbut\b', body):
        clean = NEGATIVE.sub('', line)
        outcome = ('success' if SUCCESS.search(clean) else
                   'test_failure' if FAILURE.search(clean) and re.search(r'\btests?\b', clean, re.I) else
                   'failure' if FAILURE.search(clean) else None)
        if outcome:
            validation = re.search(r'\b(?:tests?|validation|checks?|checked|workflow|regression|smoke|compiled|built|simulator|KAPPA_VALIDATION_V1)\b', clean, re.I)
            claims += [(kind, outcome) for kind, pattern in TYPES.items()
                       if pattern.search(clean) and (validation or kind == 'device'
                           or re.search(pattern.pattern + r'\s*:?\s+(?:passed|succeeded|successful|success|validated|ran|tested|failed)\b', clean, re.I))]
    return claims


def guard(scope, payload):
    if not requested(scope) or not isinstance(payload, dict):
        return
    text = '\n'.join(payload[k] for k in ('title', 'body') if isinstance(payload.get(k), str))
    observed = authority()
    known = receipts(observed) if observed else {}
    for kind, outcome in claimed(text, scope):
        if known.get(kind, {}).get('conclusion') != outcome:
            raise PermissionError('Unverified validation claim: ' + kind)


def controller_proof():
    observed = authority()
    if not observed:
        return None
    goal, record, journal, scope = observed
    report = record.control.get('claim_report')
    if goal.receipt or journal.state.get('pr'):
        if not report or report.get('candidate') != record.identity['candidate']:
            return None
        try:
            guard(scope, {'body': report['body']})
        except PermissionError:
            return None
    return dict(policy='validation category claims require candidate-bound execution receipts',
                candidate=record.identity['candidate'], reportDigest=report.get('digest') if report else None,
                receipts=receipts(observed))


def observe_precommit(journal, data, session):
    observed = authority()
    if not observed or observed[2] is not journal:
        return
    _, record, _, scope = observed
    identity, controller = data.get('identity', {}), data.get('controller', {})
    results = controller.get('test_results') or []
    if (identity.get('repo') != scope.repo or identity.get('base') != record.identity['candidate']
            or identity.get('task') != scope.number or identity.get('scope') != scope.digest
            or controller.get('status') != 'success' or controller.get('stop_reason') != 'validated'
            or not results or any(r.get('status') != 'passed' for r in results)):
        return
    from engine.sandbox_tools import SandboxTools
    if not session or len(session.results) < len(results):
        return
    tools = SandboxTools(session)
    counts = [tools.inspect_test_results(i).get('counts', {}) for i in range(-len(results), 0)]
    if (any(r.status != 'passed' for r in session.results[-len(results):])
            or sum(max(0, r.get('ran', 0) - r.get('skipped', 0)) for r in counts) <= 0
            or not (journal.state.get('executionCheckpoint') or {}).get('hash')
            or not (data.get('patchRef') or {}).get('hash')):
        return
    record.control['claim_precommit'] = dict(candidate=record.identity['candidate'],
        checkpoint=journal.state['executionCheckpoint']['hash'], patch=(data.get('patchRef') or {}).get('hash'))


def published(parent, child, changes):
    from engine import execution
    observed = authority()
    if observed:
        _, record, journal, _ = observed
        pending = record.control.get('claim_precommit') or {}
        if (pending.get('candidate') == parent and pending.get('patch') == execution.digest(changes)
                and pending.get('checkpoint') == (journal.state.get('executionCheckpoint') or {}).get('hash')):
            record.control['claim_precommit'] = dict(pending, candidate=child)

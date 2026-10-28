"""Uncommitted execution checkpoints in the existing, task-authorized recovery journal.

Immutable bot-comment fragments hold exact patches; the journal publishes their receipt only
after all fragments are stored. Diagnostics are bounded and redacted before either boundary.
"""
import base64
import copy
import hashlib
import json
import os
import re
import shlex
import time

from engine import recovery, sandbox

MARKER = 'KAPPA_EXECUTION_V1'
HEADING = '### KappaForge execution checkpoint'
MAX_BYTES = 2_000_000
PART_CHARS = 40000
MAX_COMMANDS = 128


class CheckpointMismatch(PermissionError):
    """Saved authority or workspace changed; do not execute or overwrite the evidence."""


class CheckpointUnavailable(RuntimeError):
    category = 'execution_infrastructure'


def clean(value, limit=4000):
    text = sandbox.redact(str(value))
    text = re.sub(r'(?i)(https?://)[^/\s:@]+:[^/\s@]+@', r'\1[redacted]@', text)
    text = re.sub(r'(?i)(authorization\s*[:=]\s*(?:bearer|basic)\s+)\S+', r'\1[redacted]', text)
    return text[-limit:]


def task_digest(task):
    """The task's checkpoint identity. The owner's answers to KappaForge's questions (engine/clarification.py) are
    left out: answering resumes the same saved plan, candidate and sandbox state instead of invalidating them."""
    from engine.clarification import ANSWERS_HEADING
    return digest(str(task).split(ANSWERS_HEADING)[0])


def sanitized(value):
    if isinstance(value, str):
        return clean(value, len(value))
    if isinstance(value, list):
        return [sanitized(v) for v in value]
    if isinstance(value, dict):
        return {clean(k, 400): sanitized(v) for k, v in value.items()}
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def tree_digest(tree):
    return digest([(p, tree.modes.get(p, 0o644), hashlib.sha256(data).hexdigest())
                   for p, data in sorted(tree.files.items())])


def patch(session):
    return {p: None if data is None else data.decode('utf-8') for p, data in session.changes.items()}


def revision(session):
    return digest(dict(base=session.base.sha, tree=tree_digest(session.base), changes=patch(session)))


def _read_blob(journal, receipt):
    if (not isinstance(receipt, dict) or not re.fullmatch(r'[0-9a-f]{64}', receipt.get('hash', ''))
            or not isinstance(receipt.get('parts'), list) or not 0 < len(receipt['parts']) <= 70
            or any(type(n) is not int or n <= 0 for n in receipt['parts'])):
        raise CheckpointMismatch('Invalid execution checkpoint receipt; saved evidence retained')
    rows = {c['id']: c for c in recovery.comments(journal.read, journal.scope.number)}
    pieces = []
    for index, number in enumerate(receipt['parts']):
        row = rows.get(number, {})
        # Every comment the engine posts on its task issue gains one lifecycle trailer (intent_guard.report_provenance).
        # Only that exact trailer may follow the fragment; the fragment's JSON escapes < and >, so it cannot hide one.
        match = re.fullmatch(re.escape(HEADING) + r'\n\n<!-- ' + MARKER + r' (\{[^\n]*?\}) -->'
                             r'(?:\n<!-- kappa-lifecycle:\{[^\n<>]*\} -->)?', row.get('body', ''))
        try:
            part = json.loads(match[1]) if match else {}
        except ValueError:
            part = {}
        if (row.get('user', {}).get('login') != recovery.BOT
                or (part.get('task'), part.get('repo'), part.get('hash'), part.get('part'), part.get('total')) !=
                (journal.scope.number, journal.scope.repo, receipt['hash'], index, len(receipt['parts']))
                or not isinstance(part.get('data'), str) or len(part['data']) > PART_CHARS):
            raise CheckpointMismatch('Execution checkpoint fragment missing or untrusted; saved evidence retained')
        pieces.append(part['data'])
    try:
        raw = base64.b64decode(''.join(pieces), validate=True)
        if len(raw) > MAX_BYTES or hashlib.sha256(raw).hexdigest() != receipt['hash']:
            raise ValueError('hash')
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise CheckpointMismatch('Execution checkpoint content hash is invalid; saved evidence retained') from None


def _write_blob(journal, value, previous=None):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode()
    if len(raw) > MAX_BYTES:
        raise CheckpointMismatch('Execution checkpoint exceeds storage limit; no candidate data was truncated')
    fingerprint = hashlib.sha256(raw).hexdigest()
    if previous and previous.get('hash') == fingerprint:
        return previous
    text = base64.b64encode(raw).decode()
    chunks = [text[i:i + PART_CHARS] for i in range(0, len(text), PART_CHARS)]
    # Two slots rotate: a save rewrites the comments of the save before the live one, never the live one, so a run
    # that dies mid-save still has its last committed checkpoint. Task #269 posted 194 new checkpoint comments in
    # ten minutes before this; a long task would also have reached the 2,000-comment history limit.
    spare = [n for n in (previous or {}).get('spare', []) if _reusable(n)]
    parts = []
    for index, chunk in enumerate(chunks):
        body = HEADING + '\n\n<!-- ' + MARKER + ' ' + journal.wire(dict(
            task=journal.scope.number, repo=journal.scope.repo, hash=fingerprint,
            part=index, total=len(chunks), data=chunk)) + ' -->'
        if index < len(spare):
            journal.write(f'repos/{recovery.ROOT}/issues/comments/{spare[index]}', {'body': body}, 'PATCH')
            parts.append(spare[index])
        else:
            parts.append(journal.write(f'repos/{recovery.ROOT}/issues/{journal.scope.number}/comments', {'body': body}, 'POST')['id'])
    return dict(hash=fingerprint, parts=parts, spare=list((previous or {}).get('parts', [])))


def _reusable(number):
    """A comment this run posted itself: the authorization guard lets a task edit only its own comments."""
    from engine import intent_guard
    if type(number) is not int or number <= 0:
        return False
    scope = intent_guard.ACTIVE.get()
    return scope is None or str(number) in scope.own_comments


def pending(journal, kind=None):
    """Read trusted, hashed data. This never turns stored text into execution authority."""
    if not journal or not journal.state.get('executionCheckpoint'):
        return None
    if journal.state.get('executionPublished') == journal.state['executionCheckpoint']['hash']:
        return None
    data = _read_blob(journal, journal.state['executionCheckpoint'])
    identity = data.get('identity', {})
    accepted = {journal.scope.digest}
    if journal.scope.resume_from:
        accepted.add(journal.scope.resume_from['digest'])
    if (data.get('version') != 1 or identity.get('task') != journal.scope.number
            or identity.get('repo') != journal.scope.repo or identity.get('scope') not in accepted):
        raise CheckpointMismatch('Execution checkpoint belongs to different task authority')
    if kind and data.get('context', {}).get('kind') != kind:
        raise CheckpointMismatch('Execution checkpoint belongs to a different development stage')
    superseded = journal.state.get('supersededExecution') or {}
    if (superseded.get('hash') == journal.state['executionCheckpoint']['hash']
            and superseded.get('reason') == 'owner_reviewed_fast_forward'
            and re.fullmatch(r'[a-f0-9]{40}', str(superseded.get('replacement', '')))):
        return None  # Archived proposal, never a published or validated candidate.
    data['changes'] = _read_blob(journal, data['patchRef'])
    return data


def supersede_reviewed_proposal(journal, head):
    """Called only after recovery verifies owner guidance for a newer branch head."""
    data = pending(journal)
    if not data or data.get('context', {}).get('kind') != 'fix':
        return
    base = data['identity'].get('base')
    if base == head:
        return  # A proposal on the adopted head still needs its original validation.
    if not re.fullmatch(r'[a-f0-9]{40}', str(base)):
        raise CheckpointMismatch('Saved proposal base is unavailable; cannot retire it')
    comparison = journal.target_read(f'repos/{journal.scope.repo}/compare/{base}...{head}')
    if comparison.get('status') != 'ahead':
        raise CheckpointMismatch('Saved proposal is not an ancestor of the reviewed head')
    receipt = copy.deepcopy(journal.state['executionCheckpoint'])
    # Preserve complete rejected work before reusable fragment slots can rotate.
    journal.archive([dict(checkpoint=receipt, proposal=data, superseded_by=head)], 'supersededExecution')
    journal.state['supersededExecution'] = dict(hash=receipt['hash'], base=base, replacement=head,
                                               reason='owner_reviewed_fast_forward')


def seed(journal, repo, sha, changes, task, context=None):
    """Save generation before even fetching the sandbox tree (the fetch can fail too)."""
    if not journal:
        return
    require_storage(journal, repo)
    saved = pending(journal)
    if saved:
        if (saved['identity']['repo'], saved['identity']['base'], saved['identity']['taskHash']) != (repo, sha, task_digest(task)):
            raise CheckpointMismatch('Saved execution task or base revision changed; retained the original patch')
        return
    if sanitized(changes) != changes:
        raise CheckpointMismatch('Candidate contains credentials or private environment values; execution blocked')
    data = initial_data(dict(repo=repo, base=sha, tree=None, versions=None, commands=None, taskHash=task_digest(task),
                             task=journal.scope.number, scope=journal.scope.digest), task, {}, journal, context)
    data['patchRef'] = _write_blob(journal, changes)
    receipt = _write_blob(journal, sanitized(data))
    journal.state['executionCheckpoint'] = receipt
    journal.state['executionDiagnostics'] = data['diagnostics']
    journal.persist()


def initial_data(identity, task, state, journal, context):
    at = int((journal.clock() if journal else time.time()) * 1000)
    return dict(version=1, identity=identity, originalTask=task,
                requirements=list(journal.state.get('requirements', [])) if journal else [],
                context=context or {}, controller=state, commands=[], models=[], providerFailures=[],
                diagnostics=dict(stage='candidate', status='running', startedAt=at, updatedAt=at,
                                 finishedAt=0, attempt=0, finalValidation='pending', currentCommand=None,
                                 commands=[], attempts=[], history=[]))


def generation_plan(journal, repo, task):
    if not journal or not journal.state.get('generationPlan'):
        return None
    if journal.state.get('generationPlanPublished') == journal.state['generationPlan']['hash']:
        return None
    plan = _read_blob(journal, journal.state['generationPlan'])
    if (plan.get('task') != journal.scope.number or plan.get('repo') != repo
            or plan.get('scope') != journal.scope.digest or plan.get('taskHash') != task_digest(task)):
        raise CheckpointMismatch('Saved generation plan belongs to different task authority')
    return plan


def refresh_unpublished_main(journal):
    """Owner-receipted refresh of a never-published document task; preserve all spend/history."""
    if not journal or not journal.state.get('generationPlan'):
        return False
    scope, state = journal.scope, journal.state
    if (scope.repo != recovery.ROOT or getattr(scope, 'mode', None) != 'develop' or state.get('files') or state.get('pr')
            or state.get('executionPublication') or state.get('executionPublished')
            or state.get('authorization') != scope.identity or state.get('digest') != scope.digest):
        return False
    head = os.getenv('GITHUB_SHA', '')
    if not re.fullmatch('[a-f0-9]{40}', head) or head == state.get('candidate'):
        return False
    text = f'Refresh unpublished task #{scope.number} from reviewed main {head}; preserve cumulative budgets and archive saved work.'
    receipts = [row for row in recovery.comments(journal.read, scope.number)
                if row.get('user', {}).get('login', '').lower() == 'onlykappa' and row.get('body', '').strip() == text]
    if not receipts:
        return False
    from engine import inventory
    output = inventory.target(journal.issue.get('body', ''))
    if not output:
        raise CheckpointMismatch('Reviewed refresh requires one explicit new documentation output')
    main = journal.target_read(f'repos/{scope.repo}/git/ref/heads/main')['object']['sha']
    if main != head:
        raise CheckpointMismatch('Reviewed refresh must execute the exact current main engine')
    comparison = journal.target_read(f'repos/{scope.repo}/compare/{state["candidate"]}...{head}')
    added = comparison.get('commits') or []
    dates = [recovery._time(row.get('commit', {}).get('committer', {}).get('date')) for row in added]
    if (comparison.get('status') != 'ahead' or not 0 < len(added) <= recovery.MAX_ADOPTED_COMMITS
            or comparison.get('ahead_by') != len(added) or None in dates
            or not any((recovery._time(row.get('created_at')) or 0) >= max(dates) for row in receipts)):
        raise CheckpointMismatch('Reviewed refresh lacks a fresh owner receipt for a bounded fast-forward')
    from urllib.error import HTTPError
    for path in (f'repos/{scope.repo}/git/ref/heads/kappa/dev-{scope.number}',
                 f'repos/{scope.repo}/contents/{output}?ref={head}'):
        try:
            journal.target_read(path)
        except HTTPError as error:
            if error.code != 404:
                raise
        else:
            raise CheckpointMismatch('Reviewed refresh cannot replace an existing branch or document')
    if journal.target_read(f'repos/{scope.repo}/pulls?state=all&head=onlykappa:kappa/dev-{scope.number}&per_page=2'):
        raise CheckpointMismatch('Reviewed refresh cannot replace an existing task PR')
    proposal = pending(journal, 'develop')
    if proposal and (proposal['identity'].get('base') != state['candidate'] or set(proposal['changes']) != {output}):
        raise CheckpointMismatch('Saved proposal is outside the unpublished document refresh')
    keys = ('executionCheckpoint', 'executionDiagnostics', 'generationCheckpoint', 'generationPlan',
            'taskPlan', 'requirementClassification', 'branchOrigin', 'repairBatch')
    saved = {key: copy.deepcopy(state[key]) for key in keys if key in state}
    material = {key: _read_blob(journal, value) for key, value in saved.items()
                if isinstance(value, dict) and 'hash' in value and 'parts' in value}
    plan = material.get('generationPlan', {})
    if (plan.get('task') != scope.number or plan.get('repo') != scope.repo
            or plan.get('scope') != scope.digest or plan.get('base') != state['candidate']):
        raise CheckpointMismatch('Saved plan is not bound to the current task and candidate')
    if proposal:
        material['proposal'] = proposal
    # A failed archive leaves every live checkpoint intact. No counters or ledger are reset.
    journal.archive([dict(base=state['candidate'], replacement=head, receipts=saved, material=material)], 'reviewedUnpublished')
    previous = state['candidate']
    for key in keys:
        state.pop(key, None)
    state.update(candidate=head, unpublishedRefresh=dict(base=previous, replacement=head,
                 ownerReceipt=receipts[-1]['id'], archived=list(saved)))
    journal.event('Archived unpublished preparation for owner-reviewed main refresh',
                  strategy='refresh_unpublished_from_reviewed_main', outcome='recovering')
    return True


def save_plan(journal, repo, sha, task, context, sources):
    if not journal:
        return
    require_storage(journal, repo)
    plan = dict(task=journal.scope.number, repo=repo, scope=journal.scope.digest, base=sha,
                taskHash=task_digest(task), sourceHash=digest(sources), context=context)
    journal.state['generationPlan'] = _write_blob(journal, sanitized(plan), journal.state.get('generationPlan'))
    journal.persist()


def require_storage(journal, repo):
    if journal and repo != journal.scope.repo:
        raise CheckpointMismatch('Execution repository is outside the authorized task')
    if journal and repo != recovery.ROOT:
        private = journal.target_read(f'repos/{repo}').get('private', True)
        if private and not journal.read(f'repos/{recovery.ROOT}').get('private', False):
            raise CheckpointMismatch('Private candidate cannot be checkpointed on the public task tracker; private storage is required')


class Execution:
    def __init__(self, session, task, state, journal=None, context=None, progress=None):
        self.session, self.journal, self.progress = session, journal, progress
        require_storage(journal, session.base.repo)
        self.state, self.error = state, None
        saved = pending(journal)
        identity = dict(repo=session.base.repo, base=session.base.sha, tree=tree_digest(session.base),
                        versions=list(session.versions), commands=session.test_commands(), taskHash=task_digest(task),
                        task=journal.scope.number if journal else 0, scope=journal.scope.digest if journal else '')
        # JSON normalizes tuples to lists. Compare that canonical form on every restart.
        identity = json.loads(json.dumps(identity))
        if saved:
            if any(saved['identity'].get(k) != identity[k] for k in ('repo', 'base', 'taskHash')) or any(
                    saved['identity'].get(k) is not None and saved['identity'][k] != identity[k]
                    for k in ('tree', 'versions', 'commands')):
                raise CheckpointMismatch('Saved workspace, base revision, task or execution contract changed; no command ran')
            session.apply(saved['changes'])
            if saved.get('workspaceRevision') and revision(session) != saved['workspaceRevision']:
                raise CheckpointMismatch('Saved candidate patch does not match its workspace revision')
            self.state.update(saved['controller'])
            self.data = saved
            self.data['identity'] = identity
            self.data.pop('changes', None)
            session.results = [sandbox.RunResult(**row['result']) for row in self.data['commands'] if row.get('result')]
        else:
            self.data = initial_data(identity, task, state, journal, context)
        self.data['controller'] = self.state
        self.phase = self.state.get('phase', 'candidate')
        self._save()  # Durable candidate before the first install, test or model action.
        session.observer = self

    def now(self):
        return int((self.journal.clock() if self.journal else time.time()) * 1000)

    def _save(self):
        if self.error:
            raise self.error
        try:
            changes = patch(self.session)
            if sanitized(changes) != changes:
                raise CheckpointMismatch('Candidate contains credentials or private environment values; checkpoint and execution blocked')
            self.data['workspaceRevision'] = revision(self.session)
            self.data['infrastructure'] = dict(self.session.infrastructure)
            self.data['controller'] = self.state
            diagnostic = self.data['diagnostics']
            diagnostic['updatedAt'] = self.now()
            diagnostic['attempt'] = len(self.state.get('attempts', []))
            diagnostic['attempts'] = self.state.get('attempts', [])[-5:]
            # Exact code is kept only in the patch blob; UI history holds bounded evidence.
            diagnostic['attempts'] = [dict(index=a['index'], changed_paths=a.get('changed_paths', []),
                rationale=a.get('rationale', ''), why_different=a.get('why_different', ''),
                status=a.get('status', 'failed'), diagnostics=a.get('diagnostics', '')) for a in diagnostic['attempts']]
            diagnostic['commands'] = diagnostic['commands'][-6:]
            for row in diagnostic['commands']:
                row['log'] = clean(row.get('log', ''), 1000)
            diagnostic['history'] = diagnostic['history'][-10:]
            for row in diagnostic['history']:
                row['message'] = clean(row.get('message', ''), 500)
            for row in diagnostic['attempts']:
                row['changed_paths'] = row['changed_paths'][:12]
                row['diagnostics'] = clean(row['diagnostics'], 1000)
                row['rationale'] = clean(row['rationale'], 300)
                row['why_different'] = clean(row['why_different'], 500)
            diagnostic = sanitized(diagnostic)
            self.data['diagnostics'] = diagnostic
            if self.journal:
                self.data['providerUsage'] = copy.deepcopy(self.journal.state.get('providerUsage', {}))
                self.data['patchRef'] = _write_blob(self.journal, changes, self.data.get('patchRef'))
                # No truncation of controller state: stop if exact resume state will not fit.
                receipt = _write_blob(self.journal, sanitized(self.data), self.journal.state.get('executionCheckpoint'))
                self.journal.state['executionCheckpoint'] = receipt
                self.journal.state['executionDiagnostics'] = diagnostic
                from engine import report_claims
                report_claims.observe_precommit(self.journal, self.data, self.session)
                self.journal.persist()
            if self.progress:
                self.progress.execution_update(copy.deepcopy(diagnostic))
        except CheckpointMismatch:
            raise
        except Exception as exc:
            self.error = CheckpointUnavailable('Execution checkpoint could not be saved: ' + clean(type(exc).__name__ + ': ' + str(exc), 500))
            raise self.error from exc

    def transition(self, stage, status='running', message=''):
        self.phase = stage
        info = self.data['diagnostics']
        info.update(stage=stage, status=status)
        if status in ('running', 'passed'):
            info.update(errorCategory='', evidence='')
        if stage == 'final':
            info['finalValidation'] = status
        if status in ('passed', 'failed', 'blocked'):
            info['finishedAt'] = self.now()
        else:
            info['finishedAt'] = 0
        if message:
            info['history'] = (info['history'] + [dict(at=self.now(), stage=stage, status=status, message=clean(message, 1000))])[-20:]
        self._save()

    def changed(self):
        # A crash after apply_patch must test that new patch before asking for another edit.
        if revision(self.session) == self.data.get('workspaceRevision'):
            return
        self.state['phase'] = 'candidate'
        self.state['rationale'] = 'Recovered candidate change; test the saved patch before continuing'
        self._save()

    def key(self, argv, profile, source):
        return digest(dict(revision=revision(self.session), phase=self.phase, argv=argv, profile=profile, source=source))

    def cached(self, argv, profile, source):
        key = self.key(argv, profile, source)
        row = next((r for r in self.data['commands'] if r.get('key') == key and r.get('result')
                    and r['result']['status'] not in ('error',)), None)
        return sandbox.RunResult(**row['result']) if row else None

    def started(self, argv, profile, source, reusable=True):
        if len(self.data['commands']) >= MAX_COMMANDS:
            raise CheckpointMismatch('Execution command history limit reached; saved evidence retained')
        row = dict(key=self.key(argv, profile, source) if reusable else '', argv=argv, source=source,
                   profile=profile, status='running', startedAt=self.now(), finishedAt=0)
        self.data['commands'].append(row)
        self.data['diagnostics']['currentCommand'] = row.copy()
        self._save()
        self._feed(argv, profile, source, 'running')

    def _feed(self, argv, profile, source, status, output=''):
        """The command as a line of the task's live transcript: running, then its result and output tail."""
        if not self.progress or not argv or status not in ('running', 'passed', 'failed', 'blocked'):
            return  # A skipped toolchain ran nothing.
        command = clean(' '.join(shlex.quote(str(a)) for a in argv), 300)
        tool = 'test' if source != 'model' and profile == 'test' else 'run'
        text = ('Running ' if status == 'running' else 'Ran ') + command + ('' if status in ('running', 'passed') else ' (' + status + ')')
        self.progress.act('error' if status in ('failed', 'blocked') else 'test' if tool == 'test' else 'work', text,
                          tool=tool, detail=command, output=clean(output, 400) if output else '', status=status)

    def finished(self, result, reused=False):
        run = result.to_dict()
        run['truncated'] = run['truncated'] or any(len(run[name]) > 4000 for name in ('stdout', 'stderr'))
        for name in ('stdout', 'stderr'):
            run[name] = clean(run[name], 4000)
        info = self.data['diagnostics']
        counts = sandbox_tools_counts(self.session, result)
        run['test_counts'] = counts
        category = {'failed': 'dependency_install' if result.profile == 'install' else 'test_failure' if result.source != 'model' else 'command_failure',
                    'timeout': 'command_timeout', 'error': 'infrastructure', 'rejected': 'policy'}.get(result.status, '')
        row = dict(argv=result.argv, source=result.source, status='blocked' if result.status in ('error', 'rejected') else
                   'failed' if result.status == 'timeout' else result.status,
                   startedAt=int((recovery._time(result.started_at) or self.now() / 1000) * 1000),
                   finishedAt=int((recovery._time(result.finished_at) or self.now() / 1000) * 1000),
                   counts=counts, errorCategory=category, evidence=clean(result.reason or result.stderr or result.stdout, 1000),
                   log=clean(result.stdout + '\n' + result.stderr, 4000), reused=reused)
        if not reused:
            self.data['commands'][-1].update(result=run, status=row['status'], finishedAt=row['finishedAt'])
        info['currentCommand'] = row
        info['commands'] = (info['commands'] + [row])[-12:]
        self._feed(result.argv, result.profile, result.source, row['status'],
                   (result.stdout + '\n' + result.stderr).strip()[-400:])
        if category:
            info.update(errorCategory=category, evidence=row['evidence'])
        self._save()

    def model_failure(self, error):
        kind, _ = recovery.diagnose(error)
        self.data['providerFailures'] = (self.data['providerFailures'] + [dict(at=self.now(), category=kind, evidence=clean(error, 1000))])[-20:]
        self.data['diagnostics'].update(status='blocked', errorCategory=kind, evidence=clean(error, 1000), finishedAt=self.now())
        self._save()


def sandbox_tools_counts(session, result):
    from engine.sandbox_tools import SandboxTools
    index = next((i for i in range(len(session.results) - 1, -1, -1) if session.results[i] is result), -1)
    return SandboxTools(session).inspect_test_results(index).get('counts', {})

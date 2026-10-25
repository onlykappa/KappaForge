"""Task-bound recovery journal and an idempotent, bounded continuation queue.

Only trusted Actions bot comments carry executable queue state. Code checkpoints
remain on the task branch; comments contain diagnostics, hashes and requirements.
"""
import copy
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from contextvars import ContextVar
from engine.edit_errors import EditMismatch, SourceNotRead, GenerationFailure

CURRENT = ContextVar('recovery_journal', default=None)
SPLITTING = ContextVar('recovery_split_active', default=False)
MARKER = 'KAPPA_RECOVERY_V1'
ROOT = 'onlykappa/KappaForge'
MAX_CONTINUATIONS = 3
# Waiting out a provider limit or outage is not a failed attempt: those resumes have their own, larger allowance so a
# long task keeps going across rate limits. maxWaitSeconds and the authorization expiry still bound the total wait.
MAX_QUOTA_RESUMES = 12
QUOTA_KINDS = ('rate_limit', 'provider_outage')
WAIT_KINDS = QUOTA_KINDS + ('infrastructure',)
RECOVERY_SCAN_SECONDS = 300
MAX_EVENTS = 40
# GitHub comment content has a 65,536-character ceiling; UTF-8 bytes are
# conservatively capped below it, including heading, marker and summary.
MAX_COMMENT_BYTES = 60000
ARCHIVE_BYTES = 45000
BOT = 'github-actions[bot]'
OWNER = 'onlykappa'
# Owner review commits KappaForge continues from; more than this needs an explicit restart.
MAX_ADOPTED_COMMITS = 20


def _time(value):
    """A GitHub ISO timestamp in seconds, or None when it is missing or malformed."""
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None
SHA = re.compile(r'^[a-f0-9]{40}$')
DISPATCH_ACK_SECONDS = 120


def notify_wake(task):
    """Register a task-bound wake-up, never inference. Cron remains a fallback.

    The backend rereads trusted GitHub state; no prompts or arbitrary deadlines
    cross this boundary. A registration failure must not discard the checkpoint.
    """
    endpoint = os.getenv('KAPPA_ROUTER_URL', '').strip().rstrip('/')
    token = os.getenv('KAPPA_ROUTER_TOKEN', '')
    if not endpoint or not token:
        return
    if endpoint != 'https://kappaforge-chat.ballaking1738.workers.dev':
        print('Recovery wake-up skipped: unapproved backend origin', flush=True)
        return
    try:
        # Cloudflare refuses Python's default User-Agent (HTTP 403); every other gateway call names itself.
        request = urllib.request.Request(endpoint + '/router/recovery', data=json.dumps({'task': task}).encode(),
                                         headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                                                  'Accept': 'application/json', 'User-Agent': 'KappaForge-Recovery-Wake/1'})
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 202:
                raise ValueError('Unexpected wake-up acknowledgement')
    except urllib.error.HTTPError as error:
        print(f'Recovery wake-up registration HTTP {error.code}; saved checkpoint and scheduled fallback retained', flush=True)
    except (urllib.error.URLError, ValueError, TimeoutError) as error:
        category = 'timeout' if isinstance(error, TimeoutError) else 'network_or_response_failure'
        print(f'Recovery wake-up registration failed ({category}); saved checkpoint and scheduled fallback retained', flush=True)


def clean(value, size=700):
    from engine.sandbox import redact
    value = redact(str(value))
    return value[:size].encode('utf-8', 'backslashreplace').decode('utf-8')


def diagnose(error):
    """Deterministic failure class and a different, relevant next strategy."""
    from engine.reliability import RecoveryBudgetExceeded, ProviderResponseError
    if getattr(error, 'category', '') == 'execution_infrastructure':
        return 'infrastructure', 'wait_for_infrastructure'
    if getattr(error, 'category', '') == 'execution_resource':
        return 'infrastructure_policy', 'stop'
    if isinstance(error, RecoveryBudgetExceeded):
        return 'recovery_budget', 'stop' if error.terminal else 'checkpoint_and_continue'
    if isinstance(error, ProviderResponseError):
        return 'invalid_response', 'switch_or_defer'
    if getattr(error, 'category', '') == 'repair_review':
        return 'repair_review', 'stop'
    if getattr(error, 'code', '') == 'request_too_large' or type(error).__name__ == 'GatewayRequestTooLarge':
        return 'request_size', 'reduce_source_context'
    # Source snippets and filenames are evidence, not authorization decisions.
    # Task #191's missing anchor included the literal route "/authorization".
    if isinstance(error, EditMismatch):
        return 'edit_anchor', 'reread_source'
    if isinstance(error, SourceNotRead):
        return 'missing_context', 'read_dependencies'
    if isinstance(error, GenerationFailure):
        if error.blocked:
            return 'authorization', 'stop'
        return ('provider_outage', 'switch_or_defer') if error.provider_routes else ('validation', 'smaller_stages')
    text = str(error).lower()
    if not isinstance(error, PermissionError) and getattr(error, 'provider_routes', False):
        return 'provider_outage', 'switch_or_defer'
    if isinstance(error, PermissionError) or any(x in text for x in ('authorization', 'unauthorized', 'protected path', 'unsafe path', 'forbidden path', 'blocked path')):
        return 'authorization', 'stop'
    if isinstance(error, json.JSONDecodeError):
        truncated = error.pos >= len(error.doc.rstrip()) - 2 or 'unterminated' in text
        return ('truncated_output', 'shrink_output') if truncated else ('malformed_json', 'repair_serialization')
    rules = [
        ('task execution deadline', 'task_deadline', 'checkpoint_and_continue'),
        ('5-hour-50-minute', 'task_deadline', 'checkpoint_and_continue'),
        ('four-minute', 'model_deadline', 'compact_and_switch'),
        ('matched ', 'edit_anchor', 'reread_source'),
        ('not read', 'missing_context', 'read_dependencies'),
        ('syntax check', 'syntax', 'repair_syntax'),
        ('repeated rejected', 'repeated_proposal', 'switch_model'),
        ('http 401', 'access', 'stop'),
        ('http 403', 'access', 'stop'),
        ('429', 'rate_limit', 'wait_for_provider'),
        ('rate-limit', 'rate_limit', 'wait_for_provider'),
        ('timeout', 'provider_outage', 'switch_or_defer'),
        ('offline', 'provider_outage', 'switch_or_defer'),
        ('routes unavailable', 'provider_outage', 'switch_or_defer'),
        ('no approved flash', 'provider_outage', 'switch_or_defer'),
        ('tests failed', 'behavioral', 'repair_from_test_evidence'),
        ('assertion', 'behavioral', 'repair_from_test_evidence'),
        ('expected', 'schema', 'regenerate_schema'),
        ('files list', 'schema', 'regenerate_schema'),
    ]
    for match, kind, strategy in rules:
        if match in text:
            return kind, strategy
    if isinstance(error, urllib.error.HTTPError):
        return ('access', 'stop') if error.code in (401, 403, 404) else ('provider_outage', 'switch_or_defer')
    if isinstance(error, (TimeoutError, urllib.error.URLError, ConnectionError)):
        return 'provider_outage', 'switch_or_defer'
    return 'validation', 'smaller_stages'


def comments(read, number):
    result = []
    for page in range(1, 21):
        batch = read(f'repos/{ROOT}/issues/{number}/comments?per_page=100&page={page}')
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise ValueError('Recovery history exceeds the supported inspection limit')


class Journal:
    def __init__(self, issue, read, write, clock=time.time):
        from engine.intent_guard import ExecutionScope
        self.scope = ExecutionScope(issue, now=clock())
        if self.scope.mode != 'develop':
            raise PermissionError('Recovery queue only supports authorized development tasks')
        from engine.projects import registered
        self.project = registered(self.scope.repo)
        self.issue, self.read, self.write, self.clock = issue, read, write, clock
        self.ledger, self.ledger_rows = {}, []
        self.comment = None
        self.renewed_scope = False
        accepted_digests = {self.scope.digest}
        if self.scope.resume_from:
            accepted_digests.add(self.scope.resume_from['digest'])
        self.state = dict(version=1, task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest,
                          authorization=self.scope.identity, candidate='', base='', pr='', status='running',
                          run=os.getenv('GITHUB_RUN_ID', ''), continuations=0, nextAt=0, updatedAt=clock(),
                          requirements=[], events=[], rejected={}, files=[], expiresAt=int(self.scope.expires * 1000))
        all_comments = comments(read, self.scope.number)
        conflicting_checkpoint = False
        for comment in all_comments:
            if comment.get('user', {}).get('login') != BOT or not (comment.get('body') or '').startswith('### KappaForge recovery checkpoint\n'):
                continue
            match = re.search(r'<!-- ' + MARKER + r' (.*?) -->', comment.get('body') or '')
            if not match:
                continue
            try:
                state = json.loads(match[1])
                same_scope = state.get('digest') == self.scope.digest and state.get('authorization') == self.scope.identity
                renewed_scope = self.scope.resume_from == {'digest': state.get('digest'), 'authorization': state.get('authorization')}
                valid = (state['version'] == 1 and state['task'] == self.scope.number and state['repo'] == self.scope.repo
                         and (same_scope or renewed_scope)
                         and isinstance(state['events'], list) and len(state['events']) <= MAX_EVENTS
                         and isinstance(state['requirements'], list) and len(state['requirements']) <= 100
                         and isinstance(state['rejected'], dict) and len(state['rejected']) <= MAX_EVENTS
                         and isinstance(state['continuations'], int) and 0 <= state['continuations'] <= MAX_CONTINUATIONS + MAX_QUOTA_RESUMES
                         and 0 <= state.get('quotaResumes', 0) <= min(state['continuations'], MAX_QUOTA_RESUMES))
                if valid:
                    if renewed_scope:
                        state = dict(state, digest=self.scope.digest, authorization=self.scope.identity, expiresAt=int(self.scope.expires*1000))
                        self.renewed_scope = True
                    self.state, self.comment = state, comment['id']
                elif state.get('task') == self.scope.number and state.get('repo') == self.scope.repo:
                    conflicting_checkpoint = True
            except (ValueError, KeyError, TypeError):
                continue
        if conflicting_checkpoint and not self.comment:
            raise PermissionError('Saved checkpoint scope changed; explicit owner reconciliation is required')
        if 'budgets' not in self.state:
            self.state['budgets'] = dict(edits=sum(self.state['rejected'].values()),
                                         modelCalls=sum(bool(e.get('model')) for e in self.state['events']) + self.state.get('archivedEvents', 0))
            self.state['budgetMigration'] = 'legacy-inferred' if self.comment else 'new'
        reference = self.state.get('requirementsRef')
        if reference:
            catalog = next((row for row in all_comments if row.get('id') == reference and row.get('user', {}).get('login') == BOT
                            and (row.get('body') or '').startswith('### KappaForge requirement catalog\n')), None)
            match = re.search(r'<!-- KAPPA_REQUIREMENTS_V1 (.*?) -->', catalog['body']) if catalog else None
            blob = json.loads(match[1]) if match else {}
            if (blob.get('task'), blob.get('repo')) != (self.scope.number, self.scope.repo) or blob.get('digest') not in accepted_digests:
                raise ValueError('Referenced requirement catalog is unavailable; saved checkpoint retained')
            self.state['requirements'] = blob['requirements']
            if self.renewed_scope:
                self.state.pop('requirementsRef', None)
                self.state.pop('requirementsHash', None)
        # Legacy reviews mixed diagnostic hypotheses into the owner requirement ledger.
        # Keep that catalog for audit; rebuild only from the unchanged owner task.
        if self.state.get('requirementOrigin') != 'owner-v2':
            self.state['legacyRequirements'] = self.state['requirements']
            self.state['requirements'] = []
            self.state['requirementOrigin'] = 'owner-v2'
        for comment in all_comments:
            if comment.get('user', {}).get('login') != BOT or not (comment.get('body') or '').startswith('### KappaForge failure ledger\n'):
                continue
            match = re.search(r'<!-- KAPPA_FAILURES_V1 (.*?) -->', comment.get('body') or '')
            try:
                part = json.loads(match[1]) if match else {}
                if part.get('digest') in accepted_digests and part.get('repo') == self.scope.repo and part.get('task') == self.scope.number:
                    self.ledger.update(part['records'])
                    self.ledger_rows.append((comment['id'], part))
            except (ValueError, KeyError, TypeError):
                continue
        self._committed = copy.deepcopy(self.state)
        self.loader = None
        from engine import progress_notes
        self.notes = progress_notes.load(all_comments, self.scope.number, self.scope.repo, clean)
        # Only the validated, trusted journal comment may be edited across runs.
        from engine.intent_guard import ACTIVE
        active = ACTIVE.get()
        if active and active.digest == self.scope.digest and self.comment:
            active.own_comments.add(str(self.comment))
            active.own_comments.update(str(row[0]) for row in self.ledger_rows)
        if active and active.digest == self.scope.digest and self.notes.comment:
            active.own_comments.add(str(self.notes.comment))

    @staticmethod
    def wire(value):
        return json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8', 'backslashreplace').decode('utf-8').replace('<', '\\u003c').replace('>', '\\u003e')

    def archive(self, events, kind='events'):
        # Split large records before issuing any write. The full data remains
        # outside the active checkpoint, with a deterministic structured summary.
        text = self.wire(events)
        chunks = [text[i:i + ARCHIVE_BYTES // 6] for i in range(0, len(text), ARCHIVE_BYTES // 6)]
        for index, chunk in enumerate(chunks):
            part = dict(task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest,
                        kind=kind, archiveId=hashlib.sha256(text.encode()).hexdigest(), part=index, total=len(chunks), data=chunk,
                        summary={'records':len(events), 'candidate':self.state['candidate']})
            if len(chunks) == 1 and kind == 'events' and len(text.encode('utf-8')) < 12000:
                part['events'] = events
            # data is already JSON text; escaping its quotes can expand it.
            body = '### KappaForge recovery history\n\n<!-- KAPPA_RECOVERY_ARCHIVE_V1 ' + self.wire(part) + ' -->'
            if len(body.encode('utf-8')) > MAX_COMMENT_BYTES:
                raise ValueError('Archive fragment exceeds storage budget; previous checkpoint retained')
            self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments', {'body':body}, 'POST')

    def body(self, state):
        last = state['events'][-1] if state['events'] else {}
        return ('### KappaForge recovery checkpoint\n\nStatus: ' + state['status'] +
                '\nCandidate: ' + (state['candidate'] or 'no code saved yet') +
                '\nNext action: ' + last.get('next', 'Continue the authorized task') +
                '\n\n<!-- ' + MARKER + ' ' + self.wire(state) + ' -->')

    def persist(self):
        from engine.reliability import RecoveryCoordinator
        from engine import task_state
        task_state.save(self)
        draft = copy.deepcopy(self.state)
        try:
            if self.renewed_scope:
                for row, part in self.ledger_rows:
                    part['digest'] = self.scope.digest
                    self.write(f'repos/{ROOT}/issues/comments/{row}', {'body':'### KappaForge failure ledger\n\n<!-- KAPPA_FAILURES_V1 '+self.wire(part)+' -->'}, 'PATCH')
                self.renewed_scope = False
            execution = RecoveryCoordinator.state(draft['status'])
            if execution not in RecoveryCoordinator.STATES:
                raise ValueError('Unknown recovery state: ' + str(draft['status']))
            if draft['status'] == 'blocked' and draft['events']:
                last = draft['events'][-1]
                if last.get('kind') in ('authorization', 'access'):
                    execution = 'blocked_authorization'
                elif last.get('kind') == 'recovery_budget' and last.get('strategy') == 'stop':
                    execution = 'failed_terminal'
            previous = self._committed.get('executionState', 'queued')
            RecoveryCoordinator.transition(previous, execution, resuming=getattr(self, '_resuming', False))
            draft.update(updatedAt=self.clock(), executionState=execution)
            # Compact optional legacy catalogs before active execution state.
            if draft.get('legacyRequirements') and len(self.body(draft).encode('utf-8')) > MAX_COMMENT_BYTES:
                self.archive(draft['legacyRequirements'], 'legacyRequirements')
                draft['legacyRequirements'] = []
                draft['legacyRequirementsArchived'] = True
            runtime_requirements = list(draft['requirements'])
            if len(self.body(draft).encode('utf-8')) > MAX_COMMENT_BYTES and len(self.wire(runtime_requirements).encode('utf-8')) > 12000:
                blob = dict(task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest, requirements=runtime_requirements)
                body = '### KappaForge requirement catalog\n\n<!-- KAPPA_REQUIREMENTS_V1 ' + self.wire(blob) + ' -->'
                if len(body.encode('utf-8')) > MAX_COMMENT_BYTES:
                    raise ValueError('Requirement catalog exceeds storage backend budget')
                digest = hashlib.sha256(self.wire(runtime_requirements).encode()).hexdigest()
                if draft.get('requirementsHash') != digest or not draft.get('requirementsRef'):
                    draft['requirementsRef'] = self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments', {'body':body}, 'POST')['id']
                    draft['requirementsHash'] = digest
                draft['requirements'] = []
            while len(draft['events']) > MAX_EVENTS or len(self.body(draft).encode('utf-8')) > MAX_COMMENT_BYTES:
                if len(draft['events']) < 2:
                    raise ValueError('Execution-critical checkpoint exceeds storage budget; previous checkpoint retained')
                count = max(1, min(len(draft['events']) - 1, MAX_EVENTS // 2))
                removed = draft['events'][:count]
                self.archive(removed)
                draft['events'] = draft['events'][count:]
                draft['archivedEvents'] = draft.get('archivedEvents', 0) + count
                summary = draft.setdefault('historySummary', {})
                for item in removed:
                    key = item.get('kind', 'legacy')
                    summary[key] = summary.get(key, 0) + 1
            if draft['requirements'] or not runtime_requirements:
                draft.pop('requirementsRef', None)
                draft.pop('requirementsHash', None)
            body = self.body(draft)  # Validate the complete payload before replacement.
            if self.comment:
                self.write(f'repos/{ROOT}/issues/comments/{self.comment}', {'body':body}, 'PATCH')
            else:
                self.comment = self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments', {'body':body}, 'POST')['id']
            draft['requirements'] = runtime_requirements
            self.state = draft
            self._committed = copy.deepcopy(draft)
        except Exception:
            self.state = copy.deepcopy(self._committed)
            raise

    def remember(self, item, key):
        prior = self.ledger.get(key, {})
        run_id = os.environ.get('GITHUB_RUN_ID', '')
        repository = os.environ.get('GITHUB_REPOSITORY', ROOT)
        run_url = (os.environ.get('GITHUB_SERVER_URL', 'https://github.com').rstrip('/') + '/' + repository +
                   '/actions/runs/' + run_id) if run_id.isdigit() and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) else ''
        diagnostic = {name: item.get(name) for name in ('at', 'candidate', 'kind', 'error', 'model', 'strategy', 'outcome', 'next', 'files') if item.get(name) is not None}
        if run_url:
            diagnostic['runUrl'] = run_url
        history = (prior.get('history', []) + [diagnostic])[-10:]
        record = dict(item, task=self.scope.number, repo=self.scope.repo,
                      branch=f'kappa/dev-{self.scope.number}', operation=item.get('operation', 'edit' if key else 'model'),
                      files=item.get('files', list(self.state['files'])), fingerprint=key,
                      provider=item.get('model', '').split(':', 1)[0], cause=item.get('error', ''),
                      rejectedStrategies=list(dict.fromkeys(prior.get('rejectedStrategies', []) + [item.get('strategy', '')]))[-10:],
                      attempts=prior.get('attempts', 0) + 1, history=history, runUrl=run_url,
                      expiresAt=self.clock() + 300 if item.get('kind') in ('provider_outage', 'rate_limit', 'model_deadline') else self.scope.expires)
        shard = copy.deepcopy(self.ledger_rows[-1][1]) if self.ledger_rows else dict(
            task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest, records={})
        row = self.ledger_rows[-1][0] if self.ledger_rows else None
        shard['records'][key] = record
        if len(self.wire(shard).encode('utf-8')) > ARCHIVE_BYTES:
            shard = dict(task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest, records={key:record})
            row = None
        body = '### KappaForge failure ledger\n\n<!-- KAPPA_FAILURES_V1 ' + self.wire(shard) + ' -->'
        if len(body.encode('utf-8')) > MAX_COMMENT_BYTES:
            raise ValueError('Failure record exceeds storage budget')
        if row:
            self.write(f'repos/{ROOT}/issues/comments/{row}', {'body':body}, 'PATCH')
            self.ledger_rows[-1] = (row, shard)
        else:
            row = self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments', {'body':body}, 'POST')['id']
            self.ledger_rows.append((row, shard))
        self.ledger[key] = record

    def event(self, error='', model='', strategy='', outcome='recovering', next_action='', signature=''):
        from engine import task_state
        task_state.failure(error, model)
        kind, default = diagnose(error)
        item = dict(at=self.clock(), candidate=self.state['candidate'], kind=kind, error=clean(error, 500),
                    model=clean(model, 140), strategy=strategy or default, outcome=outcome,
                    next=clean(next_action or strategy or default, 240))
        item['context'] = getattr(self, 'context', '')
        if signature.startswith('provider-request:'):
            item['operation'] = 'provider_request'
        if getattr(error, 'path', ''):
            item['files'] = [error.path]
        if signature:
            key = hashlib.sha256((self.state['candidate'] + signature).encode('utf-8', 'backslashreplace')).hexdigest()
            self.state['rejected'][key] = self.state['rejected'].get(key, 0) + 1
            while len(self.state['rejected']) > MAX_EVENTS:
                del self.state['rejected'][next(iter(self.state['rejected']))]
            item['signature'] = key
            self.remember(item, key)
        item.setdefault('operation', 'edit' if signature else 'test' if kind == 'behavioral' else 'model' if model else 'recovery')
        if not signature:
            self.remember(item, hashlib.sha256(self.wire(item).encode()).hexdigest())
        self.state['events'].append(item)
        self.state['status'] = outcome
        self.persist()
        return item

    def avoid_models(self, context=None):
        counts = {}
        records = list(self.ledger.values()) or self.state['events']
        for item in records:
            if item.get('operation') == 'provider_request' or (context is not None and item.get('context') not in (None, '', context)):
                continue
            if item.get('expiresAt', self.scope.expires) > self.clock() and item.get('candidate') == self.state['candidate'] and item.get('outcome') == 'recovering' and item.get('model'):
                counts[item['model']] = counts.get(item['model'], 0) + item.get('attempts', 1)
        return {m for m, count in counts.items() if count >= 2}

    def rejected(self, signature):
        key = hashlib.sha256((self.state['candidate'] + signature).encode('utf-8', 'backslashreplace')).hexdigest()
        return key in self.state['rejected'] or key in self.ledger

    def checkpoint(self, sha, base='', pr='', files=()):
        if not SHA.fullmatch(sha):
            raise ValueError('Checkpoint requires a full candidate SHA')
        if sha != self.state['candidate']:
            self.state['rejected'] = {}
            self.state.pop('waitingSince', None)
        self.state.update(candidate=sha, base=base or self.state['base'], pr=pr or self.state['pr'],
                          files=sorted(set(files) | set(self.state['files'])), status='running')
        from engine import task_state
        task_state.checkpoint(sha, files)
        self.persist()

    def note(self, **changes):
        """Update the task's PROGRESS.md comment. Best effort: a failed note never stops the task."""
        try:
            self.notes.update(clock=self.clock, **changes)
            self.notes.save(self.write, ROOT, self.scope.number)
        except Exception as error:  # noqa: BLE001 - notes are advisory
            print('Progress note not saved: ' + clean(error, 160), flush=True)

    def stop(self, error):
        """Persist the real cause and checkpoint without masking the caller's error."""
        try:
            self.event(error, outcome='blocked', strategy='stop',
                       next_action='Review the saved draft and failure evidence')
        except Exception as diagnostic_error:
            print('Failure checkpoint could not be saved (' + type(diagnostic_error).__name__ + ')', flush=True)
        self.note(stop={'reason': clean(error, 240),
                        'next': 'Review saved draft ' + self.state.get('pr', '')},
                  status='Stopped before completion: ' + clean(error, 180) +
                         '; saved candidate ' + self.state.get('candidate', ''))
        try:
            self.publish('blocked', 'Automatic recovery stopped: ' + clean(error, 180))
        except Exception as diagnostic_error:
            print('Failure progress could not be published (' + type(diagnostic_error).__name__ + ')', flush=True)

    def resumes_left(self, kind):
        """Automatic continuations still available for a failure of this kind."""
        quota = self.state.get('quotaResumes', 0)
        if kind in WAIT_KINDS:
            return MAX_QUOTA_RESUMES - quota
        return MAX_CONTINUATIONS - (self.state['continuations'] - quota)

    def requirements(self, values):
        merged = list(dict.fromkeys(self.state['requirements'] + list(values)))
        if len(merged) > 100 or any(not isinstance(v, str) or len(v) > 4000 for v in merged) or sum(map(len, merged)) > 12000:
            raise ValueError('Requirement catalog cannot be safely checkpointed')
        self.state['requirements'] = merged
        self.persist()
        return merged

    def capacity_notice(self, error, retry_at=0, stopped=False):
        """Tell the owner, once per waiting episode, that every usable free route is exhausted. No paid route is tried."""
        episode = 'stopped' if stopped else str(self.state.get('waitingSince', ''))
        if self.state.get('capacityNotice') == episode:
            return ''
        self.state['capacityNotice'] = episode
        when = (' Next automatic retry: ' + time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(retry_at)) + '.') if retry_at and not stopped else ''
        text = ('Free model capacity is exhausted: every authorized free route is rate-limited, out of quota or unavailable ('
                + clean(error, 200) + '). No paid model was used.' + (when or (' Automatic retries have stopped; reply with Guidance or retry later.'
                if stopped else '')))
        from engine.runner import notify
        notify(f'⏸️ KappaForge #{self.scope.number}: {text}\nhttps://github.com/{ROOT}/issues/{self.scope.number}')
        return text

    def defer(self, error):
        kind, _ = diagnose(error)
        if (self.scope.inference_route or kind in ('authorization', 'access') or getattr(error, 'terminal', False) or self.state.get('routingAvailability', {}).get('terminal')
                or self.resumes_left(kind) <= 0 or self.scope.expires <= self.clock() + 1200):
            self.event(error, model=self.scope.inference_route or '', strategy='stop', outcome='blocked',
                       next_action='Owner review required; automatic continuations exhausted or access blocked')
            self.note(stop={'reason': clean(error, 240), 'next': 'Stopped; needs the owner'}, status='Stopped: needs your review')
            if kind in QUOTA_KINDS and getattr(error, 'provider_routes', False):
                notice = self.capacity_notice(error, stopped=True)
                if notice:
                    self.publish('blocked', notice)
            return False
        now = self.clock()
        self.state.setdefault('waitingSince', now)
        availability = self.state.get('routingAvailability', {})
        # Only a real provider limit is a cooldown. Other failures (a rejected proposal, a timeout of this run)
        # continue on the next recovery scan with other free models; there is nothing to wait out.
        provider_limit = kind in WAIT_KINDS or bool(getattr(error, 'retry_at', 0))
        known_reset = max(getattr(error, 'retry_at', 0), availability.get('retryAt', 0))
        # Nothing to wait out without a provider limit: continue at once. With one, resume just after the provider's
        # own reset time; only an unknown reset falls back to a short minute.
        minimum_wait = 0 if not provider_limit else (0 if known_reset else 60)
        due = max(now + minimum_wait, known_reset + 5 if known_reset else 0)
        end = min(self.scope.expires - 1200, self.state['waitingSince'] + self.project.get('maxWaitSeconds', 21600))
        if due > end:
            self.event(error, outcome='paused', strategy='stop', next_action='Waiting deadline reached; renew authorization or provider access')
            self.note(stop={'reason': clean(error, 240), 'next': 'Waiting deadline reached'}, status='Paused: waited too long for a provider')
            if kind in QUOTA_KINDS:
                notice = self.capacity_notice(error, stopped=True)
                if notice:
                    self.publish('blocked', notice)
            return False
        self.state['nextAt'] = due
        self.state['quotaWait'] = kind in WAIT_KINDS
        self.state['waitReason'] = ('retry' if getattr(error, 'gateway_failure', False)
                                    and max(getattr(error, 'retry_at', 0), availability.get('retryAt', 0)) <= now
                                    else 'cooldown' if provider_limit else 'continue')
        self.event(error, model=self.scope.inference_route or '', strategy='checkpoint_and_continue', outcome='waiting',
                   next_action='Resume saved work on the next recovery scan (scheduled every 5 minutes; GitHub may delay it)')
        self.note(stop={'reason': clean(error, 240), 'next': 'Resume ' + time.strftime('%H:%M UTC', time.gmtime(due))
                        + ' with the next available model'}, status='Paused for a provider limit; resumes automatically'
                  if kind in QUOTA_KINDS else 'Paused; resumes automatically')
        # The wait honours the providers' own retry times (`due` above), so exhausted quota is not retried blindly.
        notice = self.capacity_notice(error, due) if kind in QUOTA_KINDS else ''
        messages = {'cooldown': 'Progress saved. Waiting for the recorded provider cooldown.',
                    'retry': 'Progress saved. Gateway retry scheduled; provider quota remaining is unknown.',
                    'continue': 'Progress saved. No provider limit is involved; the next attempt starts on the next recovery scan '
                                'with the available free models.'}
        self.publish('waiting' if self.state['waitReason'] == 'cooldown' else 'queued',
                     ((notice + ' ') if notice else '') + messages[self.state['waitReason']])
        notify_wake(self.scope.number)
        return True

    def publish(self, status, message):
        at = int(self.clock() * 1000)
        last = self.state['events'][-1] if self.state['events'] else {}
        execution = self.state.get('executionState', status)
        status = {'paused':'blocked','blocked_authorization':'blocked','needs_clarification':'blocked','failed_terminal':'failed','waiting_for_provider':'waiting','validating':'testing'}.get(status, status)
        finished = at if status == 'ready' else 0
        snapshot = dict(version=1, taskId=str(self.scope.number), attemptId=f"recovery:{self.state['continuations']}:{at}",
                        attemptAt=at, revision=1, status=status, updatedAt=at, startedAt=at, finishedAt=finished,
                        steps=[dict(id='recovery', title=message, detail=last.get('error', ''), status='completed' if status == 'ready' else status,
                                    startedAt=at, finishedAt=finished)], activity=[], findings=[], units=None,
                        recovery=dict(executionState='dispatch_requested' if self.state['status']=='dispatching' else execution, lastTransitionAt=at, scanIntervalSeconds=RECOVERY_SCAN_SECONDS, candidate=self.state['candidate'], nextAt=int(self.state['nextAt'] * 1000),
                                      continuations=self.state['continuations'], expiresAt=int(self.scope.expires * 1000), last=last))
        if self.state.get('executionDiagnostics'):
            from engine.execution import sanitized
            diagnostic = copy.deepcopy(self.state['executionDiagnostics'])
            if status in ('waiting', 'queued', 'blocked', 'failed'):
                diagnostic.update(status='blocked', finishedAt=at, errorCategory=last.get('kind', 'interruption'),
                                  evidence=last.get('error', message))
                if (diagnostic.get('currentCommand') or {}).get('status') == 'running':
                    diagnostic['currentCommand'].update(status='blocked', finishedAt=at)
            snapshot['execution'] = sanitized(diagnostic)
        wire = json.dumps(snapshot, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e')
        self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments',
                   {'body': '### KappaForge is working on it\n\n<!-- KAPPA_PROGRESS_V1 ' + wire + ' -->\n' + message}, 'POST')

    def target_read(self, path):
        if self.scope.repo == ROOT:
            return self.read(path)
        from engine.projects import access
        from engine.runner import github
        try:
            return github(path, access(self.scope.repo, os.getenv('GITHUB_TOKEN', '')))
        except urllib.error.HTTPError as error:
            if error.code in (401, 403, 404):
                raise PermissionError('Project access denied or unavailable for ' + self.scope.repo + ' (HTTP ' + str(error.code) + ')') from None
            raise

    def check_project_access(self):
        from engine.projects import branch_allowed
        if not branch_allowed(self.scope.repo, f'kappa/dev-{self.scope.number}'):
            raise PermissionError('Project branch policy does not permit this task branch')
        if self.scope.repo != ROOT:
            # GET proves the configured credential reaches this exact project.
            metadata = self.target_read(f'repos/{self.scope.repo}')
            if metadata.get('full_name') != self.scope.repo or not metadata.get('permissions', {}).get('push'):
                raise PermissionError('Configured credential cannot write the registered project')

    def adopt_reviewed_commits(self, head):
        """Continue from commits the owner added on top of the checkpoint, such as review tests (#228).

        Commit authors are self-declared, so they prove nothing. What the owner proves is a "Guidance:" comment on
        the task issue written after the newest added commit. Only a fast-forward of at most MAX_ADOPTED_COMMITS is
        adopted; anything else still blocks, so concurrent work is never built over unseen."""
        if not re.fullmatch(r'[0-9a-f]{40}', head or '') or not re.fullmatch(r'[0-9a-f]{40}', self.state['candidate'] or ''):
            return False
        try:
            comparison = self.target_read(f"repos/{self.scope.repo}/compare/{self.state['candidate']}...{head}")
        except (urllib.error.URLError, ValueError, KeyError):
            return False
        added = comparison.get('commits') if isinstance(comparison, dict) else None
        if (comparison.get('status') != 'ahead' or not isinstance(added, list) or not added
                or len(added) != comparison.get('ahead_by') or len(added) > MAX_ADOPTED_COMMITS):
            return False
        try:
            dates = [_time(commit['commit']['committer']['date']) for commit in added]
        except (KeyError, TypeError):
            return False
        if None in dates:
            return False
        newest = max(dates)
        guided = [c for c in comments(self.read, self.scope.number)
                  if (c.get('user') or {}).get('login', '').lower() == OWNER
                  and re.match(r'^\s*guidance\s*:', c.get('body') or '', re.I)
                  and (_time(c.get('created_at')) or 0) >= newest]
        if not guided:
            return False
        files = [f.get('filename') for f in comparison.get('files') or [] if isinstance(f, dict) and isinstance(f.get('filename'), str)]
        self.event(f'Adopted {len(added)} owner-reviewed commit(s) on top of the checkpoint', outcome='recovering',
                   strategy='continue_from_reviewed_commits')
        self.state.update(candidate=head, files=sorted(set(files) | set(self.state['files'])))
        return True

    def begin(self, action=''):
        """Consume a dispatch exactly once, on the same authorization and candidate."""
        if action.startswith('resume:'):
            expected = f"resume:{self.state['continuations']}:{self.scope.digest[:12]}"
            if action != expected or self.state['status'] != 'dispatching':
                return False
        self.check_project_access()
        for key in self.state['rejected']:
            if key not in self.ledger:
                self.remember(dict(candidate=self.state['candidate'], kind='legacy_rejection', model='',
                                   error='Previously rejected proposal', strategy='different_proposal', outcome='recovering'), key)
        if self.state['files']:
            branch = f"kappa/dev-{self.scope.number}"
            head = self.target_read(f'repos/{self.scope.repo}/git/ref/heads/{branch}')['object']['sha']
            receipt = self.state.get('executionPublication', {})
            if head != self.state['candidate'] and receipt.get('sha') == head and receipt.get('branch') == branch:
                commit = self.target_read(f'repos/{self.scope.repo}/git/commits/{head}')
                if [p.get('sha') for p in commit.get('parents', [])] != [self.state['candidate']]:
                    raise PermissionError('Saved publication commit has a different parent; recovery stopped')
                self.state.update(candidate=head, phase='publication')
            if head != self.state['candidate'] and not self.adopt_reviewed_commits(head):
                self.event('Candidate branch moved since the checkpoint; concurrent work is preserved', outcome='blocked', strategy='stop')
                self.publish('blocked', 'Candidate changed. Review newer work before resuming.')
                return False
        if not action and self.comment and self.state['status'] in ('waiting', 'dispatching', 'running', 'recovering'):
            # Old/duplicate blank dispatches must not bypass the continuation
            # token, cooldown or recovery budget. Explicit Retry joins the queue.
            notify_wake(self.scope.number)
            return False
        self.state.update(status='running', run=os.getenv('GITHUB_RUN_ID', ''), nextAt=0)
        self._resuming = True
        try:
            self.persist()
        finally:
            self._resuming = False
        if self.notes.comment:
            self.note(status='Running: resumed saved work')
        self.publish('running', 'Runner acknowledged the saved task. Execution started.')
        return True

    def queue(self):
        """Atomic ref reservation plus durable dispatch state prevents competing scanners."""
        if self.state['status'] != 'waiting' or self.clock() < self.state['nextAt']:
            return False
        # An acknowledgement can be delayed while the previous runner is still
        # publishing its checkpoint. Do not spend a continuation alongside it.
        if self.state.get('run'):
            meta = self.read(f"repos/{ROOT}/actions/runs/{self.state['run']}")
            if meta.get('status') != 'completed':
                return False
            if meta.get('conclusion') == 'cancelled':
                self.event('Previous workflow was cancelled; automatic resumption stopped', outcome='blocked', strategy='stop')
                self.publish('blocked', 'Workflow cancelled. Review before an explicit Retry.')
                return False
        # Every mutation is also reauthorized by the normal request boundary.
        if self.clock() > self.state.get('waitingSince', self.clock()) + self.project.get('maxWaitSeconds', 21600):
            self.event('Maximum provider waiting duration elapsed', outcome='paused', strategy='stop')
            self.publish('paused', 'Provider waiting deadline reached; review saved progress before resuming.')
            return False
        self.check_project_access()
        n = self.state['continuations'] + 1
        quota = self.state.get('quotaResumes', 0) + (1 if self.state.get('quotaWait') else 0)
        if n > MAX_CONTINUATIONS + MAX_QUOTA_RESUMES or quota > MAX_QUOTA_RESUMES or n - quota > MAX_CONTINUATIONS:
            return False
        main = self.read(f'repos/{ROOT}/git/ref/heads/main')['object']['sha']
        ref = f'refs/heads/kappa/recovery-{self.scope.number}-{self.scope.digest[:12]}-{n}'
        try:
            self.write(f'repos/{ROOT}/git/refs', {'ref': ref, 'sha': main}, 'POST')
        except urllib.error.HTTPError as error:
            if error.code != 422:
                raise
            if self.clock() - self.state['updatedAt'] < DISPATCH_ACK_SECONDS:
                return False
            # Recover a crash between reserving the ref and persisting dispatch state.
            self.read(f'repos/{ROOT}/git/ref/heads/{ref.removeprefix("refs/heads/")}')
        self.state.update(continuations=n, quotaResumes=quota, quotaWait=False, status='dispatching', dispatchAttempts=0)
        self.persist()
        self.dispatch()
        return True

    def dispatch(self):
        if self.state.get('dispatchAttempts', 0) >= 3:
            self.event('Continuation dispatch did not start a worker after three deliveries', outcome='blocked', strategy='stop')
            self.publish('blocked', 'Continuation delivery exhausted. Check GitHub Actions access.')
            return False
        self.state['dispatchAttempts'] = self.state.get('dispatchAttempts', 0) + 1
        self.persist()  # Count even an ambiguous/lost acknowledgement.
        self.publish('queued', 'Dispatch requested. Waiting for GitHub Actions and runner acknowledgement.')
        action = f"resume:{self.state['continuations']}:{self.scope.digest[:12]}"
        self.write(f'repos/{ROOT}/actions/workflows/agent.yml/dispatches',
                   {'ref': 'main', 'inputs': {'issue_number': str(self.scope.number), 'action': action}}, 'POST')

    def recover_interrupted(self):
        if self.state['status'] not in ('running', 'recovering'):
            return False
        run = self.state.get('run')
        if run:
            meta = self.read(f'repos/{ROOT}/actions/runs/{run}')
            # Never start a second worker alongside an active one.
            if meta.get('status') != 'completed':
                return False
            if meta.get('conclusion') == 'cancelled':
                self.event('Workflow cancelled; automatic resumption stopped', outcome='blocked', strategy='stop')
                self.publish('blocked', 'Workflow cancelled. Retry explicitly to resume.')
                return False
        return self.defer(RuntimeError('Task execution deadline or interrupted worker; resume saved candidate'))


def verify_saved_candidate(journal, token):
    """Owner-triggered verification only: never repair, regenerate or change the candidate."""
    if not journal.scope.inference_route or not journal.state['files'] or not journal.state['pr']:
        raise PermissionError('Verification-only action requires a saved pinned task candidate')
    match = re.fullmatch(r'https://github.com/' + re.escape(journal.scope.repo) + r'/pull/(\d+)', journal.state['pr'])
    if not match:
        raise PermissionError('Saved task PR is outside the authorized repository')
    pr = journal.target_read(f'repos/{journal.scope.repo}/pulls/{match[1]}')
    if (pr.get('state') != 'open' or pr.get('draft') is not True or pr.get('head', {}).get('sha') != journal.state['candidate']
            or pr.get('head', {}).get('ref') != f'kappa/dev-{journal.scope.number}'):
        raise PermissionError('Saved draft candidate changed; verification stopped')
    journal.state['phase'] = 'tests'
    result = resume_checks(journal, pr, token)
    if result == 'fix':
        journal.event('Independent checks or requirements need review; inference retries are disabled', outcome='blocked', strategy='stop')
        journal.publish('blocked', 'Verification stopped without new inference; review the saved draft and test evidence.')
        return 'blocked'
    return result


def resume_checks(journal, pr, token):
    """Resume independent verification at the saved SHA, including partial dispatch."""
    from engine import native_build
    from engine.developer import dispatch_tests, sandbox_result
    from engine.verify import open_problems
    journal.state['status'] = 'testing'
    journal.persist()
    repo, sha = journal.scope.repo, journal.state['candidate']
    branch = f'kappa/dev-{journal.scope.number}'
    sandbox = sandbox_result(branch, sha, token, repo)
    native = native_build.result(branch, sha, token) if repo == ROOT else None
    needed = native_build.needed(repo, journal.state['files'])
    checks = [r for r in (sandbox, native) if r]
    if any(r.get('status') == 'completed' and r.get('conclusion') == 'failure' for r in checks):
        return 'fix'
    # Passing tests do not resolve an unfinished original requirement.
    if sandbox and sandbox.get('status') == 'completed' and open_problems(pr):
        return 'fix'
    if not sandbox or (sandbox.get('status') == 'completed' and sandbox.get('conclusion') != 'success'):
        dispatch_tests(repo, branch, sha, token, journal.state['files'])
    elif needed and (not native or (native.get('status') == 'completed' and native.get('conclusion') != 'success')):
        native_build.dispatch(branch, sha, token)
    elif all(r.get('status') == 'completed' and r.get('conclusion') == 'success' for r in checks) and (native or not needed):
        current = journal.target_read(f'repos/{repo}/git/ref/heads/{branch}')['object']['sha']
        if current != sha:
            journal.event('Candidate changed during verification; newer work is preserved', outcome='blocked', strategy='stop')
            journal.publish('blocked', 'Candidate changed; verify the newer commit before completion.')
            return 'blocked'
        # A successful exact-candidate check supersedes the active failure without
        # erasing earlier evidence or charging any additional inference budget.
        last = journal.state['events'][-1] if journal.state['events'] else {}
        journal.state['events'].append(dict(at=journal.clock(), candidate=sha, kind='verification', error='',
                                           model=journal.scope.inference_route or last.get('model', ''),
                                           strategy='owner_review', outcome='ready', operation='test',
                                           next='Review the validated draft PR; no automatic continuation is scheduled'))
        journal.state.update(status='ready', nextAt=0)
        journal.state.pop('waitingSince', None)
        journal.persist()
        journal.note(complete=True, status='Independent checks passed; ready for owner review')
        journal.publish('ready', 'Independent checks passed for the saved candidate. Ready for owner review.')
        return 'ready'
    if journal.notes.comment:
        journal.note(status='Independent verification is running for the saved candidate')
    journal.publish('testing', 'Independent verification is running for the saved candidate.')
    return 'testing'


def scan(read, write, clock=time.time, task=None):
    """Called by a serialized trusted schedule; it never invokes a model or candidate."""
    from engine.intent_guard import ACTIVE, activate
    results = []
    issues = []
    for page in range(1, 21) if task is None else []:
        batch = read(f'repos/{ROOT}/issues?state=open&labels=kappa-task&per_page=100&page={page}')
        issues.extend(batch)
        if len(batch) < 100:
            break
    else:
        if task is not None:
            issues = [read(f'repos/{ROOT}/issues/{task}')]
        elif len(issues) >= 2000:
            raise ValueError('Recovery issue queue exceeds the supported inspection limit')
    for issue in issues:
        if issue.get('pull_request') or not re.search(r'^Mode:\s*develop\s*$', issue.get('body') or '', re.M):
            continue
        journal = None
        try:
            activate(issue)
            journal = Journal(issue, read, write, clock)
            if not journal.comment:
                if task is None:
                    continue
                runs = read(f'repos/{ROOT}/actions/workflows/agent.yml/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
                if any(r.get('display_title', '').startswith(f'Agent task #{task} ') and r.get('status') != 'completed' for r in runs):
                    results.append((task, 'GitHub Actions queued or active'))
                    continue
                # Targeted watchdog only: recover a lost initial dispatch using
                # the same task and the normal atomic continuation claim.
                journal.state.update(status='waiting', run='', nextAt=clock(), waitingSince=clock())
                journal.persist()
            if journal.state['status'] in ('running', 'recovering'):
                journal.recover_interrupted()
            # If dispatch acknowledgement was lost, the same token is safe to send
            # again. begin() consumes it once under the per-task workflow queue.
            if journal.state['status'] == 'dispatching' and clock() - journal.state['updatedAt'] > DISPATCH_ACK_SECONDS:
                runs = read(f'repos/{ROOT}/actions/workflows/agent.yml/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
                if any(r.get('display_title', '').startswith(f"Agent task #{issue['number']} resume:{journal.state['continuations']}:") and r.get('status') != 'completed' for r in runs):
                    results.append((issue['number'], 'GitHub Actions queued or active'))
                else:
                    journal.dispatch()
                    results.append((issue['number'], 'redispatched'))
            elif journal.queue():
                results.append((issue['number'], 'queued'))
            else:
                results.append((issue['number'], journal.state['status']))
        except PermissionError as error:
            results.append((issue['number'], clean(error, 180)))
            if journal:
                try:
                    journal.event(error, outcome='blocked', strategy='stop', next_action='Restore this project access or renew task authorization')
                    journal.publish('blocked', 'Project recovery paused: ' + clean(error, 180))
                except (PermissionError, urllib.error.URLError):
                    pass  # Revoked authorization cannot authorize another write.
            continue
        except (urllib.error.URLError, ValueError, KeyError) as error:
            results.append((issue['number'], clean(error, 180)))
        finally:
            ACTIVE.set(None)
    return results


def main():
    from engine.runner import github, request
    token = os.environ['GITHUB_TOKEN']
    read = lambda path: github(path, token)
    write = lambda path, payload, method: request('https://api.github.com/' + path, payload, token, method)
    task = os.getenv('KAPPA_RECOVERY_TASK', '')
    if task and (not task.isdecimal() or int(task) < 1):
        raise ValueError('Invalid recovery task')
    print('Recovery queue:', scan(read, write, task=int(task) if task else None))


if __name__ == '__main__':
    main()

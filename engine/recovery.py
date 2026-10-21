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
from contextvars import ContextVar

CURRENT = ContextVar('recovery_journal', default=None)
SPLITTING = ContextVar('recovery_split_active', default=False)
MARKER = 'KAPPA_RECOVERY_V1'
ROOT = 'onlykappa/KappaForge'
MAX_CONTINUATIONS = 3
MAX_EVENTS = 40
# GitHub comment content has a 65,536-character ceiling; UTF-8 bytes are
# conservatively capped below it, including heading, marker and summary.
MAX_COMMENT_BYTES = 60000
ARCHIVE_BYTES = 45000
BOT = 'github-actions[bot]'
SHA = re.compile(r'^[a-f0-9]{40}$')


def clean(value, size=700):
    value = str(value)
    for name, secret in os.environ.items():
        if len(secret) >= 8 and re.search(r'TOKEN|SECRET|PASSWORD|API_KEY', name, re.I):
            value = value.replace(secret, '[redacted]')
    return value[:size].encode('utf-8', 'backslashreplace').decode('utf-8')


def diagnose(error):
    """Deterministic failure class and a different, relevant next strategy."""
    from engine.reliability import RecoveryBudgetExceeded, ProviderResponseError
    if isinstance(error, RecoveryBudgetExceeded):
        return 'recovery_budget', 'stop' if error.terminal else 'checkpoint_and_continue'
    if isinstance(error, ProviderResponseError):
        return 'invalid_response', 'switch_or_defer'
    if getattr(error, 'code', '') == 'request_too_large' or type(error).__name__ == 'GatewayRequestTooLarge':
        return 'request_size', 'reduce_source_context'
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
        self.state = dict(version=1, task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest,
                          authorization=self.scope.identity, candidate='', base='', pr='', status='running',
                          run=os.getenv('GITHUB_RUN_ID', ''), continuations=0, nextAt=0, updatedAt=clock(),
                          requirements=[], events=[], rejected={}, files=[], expiresAt=int(self.scope.expires * 1000))
        all_comments = comments(read, self.scope.number)
        for comment in all_comments:
            if comment.get('user', {}).get('login') != BOT or not (comment.get('body') or '').startswith('### KappaForge recovery checkpoint\n'):
                continue
            match = re.search(r'<!-- ' + MARKER + r' (.*?) -->', comment.get('body') or '')
            if not match:
                continue
            try:
                state = json.loads(match[1])
                valid = (state['version'] == 1 and state['task'] == self.scope.number and state['repo'] == self.scope.repo
                         and state['digest'] == self.scope.digest and state['authorization'] == self.scope.identity
                         and isinstance(state['events'], list) and len(state['events']) <= MAX_EVENTS
                         and isinstance(state['requirements'], list) and len(state['requirements']) <= 100
                         and isinstance(state['rejected'], dict) and len(state['rejected']) <= MAX_EVENTS
                         and isinstance(state['continuations'], int) and 0 <= state['continuations'] <= MAX_CONTINUATIONS)
                if valid:
                    self.state, self.comment = state, comment['id']
            except (ValueError, KeyError, TypeError):
                continue
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
            if (blob.get('task'), blob.get('repo'), blob.get('digest')) != (self.scope.number, self.scope.repo, self.scope.digest):
                raise ValueError('Referenced requirement catalog is unavailable; saved checkpoint retained')
            self.state['requirements'] = blob['requirements']
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
                if part.get('digest') == self.scope.digest and part.get('repo') == self.scope.repo and part.get('task') == self.scope.number:
                    self.ledger.update(part['records'])
                    self.ledger_rows.append((comment['id'], part))
            except (ValueError, KeyError, TypeError):
                continue
        self._committed = copy.deepcopy(self.state)
        self.loader = None
        # Only the validated, trusted journal comment may be edited across runs.
        from engine.intent_guard import ACTIVE
        active = ACTIVE.get()
        if active and active.digest == self.scope.digest and self.comment:
            active.own_comments.add(str(self.comment))
            active.own_comments.update(str(row[0]) for row in self.ledger_rows)

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
        draft = copy.deepcopy(self.state)
        try:
            execution = RecoveryCoordinator.state(draft['status'], draft['events'][-1].get('error', '') if draft['events'] else '')
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
        record = dict(item, task=self.scope.number, repo=self.scope.repo,
                      branch=f'kappa/dev-{self.scope.number}', operation=item.get('operation', 'edit' if key else 'model'),
                      files=item.get('files', list(self.state['files'])), fingerprint=key,
                      provider=item.get('model', '').split(':', 1)[0], cause=item.get('error', ''),
                      rejectedStrategies=[item.get('strategy', '')], attempts=1,
                      expiresAt=self.clock() + 300 if item.get('kind') in ('provider_outage', 'rate_limit', 'model_deadline') else self.scope.expires)
        if key in self.ledger:
            record['attempts'] = self.ledger[key].get('attempts', 1) + 1
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
        self.persist()

    def requirements(self, values):
        merged = list(dict.fromkeys(self.state['requirements'] + list(values)))
        if len(merged) > 100 or any(not isinstance(v, str) or len(v) > 4000 for v in merged) or sum(map(len, merged)) > 12000:
            raise ValueError('Requirement catalog cannot be safely checkpointed')
        self.state['requirements'] = merged
        self.persist()
        return merged

    def defer(self, error):
        kind, _ = diagnose(error)
        if (self.scope.inference_route or kind in ('authorization', 'access') or getattr(error, 'terminal', False) or self.state.get('routingAvailability', {}).get('terminal')
                or self.state['continuations'] >= MAX_CONTINUATIONS or self.scope.expires <= self.clock() + 1200):
            self.event(error, model=self.scope.inference_route or '', strategy='stop', outcome='blocked',
                       next_action='Owner review required; automatic continuations exhausted or access blocked')
            return False
        now = self.clock()
        self.state.setdefault('waitingSince', now)
        availability = self.state.get('routingAvailability', {})
        due = max(now + 300, getattr(error, 'retry_at', 0) + 30, availability.get('retryAt', 0) + 30)
        end = min(self.scope.expires - 1200, self.state['waitingSince'] + self.project.get('maxWaitSeconds', 21600))
        if due > end:
            self.event(error, outcome='paused', strategy='stop', next_action='Waiting deadline reached; renew authorization or provider access')
            return False
        self.state['nextAt'] = due
        self.event(error, model=self.scope.inference_route or '', strategy='checkpoint_and_continue', outcome='waiting',
                   next_action='Resume this task and candidate on the next recovery queue scan (every 15 minutes)')
        self.publish('waiting', 'Progress saved. Waiting for automatic continuation on the recovery queue.')
        return True

    def publish(self, status, message):
        at = int(self.clock() * 1000)
        last = self.state['events'][-1] if self.state['events'] else {}
        execution = self.state.get('executionState', status)
        status = {'paused':'blocked','blocked_authorization':'blocked','failed_terminal':'failed','waiting_for_provider':'waiting','validating':'testing'}.get(status, status)
        finished = at if status == 'ready' else 0
        snapshot = dict(version=1, taskId=str(self.scope.number), attemptId=f"recovery:{self.state['continuations']}:{at}",
                        attemptAt=at, revision=1, status=status, updatedAt=at, startedAt=at, finishedAt=finished,
                        steps=[dict(id='recovery', title=message, detail=last.get('error', ''), status='completed' if status == 'ready' else status,
                                    startedAt=at, finishedAt=finished)], activity=[], findings=[], units=None,
                        recovery=dict(executionState=execution, candidate=self.state['candidate'], nextAt=int(self.state['nextAt'] * 1000),
                                      continuations=self.state['continuations'], expiresAt=int(self.scope.expires * 1000), last=last))
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
            if head != self.state['candidate']:
                self.event('Candidate branch moved since the checkpoint; concurrent work is preserved', outcome='blocked', strategy='stop')
                self.publish('blocked', 'Candidate changed. Review newer work before resuming.')
                return False
        self.state.update(status='running', run=os.getenv('GITHUB_RUN_ID', ''), nextAt=0)
        self._resuming = True
        try:
            self.persist()
        finally:
            self._resuming = False
        return True

    def queue(self):
        """Atomic ref reservation plus durable dispatch state prevents competing scanners."""
        if self.state['status'] != 'waiting' or self.clock() < self.state['nextAt']:
            return False
        # Every mutation is also reauthorized by the normal request boundary.
        if self.clock() > self.state.get('waitingSince', self.clock()) + self.project.get('maxWaitSeconds', 21600):
            self.event('Maximum provider waiting duration elapsed', outcome='paused', strategy='stop')
            self.publish('paused', 'Provider waiting deadline reached; review saved progress before resuming.')
            return False
        self.check_project_access()
        n = self.state['continuations'] + 1
        if n > MAX_CONTINUATIONS:
            return False
        main = self.read(f'repos/{ROOT}/git/ref/heads/main')['object']['sha']
        ref = f'refs/heads/kappa/recovery-{self.scope.number}-{self.scope.digest[:12]}-{n}'
        try:
            self.write(f'repos/{ROOT}/git/refs', {'ref': ref, 'sha': main}, 'POST')
        except urllib.error.HTTPError as error:
            if error.code != 422:
                raise
            if self.clock() - self.state['updatedAt'] < 1200:
                return False
            # Recover a crash between reserving the ref and persisting dispatch state.
            self.read(f'repos/{ROOT}/git/ref/heads/{ref.removeprefix("refs/heads/")}')
        self.state.update(continuations=n, status='dispatching', dispatchAttempts=0)
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
        journal.publish('ready', 'Independent checks passed for the saved candidate. Ready for owner review.')
        return 'ready'
    journal.publish('testing', 'Independent verification is running for the saved candidate.')
    return 'testing'


def scan(read, write, clock=time.time):
    """Called by a serialized trusted schedule; it never invokes a model or candidate."""
    from engine.intent_guard import ACTIVE, activate
    results = []
    issues = []
    for page in range(1, 21):
        batch = read(f'repos/{ROOT}/issues?state=open&labels=kappa-task&per_page=100&page={page}')
        issues.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise ValueError('Recovery issue queue exceeds the supported inspection limit')
    for issue in issues:
        if issue.get('pull_request') or not re.search(r'^Mode:\s*develop\s*$', issue.get('body') or '', re.M):
            continue
        journal = None
        try:
            activate(issue)
            journal = Journal(issue, read, write, clock)
            if not journal.comment:
                continue
            if journal.state['status'] in ('running', 'recovering'):
                journal.recover_interrupted()
            # If dispatch acknowledgement was lost, the same token is safe to send
            # again. begin() consumes it once under the per-task workflow queue.
            if journal.state['status'] == 'dispatching' and clock() - journal.state['updatedAt'] > 1200:
                journal.dispatch()
                results.append((issue['number'], 'redispatched'))
            elif journal.queue():
                results.append((issue['number'], 'queued'))
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
    print('Recovery queue:', scan(read, write))


if __name__ == '__main__':
    main()

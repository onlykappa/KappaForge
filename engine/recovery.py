"""Task-bound recovery journal and an idempotent, bounded continuation queue.

Only trusted Actions bot comments carry executable queue state. Code checkpoints
remain on the task branch; comments contain diagnostics, hashes and requirements.
"""
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
BOT = 'github-actions[bot]'
SHA = re.compile(r'^[a-f0-9]{40}$')


def clean(value, size=700):
    value = str(value)
    for name, secret in os.environ.items():
        if len(secret) >= 8 and re.search(r'TOKEN|SECRET|PASSWORD|API_KEY', name, re.I):
            value = value.replace(secret, '[redacted]')
    return value[:size]


def diagnose(error):
    """Deterministic failure class and a different, relevant next strategy."""
    text = str(error).lower()
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
        self.issue, self.read, self.write, self.clock = issue, read, write, clock
        self.comment = None
        self.state = dict(version=1, task=self.scope.number, repo=self.scope.repo, digest=self.scope.digest,
                          authorization=self.scope.identity, candidate='', base='', pr='', status='running',
                          run=os.getenv('GITHUB_RUN_ID', ''), continuations=0, nextAt=0, updatedAt=clock(),
                          requirements=[], events=[], rejected={}, files=[], expiresAt=int(self.scope.expires * 1000))
        for comment in comments(read, self.scope.number):
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
        self.loader = None
        # Only the validated, trusted journal comment may be edited across runs.
        from engine.intent_guard import ACTIVE
        active = ACTIVE.get()
        if active and active.digest == self.scope.digest and self.comment:
            active.own_comments.add(str(self.comment))

    def persist(self):
        self.state['updatedAt'] = self.clock()
        wire = json.dumps(self.state, separators=(',', ':'), ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e')
        if len(wire) > 60000:
            raise ValueError('Recovery checkpoint exceeds safe comment size; saved history is retained')
        last = self.state['events'][-1] if self.state['events'] else {}
        body = ('### KappaForge recovery checkpoint\n\nStatus: ' + self.state['status'] +
                '\nCandidate: ' + (self.state['candidate'] or 'no code saved yet') +
                '\nNext action: ' + last.get('next', 'Continue the authorized task') +
                '\n\n<!-- ' + MARKER + ' ' + wire + ' -->')
        if self.comment:
            self.write(f'repos/{ROOT}/issues/comments/{self.comment}', {'body': body}, 'PATCH')
        else:
            self.comment = self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments', {'body': body}, 'POST')['id']

    def event(self, error='', model='', strategy='', outcome='recovering', next_action='', signature=''):
        kind, default = diagnose(error)
        if len(self.state['events']) >= MAX_EVENTS:
            self.state['status'] = 'blocked'
            self.persist()
            self.publish('blocked', 'Task-wide recovery history exhausted. Review saved evidence before retrying.')
            raise PermissionError('Task-wide recovery history budget exhausted; owner review required')
        item = dict(at=self.clock(), candidate=self.state['candidate'], kind=kind, error=clean(error, 500),
                    model=clean(model, 140), strategy=strategy or default, outcome=outcome,
                    next=clean(next_action or strategy or default, 240))
        if signature:
            key = hashlib.sha256((self.state['candidate'] + signature).encode()).hexdigest()
            self.state['rejected'][key] = self.state['rejected'].get(key, 0) + 1
            item['signature'] = key
        self.state['events'].append(item)
        self.state['status'] = outcome
        self.persist()
        return item

    def avoid_models(self):
        counts = {}
        for item in self.state['events']:
            if item.get('candidate') == self.state['candidate'] and item.get('outcome') == 'recovering' and item.get('model'):
                counts[item['model']] = counts.get(item['model'], 0) + 1
        return {m for m, count in counts.items() if count >= 2}

    def rejected(self, signature):
        key = hashlib.sha256((self.state['candidate'] + signature).encode()).hexdigest()
        return key in self.state['rejected']

    def checkpoint(self, sha, base='', pr='', files=()):
        if not SHA.fullmatch(sha):
            raise ValueError('Checkpoint requires a full candidate SHA')
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
        if kind in ('authorization', 'access') or self.state['continuations'] >= MAX_CONTINUATIONS or self.scope.expires <= self.clock() + 1200:
            self.event(error, strategy='stop', outcome='blocked', next_action='Owner review required; automatic continuations exhausted or access blocked')
            return False
        self.state['nextAt'] = self.clock() + 300
        self.event(error, strategy='checkpoint_and_continue', outcome='waiting',
                   next_action='Resume this task and candidate on the next recovery queue scan (every 15 minutes)')
        self.publish('waiting', 'Progress saved. Waiting for automatic continuation on the recovery queue.')
        return True

    def publish(self, status, message):
        at = int(self.clock() * 1000)
        last = self.state['events'][-1] if self.state['events'] else {}
        snapshot = dict(version=1, taskId=str(self.scope.number), attemptId=f"recovery:{self.state['continuations']}:{at}",
                        attemptAt=at, revision=1, status=status, updatedAt=at, startedAt=at, finishedAt=0,
                        steps=[dict(id='recovery', title=message, detail=last.get('error', ''), status=status,
                                    startedAt=at, finishedAt=0)], activity=[], findings=[], units=None,
                        recovery=dict(candidate=self.state['candidate'], nextAt=int(self.state['nextAt'] * 1000),
                                      continuations=self.state['continuations'], expiresAt=int(self.scope.expires * 1000), last=last))
        wire = json.dumps(snapshot, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e')
        self.write(f'repos/{ROOT}/issues/{self.scope.number}/comments',
                   {'body': '### KappaForge is working on it\n\n<!-- KAPPA_PROGRESS_V1 ' + wire + ' -->\n' + message}, 'POST')

    def begin(self, action=''):
        """Consume a dispatch exactly once, on the same authorization and candidate."""
        if action.startswith('resume:'):
            expected = f"resume:{self.state['continuations']}:{self.scope.digest[:12]}"
            if action != expected or self.state['status'] != 'dispatching':
                return False
        if self.state['files']:
            branch = f"kappa/dev-{self.scope.number}"
            head = self.read(f'repos/{self.scope.repo}/git/ref/heads/{branch}')['object']['sha']
            if head != self.state['candidate']:
                self.event('Candidate branch moved since the checkpoint; concurrent work is preserved', outcome='blocked', strategy='stop')
                self.publish('blocked', 'Candidate changed. Review newer work before resuming.')
                return False
        self.state.update(status='running', run=os.getenv('GITHUB_RUN_ID', ''), nextAt=0)
        self.persist()
        return True

    def queue(self):
        """Atomic ref reservation plus durable dispatch state prevents competing scanners."""
        if self.state['status'] != 'waiting' or self.clock() < self.state['nextAt']:
            return False
        # Every mutation is also reauthorized by the normal request boundary.
        if self.scope.repo != ROOT:
            self.event('Automatic cross-repository continuation requires configured queue access', outcome='blocked', strategy='stop')
            return False
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


def resume_checks(journal, pr, token):
    """Resume independent verification at the saved SHA, including partial dispatch."""
    from engine import native_build
    from engine.developer import dispatch_tests, sandbox_result
    from engine.verify import open_problems
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
        journal.state['status'] = 'ready'
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
        except PermissionError:
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

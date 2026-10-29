"""Finite owner-authorized coding queue. No merge, deployment or candidate execution on the host."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from engine import queue_authority as authority
from engine.intent_guard import ExecutionScope, timestamp
from engine.verify import open_problems
from engine.native_build import needed

ROOT = authority.ROOT
PREFIX = f'repos/{ROOT}/'
MARKER = 'KAPPA_QUEUE_V1'
UPGRADE_MARKER = 'KAPPA_QUEUE_ENGINE_UPGRADE_V1'
MAX_ATTEMPTS = 3  # Additional queue bound; existing task budgets are never reset or increased.


class Pending(Exception):
    pass


class Blocked(RuntimeError):
    pass


class API:
    def __init__(self, token):
        self.token = token

    def __call__(self, path, payload=None, method=None):
        if not path.startswith(PREFIX):
            raise PermissionError('Queue API cannot access another repository')
        req = urllib.request.Request('https://api.github.com/' + path,
            data=None if payload is None else json.dumps(payload).encode(), method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'User-Agent': 'KappaForge-owner-queue'})
        # Ambiguous mutations are never replayed. The controller persists before starting a child.
        with urllib.request.urlopen(req, timeout=35) as response:
            body = response.read()
            return json.loads(body) if body else {}


def pages(api, path, key=None, maximum=10):
    rows = []
    for page in range(1, maximum + 1):
        batch = api(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        batch = batch.get(key) if key else batch
        if not isinstance(batch, list) or len(batch) > 100:
            raise Blocked('Incomplete GitHub inventory')
        rows.extend(batch)
        if len(batch) < 100:
            return rows
    raise Blocked('GitHub inventory exceeds the bounded queue inspection limit')


def active_agents(api, number):
    # Query active statuses rather than a moving prefix of historical runs.
    for status in ('queued', 'in_progress', 'waiting', 'requested', 'pending'):
        runs = pages(api, PREFIX + f'actions/workflows/agent.yml/runs?status={status}', 'workflow_runs')
        if any(re.match(rf'^Agent task #{number}(?: |$)', r.get('display_title', '')) for r in runs):
            return True
    return False


def candidate(api, row):
    number = row['issue']
    pulls = api(PREFIX + f'pulls?state=open&head=onlykappa:kappa/dev-{number}&per_page=2')
    if not isinstance(pulls, list) or len(pulls) > 1:
        raise Blocked('Ambiguous task candidate')
    if not pulls:
        return None
    pr = api(PREFIX + f"pulls/{pulls[0]['number']}")
    if (pr.get('state') != 'open' or pr.get('draft') is not True
            or (pr.get('head') or {}).get('ref') != f'kappa/dev-{number}'
            or ((pr.get('head') or {}).get('repo') or {}).get('full_name') != ROOT
            or ((pr.get('base') or {}).get('repo') or {}).get('full_name') != ROOT
            or (pr.get('base') or {}).get('ref') != row['base']
            or not authority.SHA.fullmatch(str((pr.get('head') or {}).get('sha', '')))):
        raise Blocked('Task candidate is closed, foreign or outside its authorized base')
    return pr


def latest_validation(api, workflow, title):
    for page in range(1, 11):
        data = api(PREFIX + f'actions/workflows/{workflow}/runs?event=workflow_dispatch&per_page=100&page={page}')
        runs = data.get('workflow_runs')
        if not isinstance(runs, list) or len(runs) > 100:
            raise Blocked('Validation history unavailable')
        for run in runs:
            if (run.get('display_title') == title and run.get('head_branch') == 'main'
                    and run.get('event') == 'workflow_dispatch' and run.get('path') == '.github/workflows/' + workflow
                    and (run.get('repository') or {}).get('full_name') == ROOT):
                return run
        if len(runs) < 100:
            return None
    raise Blocked('Validation history incomplete; no success inferred')


def validation(api, pr, number):
    """A model completion claim is insufficient: require trusted exact-candidate executions."""
    markers = re.findall(r'<!-- KAPPA_REVIEW_V1 (.*?) -->', pr.get('body') or '')
    try:
        reviewed = json.loads(markers[-1]) if len(markers) == 1 else None
    except ValueError:
        reviewed = None
    if not isinstance(reviewed, dict) or reviewed.get('complete') is not True or reviewed.get('problems') != [] or open_problems(pr):
        return 'repair'
    sha = pr['head']['sha']
    files = pages(api, PREFIX + f"pulls/{pr['number']}/files")
    names = [f.get('filename') for f in files]
    if (type(pr.get('changed_files')) is not int or pr['changed_files'] != len(files)
            or not files or any(not isinstance(n, str) for n in names) or len(names) != len(set(names))):
        raise Blocked('Incomplete candidate file inventory')
    kinds = [('sandbox-tests.yml', f'Sandbox validation kappa/dev-{number} @ {sha}')]
    if needed(ROOT, names) or any(needed(ROOT, [f.get('previous_filename', '')]) for f in files):
        kinds.append(('ios-build.yml', f'iOS build kappa/dev-{number} @ {sha}'))
    for workflow, title in kinds:
        run = latest_validation(api, workflow, title)
        if not run or run.get('status') != 'completed':
            return 'waiting'
        if run.get('conclusion') != 'success':
            if run.get('conclusion') == 'failure':
                return 'repair'
            raise Blocked('Candidate validation cancelled or inconclusive')
    current = candidate(api, dict(issue=number, base=pr['base']['ref']))
    if current is None or current['head']['sha'] != sha or open_problems(current):
        raise Blocked('Candidate changed during final validation')
    return 'complete'


def checkpoint(api, row, run_id, engine_sha):
    matches = []
    for comment in pages(api, PREFIX + f"issues/{row['issue']}/comments"):
        if ((comment.get('user') or {}).get('login') != 'github-actions[bot]'
                or not (comment.get('body') or '').startswith('### KappaForge recovery checkpoint\n')):
            continue
        marker = re.search(r'<!-- KAPPA_RECOVERY_V1 (.*?) -->', comment['body'])
        try:
            state = json.loads(marker[1]) if marker else {}
        except ValueError:
            continue
        engine = state.get('engine') or {}
        if (state.get('version') == 1 and state.get('task') == row['issue'] and state.get('repo') == ROOT
                and state.get('digest') == row['digest'] and engine.get('queueRun') == str(run_id)
                and engine.get('sha') == engine_sha and state.get('run') == str(run_id)):
            matches.append(state)
    if len(matches) != 1:
        raise Blocked('No unique task checkpoint from this pinned queue execution')
    return matches[0]


class Queue:
    def __init__(self, api, grant, run_id, sha, clock=time.time, sleep=time.sleep):
        self.api, self.grant, self.run_id, self.sha = api, grant, str(run_id), sha
        self.clock, self.sleep = clock, sleep
        self.comment = None
        self.reservations = {}
        self.state = dict(version=1, control=grant['control'], manifest=authority.digest(json.dumps(grant, sort_keys=True)),
                          sha=sha, run=self.run_id, status='starting', tasks={}, updatedAt=clock())

    def authorized(self):
        authority.control(self.grant, self.api, self.clock())
        run = self.api(PREFIX + f'actions/runs/{self.run_id}')
        if run.get('status') != 'in_progress' or run.get('head_sha') != self.sha:
            raise PermissionError('Queue workflow stopped')

    def save(self, status=None, detail=''):
        self.authorized()
        if status:
            self.state['status'] = status
        self.state.update(detail=detail[:500], updatedAt=self.clock())
        summary = '\n'.join(f"- #{r['issue']}: {self.state['tasks'].get(str(r['issue']), {}).get('status', 'queued')}" for r in self.grant['tasks'])
        body = f"### KappaForge automatic queue\n\nStatus: {self.state['status']}\n{detail[:500]}\n\n{summary}\n\nDraft PRs only; no merge or deployment.\n\n<!-- {MARKER} " + json.dumps(self.state, sort_keys=True) + ' -->'
        path = PREFIX + (f'issues/comments/{self.comment}' if self.comment else f"issues/{self.grant['control']}/comments")
        result = self.api(path, {'body': body}, 'PATCH' if self.comment else 'POST')
        if not self.comment:
            self.comment = result['id']

    def load(self):
        rows = pages(self.api, PREFIX + f"issues/{self.grant['control']}/comments")
        found = []
        for row in rows:
            if (row.get('user') or {}).get('login') != 'github-actions[bot]':
                continue
            match = re.search(r'<!-- ' + MARKER + r' (.*?) -->', row.get('body') or '')
            if match:
                found.append((row['id'], json.loads(match[1])))
        if len(found) > 1:
            raise Blocked('Ambiguous queue checkpoint')
        if found:
            checkpoint_id, prior = found[0]
            if any(prior.get(k) != self.state[k] for k in ('version', 'control', 'manifest')):
                raise Blocked('Queue checkpoint belongs to another grant or engine revision')
            unfinished = {k: v for k, v in prior.get('tasks', {}).items() if v.get('status') != 'complete'}
            if unfinished or prior.get('sha') != self.sha:
                old = self.api(PREFIX + f"actions/runs/{prior.get('run')}")
                if old.get('head_sha') != prior.get('sha'):
                    raise Blocked('Queue checkpoint belongs to another grant or engine revision')
                upgraded = set()
                if old.get('status') == 'completed' and old.get('conclusion') == 'cancelled' and self.sha != prior.get('sha'):
                    for key in unfinished:
                        expected = dict(fromRun=prior.get('run'), fromSha=prior.get('sha'), toSha=self.sha,
                                        manifest=self.state['manifest'], task=int(key))
                        for comment in rows:
                            if ((comment.get('user') or {}).get('login') != 'onlykappa'
                                    or not timestamp(old.get('updated_at'))
                                    or not timestamp(old['updated_at']) <= timestamp(comment.get('created_at')) <= self.clock()):
                                continue
                            marker = re.search(r'^<!-- ' + UPGRADE_MARKER + r' (.*?) -->$', comment.get('body') or '', re.M)
                            try:
                                value = json.loads(marker[1]) if marker else {}
                            except ValueError:
                                continue
                            if (set(value) == set(expected) | {'candidate'}
                                    and authority.SHA.fullmatch(str(value.get('candidate', '')))
                                    and all(value.get(k) == v for k, v in expected.items())):
                                upgraded.add((key, value['candidate']))
                if old.get('status') != 'completed' or (old.get('conclusion') not in ('success', 'failure') and not upgraded):
                    raise Blocked('Prior unfinished or cancelled queue cannot be replayed')
                try:
                    old_grant = authority.owner_run(prior.get('run'), self.api, prior.get('sha'), live=False)
                except PermissionError:
                    raise Blocked('Queue checkpoint belongs to another grant or engine revision') from None
                if old_grant != self.grant:
                    raise Blocked('Previous queue grant differs; no resumption authorized')
                if unfinished and prior.get('status') != 'blocked' and not upgraded:
                    raise Blocked('Prior unfinished launch has an ambiguous outcome; inspection required')
                for key, record in unfinished.items():
                    row = next((r for r in self.grant['tasks'] if str(r['issue']) == key), None)
                    if row is None or type(record.get('attempts')) is not int or not 1 <= record['attempts'] < MAX_ATTEMPTS:
                        raise Blocked('Queue task is unknown or its attempt budget is exhausted')
                    authority.task(self.grant, self.api(PREFIX + f"issues/{row['issue']}"), self.clock())
                    if active_agents(self.api, row['issue']):
                        raise Blocked('Previous task still has an active worker; duplicate refused')
                    saved = checkpoint(self.api, row, prior['run'], prior['sha'])
                    status = saved.get('engineStatus') if saved.get('status') == 'engine_pinned' else saved.get('status')
                    upgrade = (key, saved.get('candidate')) in upgraded
                    if old.get('conclusion') == 'cancelled' and not upgrade:
                        raise Blocked('Cancelled task lacks exact owner engine-upgrade authorization')
                    if status not in ('blocked', 'waiting') and not (upgrade and status in ('running', 'recovering')):
                        raise Blocked('Previous task outcome is ambiguous; inspection required')
                    pr = candidate(self.api, row)
                    if pr is None or saved.get('candidate') != pr['head']['sha']:
                        raise Blocked('Previous candidate changed; concurrent work preserved')
                    self.reservations[key] = prior['sha']
                self.state['resumedFrom'] = prior['run']
            self.state['tasks'] = prior['tasks']
            # Do not select this comment for writes until all provenance checks pass.
            self.comment = checkpoint_id
        self.save('running', 'Owner-selected engine verified; dependency queue is active.')

    def ref(self, name, sha):
        self.authorized()
        try:
            actual = self.api(PREFIX + 'git/ref/heads/' + name)['object']['sha']
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            self.api(PREFIX + 'git/refs', {'ref': 'refs/heads/' + name, 'sha': sha}, 'POST')
            return
        if actual != sha:
            raise Blocked('Immutable queue reservation/base moved')

    def launch(self, row, action, deadline):
        self.authorized()
        number = row['issue']
        issue = self.api(PREFIX + f'issues/{number}')
        authority.task(self.grant, issue, self.clock())
        while active_agents(self.api, number):
            self.authorized()
            authority.task(self.grant, self.api(PREFIX + f'issues/{number}'), self.clock())
            if self.clock() >= deadline:
                raise Blocked('Existing task worker is still queued or active; duplicate refused')
            self.sleep(15)
        record = self.state['tasks'].setdefault(str(number), dict(status='queued', attempts=0))
        if record['attempts'] >= MAX_ATTEMPTS:
            raise Blocked('Queue repair attempts exhausted; existing task counters retained')
        record.update(status='running', attempts=record['attempts'] + 1)
        self.save(detail=f'Starting #{number}; queue attempt {record["attempts"]}.')
        env = dict(os.environ, INPUT_ISSUE_NUMBER=str(number), INPUT_ACTION=action,
                   KAPPA_QUEUE_RUN=self.run_id, KAPPA_ENGINE_CHECK='true', KAPPA_TASK_SCOPE='write')
        child = subprocess.Popen([sys.executable, '-m', 'engine.runner'], env=env, start_new_session=True)
        try:
            while child.poll() is None:
                self.authorized()
                # Check task closure/scope while a model call is pending, as well as before every mutation.
                authority.task(self.grant, self.api(PREFIX + f'issues/{number}'), self.clock())
                if self.clock() >= deadline:
                    raise Blocked('Queue waiting deadline reached; saved task retained')
                self.sleep(15)
            if child.returncode:
                record['status'] = 'blocked'
                raise Blocked(f'Task #{number} stopped; inspect its retained failure evidence')
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=10)

    def run(self, deadline):
        self.load()
        predecessor = None
        for row in self.grant['tasks']:
            number, key = row['issue'], str(row['issue'])
            issue = self.api(PREFIX + f'issues/{number}')
            authority.task(self.grant, issue, self.clock())
            if self.state['tasks'].get(key, {}).get('status') == 'complete':
                pr = candidate(self.api, row)
                if pr is None or validation(self.api, pr, number) != 'complete' or pr['head']['sha'] != self.state['tasks'][key]['candidate']:
                    raise Blocked('Previously completed task changed or lost validation')
                predecessor = pr['head']['sha']
                continue
            if not row['existing']:
                if not predecessor:
                    raise Blocked('Queued task has no validated predecessor')
                self.ref(row['base'], predecessor)  # New base per task; never move or merge an existing PR base.
            # Atomic permanent reservation plus durable pre-start debit survives a lost response/process crash.
            claim = f"kappa/queue-claim-{self.grant['control']}-{number}"
            try:
                self.api(PREFIX + 'git/ref/heads/' + claim)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                self.ref(claim, self.sha)
            else:
                if key not in self.reservations:
                    raise Blocked('Task launch was already reserved; ambiguous duplicate refused')
                self.ref(claim, self.reservations.pop(key))
            intake = '<!-- KAPPA_INTAKE_V1 ' + json.dumps(dict(issue=number, created=issue['created_at']), sort_keys=True) + ' -->'
            self.authorized()
            self.api(PREFIX + f'issues/{number}/comments', {'body': 'Owner queue reserved this task; do not dispatch another worker.\n\n' + intake}, 'POST')
            self.api(PREFIX + f'issues/{number}/labels', {'labels': ['kappa-task']}, 'POST')
            action = 'fix' if row['existing'] or candidate(self.api, row) is not None else 'queue-step'
            self.launch(row, action, deadline)
            while True:
                self.authorized()
                authority.task(self.grant, self.api(PREFIX + f'issues/{number}'), self.clock())
                if self.clock() >= deadline:
                    raise Blocked('Queue validation waiting deadline reached')
                saved = checkpoint(self.api, row, self.run_id, self.sha)
                pr = candidate(self.api, row)
                status = saved.get('engineStatus') if saved.get('status') == 'engine_pinned' else saved.get('status')
                if status == 'waiting':
                    next_at = saved.get('nextAt')
                    if not isinstance(next_at, (int, float)) or next_at >= deadline:
                        raise Blocked('Recorded recovery wait exceeds the queue deadline')
                    if next_at > self.clock():
                        self.save(detail=f'#{number} waiting for its recorded recovery cooldown.')
                        self.sleep(min(30, next_at - self.clock()))
                    else:
                        self.launch(row, 'fix' if pr else 'queue-step', deadline)
                    continue
                if status in ('blocked', 'paused', 'needs_clarification'):
                    raise Blocked(f'Task #{number} requires review or an owner answer')
                if pr is None:
                    raise Blocked('Task returned without a draft candidate; inspect its saved checkpoint')
                if saved.get('candidate') != pr['head']['sha']:
                    raise Blocked('Candidate differs from the task checkpoint; concurrent source preserved')
                result = validation(self.api, pr, number)
                if result == 'complete':
                    predecessor = pr['head']['sha']
                    self.state['tasks'][key].update(status='complete', candidate=predecessor, pr=pr['number'])
                    self.save(detail=f'#{number} validated at {predecessor}; advancing automatically.')
                    break
                if result == 'repair':
                    self.launch(row, 'fix', deadline)
                else:
                    self.state['tasks'][key]['status'] = 'validating'
                    self.save(detail=f'Waiting for exact-candidate validation of #{number}.')
                    self.sleep(30)
        self.save('awaiting_owner_review', 'All prepared tasks validated. Broad independent review remains required; nothing merged.')


def main():
    api = API(os.environ['GITHUB_TOKEN'])
    run, sha = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_SHA']
    checkout = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if checkout != sha:
        raise PermissionError('Queue checkout differs from the selected owner revision')
    grant = authority.owner_run(run, api, sha, os.environ['GITHUB_REF_NAME'])
    local = authority.manifest(json.loads((Path(__file__).resolve().parents[1] / authority.PATH).read_text()))
    if local != grant:
        raise PermissionError('Local queue manifest differs from the authenticated source')
    queue = Queue(api, grant, run, sha)
    started = api(PREFIX + f'actions/runs/{run}').get('run_started_at')
    from engine.intent_guard import timestamp
    deadline = min(time.time() + 350 * 60, timestamp(started) + 350 * 60)
    try:
        queue.run(deadline)
    except Exception as error:
        # Sanitized class/reason only. No credentials, response bodies, logs or model text in queue state.
        reason = str(error)[:300] if isinstance(error, (Blocked, Pending, PermissionError)) else type(error).__name__
        try:
            if queue.comment is not None:
                queue.save('blocked', reason)
        except Exception:
            pass  # Revoked authorization cannot authorize another write.
        raise SystemExit('Queue stopped: ' + reason) from None


if __name__ == '__main__':
    main()

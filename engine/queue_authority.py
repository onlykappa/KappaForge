"""An owner-selected, immutable queue grant; never authority from candidate code."""
import base64
import hashlib
import json
import re
import time
from engine.intent_guard import ExecutionScope, timestamp

ROOT = 'onlykappa/KappaForge'
PATH = 'config/phase3-queue.json'
SHA = re.compile(r'[a-f0-9]{40}')
PUSH_TITLE = 'Owner-authorized coding queue'
PUSH_MESSAGE = 'Resume owner-authorized coding queue'
START_MARKER = 'KAPPA_QUEUE_START_V1'


def digest(body):
    return hashlib.sha256(body.encode()).hexdigest()


def manifest(value):
    if (not isinstance(value, dict) or set(value) != {'version', 'control', 'grant', 'enginePR', 'engineRef', 'tasks'}
            or value['version'] != 1 or type(value['control']) is not int or value['control'] < 1
            or type(value['enginePR']) is not int or value['enginePR'] < 1
            or not re.fullmatch(r'[a-f0-9]{64}', str(value['grant']))
            or not re.fullmatch(r'fix/[a-z0-9-]+', str(value['engineRef']))
            or not isinstance(value['tasks'], list) or not 1 <= len(value['tasks']) <= 8):
        raise PermissionError('Invalid finite queue grant')
    seen = set()
    for row in value['tasks']:
        if (not isinstance(row, dict) or set(row) != {'issue', 'digest', 'base', 'existing'}
                or type(row['issue']) is not int or row['issue'] < 1 or row['issue'] in seen
                or type(row['existing']) is not bool
                or not re.fullmatch(r'[a-f0-9]{64}', str(row['digest']))
                or row['base'] != (value['engineRef'] if row['existing'] else f"fix/phase3-queue-base-{row['issue']}")):
            raise PermissionError('Invalid or duplicate queued task')
        if row['existing'] and seen:
            raise PermissionError('Only the first task may adopt existing work')
        seen.add(row['issue'])
    return value


def control(grant, read, now=None):
    issue = read(f"repos/{ROOT}/issues/{grant['control']}")
    if (issue.get('pull_request') or issue.get('state') != 'open'
            or (issue.get('user') or {}).get('login') != 'onlykappa'
            or digest(issue.get('body') or '') != grant['grant']
            or timestamp(issue.get('created_at')) + 86400 <= (time.time() if now is None else now)):
        raise PermissionError('Queue grant closed, changed or expired')
    return issue


def owner_run(run_id, read, sha=None, ref=None, now=None, live=True):
    if not re.fullmatch(r'[1-9][0-9]*', str(run_id)):
        raise PermissionError('Queue workflow identity missing')
    run = read(f'repos/{ROOT}/actions/runs/{run_id}')
    if (run.get('event') not in ('workflow_dispatch', 'push') or run.get('path') != '.github/workflows/agent.yml'
            or (run.get('repository') or {}).get('full_name') != ROOT
            or (run.get('actor') or {}).get('login') != 'onlykappa'
            or (run.get('triggering_actor') or {}).get('login') != 'onlykappa'
            or not SHA.fullmatch(str(run.get('head_sha', '')))
            or sha is not None and run.get('head_sha') != sha
            or ref is not None and run.get('head_branch') != ref
            or live and run.get('status') != 'in_progress'):
        raise PermissionError('Queue lacks an authenticated owner-started workflow')
    file = read(f"repos/{ROOT}/contents/{PATH}?ref={run['head_sha']}")
    if file.get('path') != PATH or file.get('encoding') != 'base64':
        raise PermissionError('Pinned queue manifest unavailable')
    grant = manifest(json.loads(base64.b64decode(file['content']).decode()))
    title = PUSH_TITLE if run['event'] == 'push' else f"Agent task #{grant['control']} queue"
    if run.get('head_branch') != grant['engineRef'] or run.get('display_title') != title:
        raise PermissionError('Workflow did not select this queue')
    if run['event'] == 'push':
        commit = read(f"repos/{ROOT}/commits/{run['head_sha']}").get('commit') or {}
        at = timestamp((commit.get('committer') or {}).get('date'))
        started = timestamp(run.get('created_at'))
        if (commit.get('message') or '').strip() != PUSH_MESSAGE or not at or not started:
            raise PermissionError('Push did not explicitly request this owner queue')
        expected = dict(control=grant['control'], sha=run['head_sha'], manifest=digest(json.dumps(grant, sort_keys=True)))
        approved = False
        for page in range(1, 11):
            rows = read(f"repos/{ROOT}/issues/{grant['control']}/comments?per_page=100&page={page}")
            if not isinstance(rows, list):
                raise PermissionError('Owner queue start history unavailable')
            for row in rows:
                if ((row.get('user') or {}).get('login') != 'onlykappa'
                        or not at <= timestamp(row.get('created_at')) <= started):
                    continue
                marker = re.search(r'^<!-- ' + START_MARKER + r' (.*?) -->$', row.get('body') or '', re.M)
                try:
                    approved |= bool(marker and json.loads(marker[1]) == expected)
                except ValueError:
                    pass
            if approved or len(rows) < 100:
                break
        if not approved:
            raise PermissionError('Push requires a fresh exact-source owner queue start grant')
    pr = read(f"repos/{ROOT}/pulls/{grant['enginePR']}")
    if ((pr.get('user') or {}).get('login') != 'onlykappa'
            or (pr.get('base') or {}).get('ref') != 'main'
            or ((pr.get('base') or {}).get('repo') or {}).get('full_name') != ROOT
            or (pr.get('head') or {}).get('ref') != grant['engineRef']
            or ((pr.get('head') or {}).get('repo') or {}).get('full_name') != ROOT
            or live and (pr.get('state') != 'open' or pr.get('draft') is not True)):
        raise PermissionError('Queue engine is outside the owner accumulator')
    if live:
        control(grant, read, now)
    return grant


def task(grant, issue, now=None):
    row = next((r for r in grant['tasks'] if r['issue'] == issue.get('number')), None)
    scope = ExecutionScope(issue, now)
    if (row is None or scope.repo != ROOT or scope.mode != 'develop' or scope.digest != row['digest']
            or re.findall(r'^Base:\s*(\S+)\s*$', scope.body, re.M) != [row['base']]):
        raise PermissionError('Task differs from the pinned queue scope')
    return row


def receipt(value, scope, read, live=False):
    if (not isinstance(value, dict) or value.get('task') != scope.number or value.get('digest') != scope.digest
            or scope.repo != ROOT or value.get('originRun') != value.get('queueRun')
            or not SHA.fullmatch(str(value.get('sha', '')))
            or not isinstance(value.get('ref'), str)):
        raise PermissionError('Queue receipt does not match the task')
    grant = owner_run(value['queueRun'], read, value.get('sha'), value.get('ref'), live=live)
    if not any(r['issue'] == scope.number and r['digest'] == scope.digest for r in grant['tasks']):
        raise PermissionError('Task is absent from the owner queue grant')
    return grant


def bind(scope, read, env, previous=None):
    if previous:
        from engine.runtime_engine import verify_receipt
        verify_receipt(previous, scope, read)
    run_id = env.get('KAPPA_QUEUE_RUN')
    if run_id != env.get('GITHUB_RUN_ID') or env.get('INPUT_ACTION') not in ('queue-step', 'fix', 'verify'):
        raise PermissionError('Queue execution identity or action differs')
    value = dict(task=scope.number, digest=scope.digest, sha=env.get('GITHUB_SHA'),
                 ref=env.get('GITHUB_REF_NAME'), originRun=run_id, queueRun=run_id)
    grant = receipt(value, scope, read, live=True)
    task(grant, read(f'repos/{ROOT}/issues/{scope.number}'))
    def current():
        control(grant, read)
        run = read(f'repos/{ROOT}/actions/runs/{run_id}')
        if run.get('status') != 'in_progress' or run.get('head_sha') != value['sha']:
            raise PermissionError('Queue execution was cancelled or stopped')
    scope.queue_guard = current
    return value

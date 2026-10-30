"""Explicit owner handoff of an unpublished proposal to an existing reviewed draft.

A source-bound owner comment supplements the original live queue/task authority;
it never replaces its grant, expiry, immutable base, failed history or counters.
"""
import copy
import json
import os
import re

from engine import execution, queue_authority as authority, recovery
from engine.intent_guard import timestamp

MARKER = 'KAPPA_QUEUE_CANDIDATE_V1'
ENV = 'KAPPA_QUEUE_CANDIDATE_COMMENT'


def inspect(api, grant, row, saved, engine_sha, run_id, pr, now, rows=None):
    """Pure checks. Return a bound owner receipt, never infer approval from a PR."""
    from engine.task_queue import PREFIX, pages, active_agents
    if (saved.get('files') != [] or saved.get('pr') or row['existing']
            or row != grant['tasks'][0] or saved.get('executionPublication')
            or saved.get('executionPublished') or not saved.get('executionCheckpoint')):
        return None
    authority.control(grant, api, now)
    authority.task(grant, api(PREFIX + f"issues/{row['issue']}"), now)
    if authority.owner_run(run_id, api, engine_sha, live=True, now=now) != grant:
        raise PermissionError('Candidate handoff has foreign current queue authority')
    origin_id = (saved.get('engine') or {}).get('queueRun')
    origin = api(PREFIX + f'actions/runs/{origin_id}')
    if (origin.get('status') != 'completed' or origin.get('conclusion') not in ('failure', 'success')
            or authority.owner_run(origin_id, api, (saved.get('engine') or {}).get('sha'), live=False) != grant
            or active_agents(api, row['issue'])):
        raise PermissionError('Previous worker is active, cancelled or foreign')
    if not isinstance(pr, dict):
        return None
    base = saved.get('candidate')
    head = (pr.get('head') or {}).get('sha')
    if (pr.get('state') != 'open' or pr.get('draft') is not True
            or (pr.get('user') or {}).get('login') != 'onlykappa'
            or pr.get('html_url') != f"https://github.com/{authority.ROOT}/pull/{pr.get('number')}"
            or (pr.get('head') or {}).get('ref') != f"kappa/dev-{row['issue']}"
            or (pr.get('base') or {}).get('ref') != row['base']
            or (pr.get('base') or {}).get('sha') != base
            or any(((pr.get(side) or {}).get('repo') or {}).get('full_name') != authority.ROOT for side in ('head', 'base'))
            or not authority.SHA.fullmatch(str(head)) or not authority.SHA.fullmatch(str(base))
            or api(PREFIX + 'git/ref/heads/' + row['base'])['object']['sha'] != base
            or api(PREFIX + f"git/ref/heads/kappa/dev-{row['issue']}")['object']['sha'] != head):
        raise PermissionError('Candidate handoff is closed, foreign, moved or outside the immutable base')
    expected = dict(control=grant['control'], manifest=authority.digest(json.dumps(grant, sort_keys=True)),
        task=row['issue'], digest=row['digest'], fromRun=str(origin_id), fromCandidate=base,
        executionHash=saved['executionCheckpoint']['hash'], pr=pr['number'], candidate=head, engine=engine_sha)
    rows = pages(api, PREFIX + f"issues/{grant['control']}/comments") if rows is None else rows
    commit = api(PREFIX + f'commits/{head}')
    newest = timestamp(((commit.get('commit') or {}).get('committer') or {}).get('date'))
    stopped = timestamp(origin.get('updated_at'))
    if not newest or not stopped:
        raise PermissionError('Candidate handoff timestamps unavailable')
    approvals = []
    for comment in rows:
        if ((comment.get('user') or {}).get('login') != 'onlykappa'
                or not max(newest, stopped) <= timestamp(comment.get('created_at')) <= now):
            continue
        marker = re.search(r'^<!-- ' + MARKER + r' (.*?) -->$', comment.get('body') or '', re.M)
        try:
            if marker and json.loads(marker[1]) == expected:
                approvals.append(comment)
        except ValueError:
            pass
    if len(approvals) != 1:
        return None
    comparison = api(PREFIX + f'compare/{base}...{head}')
    files = comparison.get('files')
    commits = comparison.get('commits')
    if (comparison.get('status') != 'ahead' or (comparison.get('merge_base_commit') or {}).get('sha') != base
            or not isinstance(commits, list) or not 1 <= len(commits) <= recovery.MAX_ADOPTED_COMMITS
            or comparison.get('ahead_by') != len(commits)
            or not isinstance(files, list) or not 0 < len(files) < 300
            or len(files) != pr.get('changed_files')
            or len({f.get('filename') for f in files}) != len(files)
            or any(not isinstance(f.get('filename'), str)
                   or not f['filename'].startswith(('engine/', 'tests/', 'docs/phase3/'))
                   or f.get('previous_filename') and not f['previous_filename'].startswith(('engine/', 'tests/', 'docs/phase3/'))
                   for f in files)):
        raise PermissionError('Candidate handoff ancestry or bounded source inventory is invalid')
    runs = pages(api, PREFIX + f'actions/workflows/tests.yml/runs?head_sha={head}&event=pull_request', 'workflow_runs')
    matching = [r for r in runs if r.get('head_sha') == head and r.get('event') == 'pull_request'
                and r.get('path') == '.github/workflows/tests.yml'
                and (r.get('repository') or {}).get('full_name') == authority.ROOT]
    if not matching or matching[0].get('status') != 'completed' or matching[0].get('conclusion') != 'success':
        raise PermissionError('Owner candidate exact-source PR checks have not passed')
    return dict(expected, receipt=approvals[0]['id'], files=sorted(f['filename'] for f in files),
                validation=matching[0]['id'])


def adopt(journal, comment_id, env=None, previous_engine=None):
    """Called inside a freshly authenticated queue Fix before normal task work."""
    env = os.environ if env is None else env
    if env.get('INPUT_ACTION') != 'fix' or not callable(getattr(journal.scope, 'queue_guard', None)):
        raise PermissionError('Candidate handoff requires an explicit authenticated queue Fix')
    journal.scope.queue_guard()
    old = journal.state.get('ownerCandidateAdoption') or {}
    if old.get('receipt') == comment_id and old.get('candidate') == journal.state.get('candidate'):
        return  # The checkpoint committed before an acknowledgement was lost.
    from engine.task_queue import candidate, Blocked
    grant = authority.owner_run(env.get('KAPPA_QUEUE_RUN'), journal.read, env.get('GITHUB_SHA'), live=True, now=journal.clock())
    row = authority.task(grant, journal.issue, journal.clock())
    basis = dict(journal.state, engine=previous_engine or journal.state.get('engine'))
    try:
        pr = candidate(journal.read, row)
    except Blocked as error:
        raise PermissionError(str(error)) from None
    proof = inspect(journal.read, grant, row, basis, env.get('GITHUB_SHA'), env.get('KAPPA_QUEUE_RUN'),
                    pr, journal.clock())
    if not proof or proof['receipt'] != comment_id:
        raise PermissionError('No unique exact-source owner candidate handoff')
    saved = execution.pending(journal, 'develop')
    if (not saved or saved['identity'].get('base') != proof['fromCandidate']
            or saved.get('controller', {}).get('status') != 'failed'):
        raise execution.CheckpointMismatch('Handoff requires the retained failed unpublished proposal')
    from engine.sandbox_repair_controller import MAX_ATTEMPTS, MAX_MODEL_ACTIONS
    controller = saved['controller']
    if (not isinstance(controller.get('attempts'), list) or len(controller['attempts']) >= MAX_ATTEMPTS
            or type(controller.get('actions')) is not int or not 0 <= controller['actions'] < MAX_MODEL_ACTIONS):
        raise execution.CheckpointMismatch('Candidate handoff cannot bypass exhausted repair capacity')
    retired = {k: copy.deepcopy(journal.state[k]) for k in ('generationPlan', 'generationCheckpoint') if journal.state.get(k)}
    material = {k: execution._read_blob(journal, receipt) for k, receipt in retired.items() if receipt.get('parts')}
    original_write = journal.write
    before, committed = copy.deepcopy(journal.state), copy.deepcopy(journal._committed)
    expected = {k:v for k,v in proof.items() if k not in ('receipt', 'files', 'validation')}
    def guarded_write(*args, **kwargs):
        journal.scope.check_current(journal.read(f'repos/{recovery.ROOT}/issues/{journal.scope.number}'), now=journal.clock())
        authority.control(grant, journal.read, journal.clock())
        current_run = journal.read(f"repos/{recovery.ROOT}/actions/runs/{env['KAPPA_QUEUE_RUN']}")
        current_pr = journal.read(f"repos/{recovery.ROOT}/pulls/{proof['pr']}")
        approval = journal.read(f'repos/{recovery.ROOT}/issues/comments/{comment_id}')
        marker = re.search(r'^<!-- ' + MARKER + r' (.*?) -->$', approval.get('body') or '', re.M)
        try:
            approved = bool(marker and json.loads(marker[1]) == expected)
        except ValueError:
            approved = False
        if (current_run.get('status') != 'in_progress' or current_run.get('head_sha') != proof['engine']
                or current_pr.get('state') != 'open' or current_pr.get('draft') is not True
                or current_pr.get('head', {}).get('sha') != proof['candidate']
                or current_pr.get('base', {}).get('ref') != row['base']
                or (approval.get('user') or {}).get('login') != 'onlykappa' or not approved):
            raise PermissionError('Candidate handoff was revoked, moved or stopped during archival')
        return original_write(*args, **kwargs)
    journal.write = guarded_write
    try:
        # Preserve the complete old proposal before any fragment slot could rotate.
        journal.archive([dict(checkpoint=journal.state['executionCheckpoint'], proposal=saved, handoff=proof,
                              generationReceipts=retired, generationMaterial=material)], 'ownerCandidateHandoff')
        carry = execution._write_blob(journal, dict(version=1, task=journal.scope.number, repo=journal.scope.repo,
            scope=journal.scope.digest, candidate=proof['candidate'], receipt=comment_id, controller=saved['controller']))
        journal.state.update(ownerCandidateAdoption=proof, carriedRepair=carry,
            ownerCandidatePriorGeneration={k:v.get('hash') for k,v in retired.items()},
            supersededExecution=dict(hash=proof['executionHash'], base=proof['fromCandidate'], replacement=proof['candidate'],
                                     reason='owner_reviewed_fast_forward'),
            candidate=proof['candidate'], pr=f"https://github.com/{journal.scope.repo}/pull/{proof['pr']}",
            files=proof['files'], phase='review')
        at = int(journal.clock() * 1000)
        journal.state['executionDiagnostics'] = dict(stage='owner_review', status='queued',
            startedAt=at, updatedAt=at, finishedAt=0, attempt=len(controller['attempts']),
            finalValidation='pending', currentCommand=None, commands=[], attempts=[],
            previousSource=proof['fromCandidate'], previousCheckpoint=proof['executionHash'],
            history=['Previous failed source and all repair attempts retained in the handoff archive'])
        journal.event('Adopted the exact owner-reviewed draft; original failed proposal and counters archived intact',
                      outcome='recovering', strategy='owner_candidate_handoff', next_action='Review original requirements and verify this exact candidate')
    except BaseException:
        journal.state, journal._committed = before, committed
        raise
    finally:
        journal.write = original_write



def carry(journal, sha):
    """Transfer cumulative controller usage into the first repair of the adopted base."""
    if not journal.state.get('carriedRepair'):
        return {}
    value = execution._read_blob(journal, journal.state['carriedRepair'])
    proof = journal.state.get('ownerCandidateAdoption') or {}
    if (value.get('version') != 1 or value.get('task') != journal.scope.number or value.get('repo') != journal.scope.repo
            or value.get('scope') != journal.scope.digest or value.get('candidate') != sha
            or value.get('receipt') != proof.get('receipt') or not isinstance(value.get('controller'), dict)):
        raise execution.CheckpointMismatch('Retained repair history differs from the adopted candidate')
    state = copy.deepcopy(value['controller'])
    state.update(phase='candidate', owner_recheck=True)
    return state


def capture(journal):
    """Retain cumulative repair usage before a verified publication rotates slots."""
    proof = journal.state.get('ownerCandidateAdoption') or {}
    data = execution.pending(journal) if proof else None
    if data and data.get('context', {}).get('kind') == 'fix':
        value = dict(version=1, task=journal.scope.number, repo=journal.scope.repo,
                     scope=journal.scope.digest, candidate=journal.state['candidate'],
                     receipt=proof['receipt'], controller=data['controller'])
        journal.state['carriedRepair'] = execution._write_blob(journal, value, journal.state.get('carriedRepair'))

"""Engine provenance is independent of the untrusted candidate being edited."""
from contextvars import ContextVar
import os
from pathlib import Path
import re
import subprocess

ROOT = 'onlykappa/KappaForge'
SHA = re.compile(r'^[a-f0-9]{40}$')
ENGINE_PATHS = ('engine/', 'scripts/', '.github/', 'config/')  # Code that runs with secrets; candidate edits cannot supply it.
DISPATCH = ContextVar('verified_engine_dispatch', default=None)


def trial_pr(receipt, scope, read, current=False):
    """An owner dispatch may select an open same-repository engine PR, never a task candidate."""
    if (type(receipt.get('trialPR')) is not int or receipt['trialPR'] <= 0
            or not re.fullmatch(r'fix/' + str(scope.number) + r'-[a-z0-9-]+', receipt.get('ref', ''))):
        raise PermissionError('Engine trial requires a task-bound repair branch and PR')
    pr = read(f"repos/{ROOT}/pulls/{receipt['trialPR']}")
    if ((current and (pr.get('state') != 'open' or pr.get('draft') is not True))
            or (pr.get('user') or {}).get('login') != 'onlykappa'
            or (pr.get('base') or {}).get('ref') != 'main'
            or ((pr.get('base') or {}).get('repo') or {}).get('full_name') != ROOT
            or (pr.get('head') or {}).get('ref') != receipt['ref']
            or ((pr.get('head') or {}).get('repo') or {}).get('full_name') != ROOT
            or (current and (pr.get('head') or {}).get('sha') != receipt['sha'])):
        raise PermissionError('Engine trial PR is closed, foreign, stale or outside the owner repair branch')
    return pr


class EngineRefreshRequired(RuntimeError):
    category = 'engine_revision'


def verify_receipt(receipt, scope, read):
    if (not isinstance(receipt, dict) or receipt.get('task') != scope.number
            or receipt.get('digest') != scope.digest
            or (receipt.get('ref') != f'kappa/dev-{scope.number}' and 'trialPR' not in receipt)
            or scope.repo != ROOT or not SHA.fullmatch(str(receipt.get('sha', '')))
            or not re.fullmatch(r'[1-9][0-9]*', str(receipt.get('originRun', '')))):
        raise PermissionError('Engine receipt is invalid for this task')
    run = read(f"repos/{ROOT}/actions/runs/{receipt['originRun']}")
    if (run.get('event') != 'workflow_dispatch' or run.get('path') != '.github/workflows/agent.yml'
            or run.get('head_branch') != receipt['ref'] or run.get('head_sha') != receipt['sha']
            or (run.get('repository') or {}).get('full_name') != ROOT
            or not run.get('display_title', '').startswith(f'Agent task #{scope.number} ')
            or (run.get('actor') or {}).get('login') != 'onlykappa'
            or (run.get('triggering_actor') or {}).get('login') != 'onlykappa'):
        raise PermissionError('Engine revision lacks an authenticated owner-started workflow receipt')
    if 'trialPR' in receipt:
        if run.get('display_title') not in (f'Agent task #{scope.number} ', f'Agent task #{scope.number} fix'):
            raise PermissionError('Engine trial requires an explicit owner task dispatch')
        trial_pr(receipt, scope, read)
    return receipt


def attest(scope, read, previous=None, env=None, checkout=None):
    env = os.environ if env is None else env
    sha, run_id, ref = env.get('GITHUB_SHA', ''), env.get('GITHUB_RUN_ID', ''), env.get('GITHUB_REF_NAME', '')
    if (env.get('GITHUB_REPOSITORY') != ROOT or not SHA.fullmatch(sha)
            or not re.fullmatch(r'[1-9][0-9]*', run_id)):
        raise PermissionError('Engine workflow identity is missing')
    checkout = checkout or subprocess.check_output(['git', 'rev-parse', 'HEAD'],
        cwd=Path(__file__).resolve().parents[1], text=True).strip()
    if checkout != sha:
        raise PermissionError('Engine checkout does not match the workflow revision')
    run = read(f'repos/{ROOT}/actions/runs/{run_id}')
    if (run.get('event') != 'workflow_dispatch' or run.get('path') != '.github/workflows/agent.yml'
            or run.get('head_branch') != ref or run.get('head_sha') != sha
            or (run.get('repository') or {}).get('full_name') != ROOT):
        raise PermissionError('Current engine run does not match GitHub workflow provenance')
    if ref == 'main':
        current = read(f'repos/{ROOT}/git/ref/heads/main')['object']['sha']
        if current != sha:
            raise EngineRefreshRequired('Main engine advanced; restart on its current revision before task work')
        if previous:
            verify_receipt(previous, scope, read)
            merged = read(f"repos/{ROOT}/compare/{previous['sha']}...{current}")
            if (merged.get('status') not in ('ahead', 'identical')
                    or (merged.get('merge_base_commit') or {}).get('sha') != previous['sha']):
                # A fresh owner Fix on reviewed main explicitly chooses that engine.
                # Squash merges and reviewed main updates need not retain the trial's
                # ancestry. Automatic continuations cannot acquire this authority.
                owner_fix = (env.get('INPUT_ACTION') == 'fix'
                             and run.get('display_title') == f'Agent task #{scope.number} fix'
                             and (run.get('actor') or {}).get('login') == 'onlykappa'
                             and (run.get('triggering_actor') or {}).get('login') == 'onlykappa')
                if not owner_fix:
                    raise PermissionError('Main does not include the authorized engine revision; recovery cannot downgrade')
        return None
    if re.fullmatch(r'fix/' + str(scope.number) + r'-[a-z0-9-]+', ref) and env.get('INPUT_ACTION', '') in ('', 'fix'):
        if previous:
            verify_receipt(previous, scope, read)
        prs = read(f'repos/{ROOT}/pulls?state=open&head=onlykappa:{ref}&per_page=2')
        if not isinstance(prs, list) or len(prs) != 1:
            raise PermissionError('Engine trial requires exactly one open repair PR')
        receipt = dict(task=scope.number, digest=scope.digest, ref=ref, sha=sha,
                       originRun=run_id, trialPR=prs[0]['number'])
        verify_receipt(receipt, scope, read)
        pr = trial_pr(receipt, scope, read, current=True)
        if read(f'repos/{ROOT}/git/ref/heads/{ref}')['object']['sha'] != sha:
            raise PermissionError('Engine trial branch moved before task work')
        main = read(f'repos/{ROOT}/git/ref/heads/main')['object']['sha']
        comparison = read(f'repos/{ROOT}/compare/{main}...{sha}')
        files = comparison.get('files')
        if (comparison.get('status') != 'ahead' or (comparison.get('merge_base_commit') or {}).get('sha') != main
                or not isinstance(files, list) or not 0 < len(files) < 300
                or pr.get('changed_files') != len(files)
                or any(not isinstance(f.get('filename'), str)
                       or f['filename'].startswith(('.github/', 'scripts/', 'config/'))
                       or str(f.get('previous_filename', '')).startswith(('.github/', 'scripts/', 'config/')) for f in files)):
            raise PermissionError('Engine trial requires current main ancestry and unchanged workflow, scripts and configuration')
        return receipt
    if ref == f'kappa/dev-{scope.number}' and env.get('INPUT_ACTION', '') in ('fix', '', 'verify'):
        receipt = dict(task=scope.number, digest=scope.digest, ref=ref, sha=sha, originRun=run_id)
        verify_receipt(receipt, scope, read)
        if read(f'repos/{ROOT}/git/ref/heads/{ref}')['object']['sha'] != sha:
            raise PermissionError('Owner-started engine branch moved; verify its current revision before task work')
        main = read(f'repos/{ROOT}/git/ref/heads/main')['object']['sha']
        changed = read(f'repos/{ROOT}/compare/{main}...{sha}').get('files') or []
        if any(f.get('filename', '').startswith(ENGINE_PATHS) for f in changed):
            raise PermissionError('Branch engine changes the engine; trial engines must come from reviewed main')
        return receipt
    receipt = verify_receipt(previous, scope, read)
    expected = f'kappa/recovery-{scope.number}-{scope.digest[:12]}-'
    if not ref.startswith(expected) or not re.fullmatch(r'[1-9][0-9]*', ref[len(expected):]) or sha != receipt['sha']:
        raise PermissionError('Recovery engine differs from the authorized engine revision')
    if read(f'repos/{ROOT}/git/ref/heads/{ref}')['object']['sha'] != sha:
        raise PermissionError('Immutable recovery engine ref moved')
    return receipt


def permits(ref, scope=None):
    receipt = DISPATCH.get()
    if not receipt or ref != receipt.get('ref'):
        return False
    if scope is None:
        from engine.intent_guard import ACTIVE
        scope = ACTIVE.get()
    return bool(scope and receipt.get('task') == scope.number and receipt.get('digest') == scope.digest
                and SHA.fullmatch(str(receipt.get('sha', ''))))

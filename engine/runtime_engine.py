"""Engine provenance is independent of the untrusted candidate being edited."""
from contextvars import ContextVar
import os
from pathlib import Path
import re
import subprocess

ROOT = 'onlykappa/KappaForge'
SHA = re.compile(r'^[a-f0-9]{40}$')
DISPATCH = ContextVar('verified_engine_dispatch', default=None)


class EngineRefreshRequired(RuntimeError):
    category = 'engine_revision'


def verify_receipt(receipt, scope, read):
    if (not isinstance(receipt, dict) or receipt.get('task') != scope.number
            or receipt.get('digest') != scope.digest or receipt.get('ref') != f'kappa/dev-{scope.number}'
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
                raise PermissionError('Main does not include the authorized engine revision; recovery cannot downgrade')
        return None
    if ref == f'kappa/dev-{scope.number}' and env.get('INPUT_ACTION', '') in ('fix', '', 'verify'):
        receipt = dict(task=scope.number, digest=scope.digest, ref=ref, sha=sha, originRun=run_id)
        verify_receipt(receipt, scope, read)
        if read(f'repos/{ROOT}/git/ref/heads/{ref}')['object']['sha'] != sha:
            raise PermissionError('Owner-started engine branch moved; verify its current revision before task work')
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

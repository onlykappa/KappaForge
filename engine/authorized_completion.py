"""Verify an explicitly merge-requested task after trusted independent tests.

Merging is the owner's: the agent never marks a PR ready or merges it (KAPPA.md section 6; the execution scope refuses
both). A verified PR is reported as waiting for the owner's Merge button.

Runs from main, never checks out candidate code. GitHub protections still apply.
"""
import json
import os
import re
import time
from engine.intent_guard import MARKER, WRITE_MODES, activate
from engine.native_build import title as native_title
from engine.runner import ROOT, request
from engine.verify import open_problems


# GitHub computes mergeability lazily, and the native build usually finishes after the sandbox tests.
MERGEABLE_POLLS = 6
CHECK_POLLS = 40
POLL_SECONDS = 30


def complete(run, api, wait=time.sleep):
    if run.get('event') != 'workflow_dispatch' or run.get('conclusion') != 'success' or run.get('head_branch') != 'main':
        return 'not_verified'
    if run.get('repository', {}).get('full_name') != 'onlykappa/KappaForge':
        return 'foreign_run'
    match = re.fullmatch(r'(?:Sandbox validation|Project validation ([\w.-]+)) (kappa/dev-(\d+)) @ ([a-f0-9]{40})', run.get('display_title', ''))
    if not match:
        return 'not_development'
    name, branch, number, sha = match.groups()
    repo = 'onlykappa/' + (name or 'KappaForge')
    expected = '.github/workflows/' + ('project-tests.yml' if name else 'sandbox-tests.yml')
    if run.get('path') != expected:
        return 'untrusted_workflow'
    issue = api(f'repos/onlykappa/KappaForge/issues/{number}')
    scope = activate(issue)
    provenance = MARKER.findall(scope.body)
    if scope.mode not in WRITE_MODES or scope.restrictions.get('noMerge') or not provenance or json.loads(provenance[0]).get('allowMerge') is not True or repo != scope.repo:
        return 'merge_not_authorized'
    prs = api(f'repos/{repo}/pulls?state=open&head=onlykappa:{branch}')
    if len(prs) != 1:
        return 'no_unique_pr'
    pr = api(f'repos/{repo}/pulls/{prs[0]["number"]}')
    if open_problems(pr):
        return 'requirements_incomplete'
    for _ in range(MERGEABLE_POLLS):
        if pr.get('mergeable') is not None:
            break
        wait(5)
        pr = api(f'repos/{repo}/pulls/{prs[0]["number"]}')
    if pr.get('head', {}).get('sha') != sha or pr.get('head', {}).get('repo', {}).get('full_name') != repo or pr.get('base', {}).get('repo', {}).get('full_name') != repo:
        return 'superseded'
    if pr.get('mergeable') is not True:
        return 'merge_blocked'
    for _ in range(CHECK_POLLS):
        checks = api(f'repos/{repo}/commits/{sha}/check-runs?per_page=100')
        if not any(c.get('status') != 'completed' for c in checks.get('check_runs', [])):
            break
        wait(POLL_SECONDS)
    if checks.get('total_count', 0) > 100 or any(c.get('status') != 'completed' or c.get('conclusion') not in {'success', 'skipped', 'neutral'} for c in checks.get('check_runs', [])):
        return 'checks_pending_or_failed'
    files = api(f'repos/{repo}/pulls/{pr['number']}/files?per_page=100')
    native_changes = repo == 'onlykappa/KappaForge' and (len(files) >= 100 or any(f.get('filename', '').startswith(('ios/', 'preview/', 'config/', 'scripts/', '.github/')) for f in files))
    if native_changes and not any(c.get('name') == 'native' and c.get('conclusion') == 'success' for c in checks.get('check_runs', [])):
        # Agent PRs are built by a dispatched "iOS build <branch> @ <sha>" run, which reports on main's commit.
        build = None
        for _ in range(CHECK_POLLS):
            runs = api(f'repos/{ROOT}/actions/workflows/ios-build.yml/runs?per_page=50').get('workflow_runs', [])
            build = next((r for r in runs if r.get('display_title') == native_title(branch, sha)
                          and r.get('event') == 'workflow_dispatch' and r.get('head_branch') == 'main'), None)
            if build and build.get('status') == 'completed':
                break
            wait(POLL_SECONDS)
        if not build or build.get('conclusion') != 'success':
            return 'native_verification_required'
    statuses = api(f'repos/{repo}/commits/{sha}/status')
    if statuses.get('total_count', 0) > 100 or (statuses.get('statuses') and statuses.get('state') != 'success'):
        return 'statuses_pending_or_failed'
    return 'owner_merge_required'


def main():
    token = os.environ['GITHUB_TOKEN']
    def api(path, payload=None, method=None):
        return request('https://api.github.com/' + path, payload, token, method)
    run_id = os.environ['VERIFIED_RUN_ID']
    if not run_id.isdecimal():
        raise ValueError('Invalid verification run')
    run = api('repos/onlykappa/KappaForge/actions/runs/' + run_id)
    print('Authorized completion:', complete(run, api))


if __name__ == '__main__':
    main()

"""Complete an explicitly merge-authorized task after trusted independent tests.

Runs from main, never checks out candidate code. GitHub protections still apply.
"""
import json
import os
import re
from engine.intent_guard import MARKER, WRITE_MODES, activate
from engine.runner import request


def complete(run, api):
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
    if scope.mode not in WRITE_MODES or not provenance or json.loads(provenance[0]).get('allowMerge') is not True or repo != scope.repo:
        return 'merge_not_authorized'
    prs = api(f'repos/{repo}/pulls?state=open&head=onlykappa:{branch}')
    if len(prs) != 1:
        return 'no_unique_pr'
    pr = api(f'repos/{repo}/pulls/{prs[0]["number"]}')
    if pr.get('head', {}).get('sha') != sha or pr.get('head', {}).get('repo', {}).get('full_name') != repo or pr.get('base', {}).get('repo', {}).get('full_name') != repo:
        return 'superseded'
    if pr.get('mergeable') is not True:
        return 'merge_blocked'
    checks = api(f'repos/{repo}/commits/{sha}/check-runs?per_page=100')
    if checks.get('total_count', 0) > 100 or any(c.get('status') != 'completed' or c.get('conclusion') not in {'success', 'skipped', 'neutral'} for c in checks.get('check_runs', [])):
        return 'checks_pending_or_failed'
    statuses = api(f'repos/{repo}/commits/{sha}/status')
    if statuses.get('total_count', 0) > 100 or (statuses.get('statuses') and statuses.get('state') != 'success'):
        return 'statuses_pending_or_failed'
    scope.release_pr = pr['number']
    scope.release_sha = sha
    scope.release_node = pr.get('node_id')
    scope.transition('executing')
    scope.transition('verifying')
    if pr.get('draft'):
        api('graphql', {'query': 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}', 'variables': {'id': scope.release_node}})
    result = api(f'repos/{repo}/pulls/{pr["number"]}/merge', {'sha': sha, 'merge_method': 'squash'}, 'PUT')
    if result.get('merged') is not True:
        return 'merge_blocked'
    scope.transition('completed')
    return 'merged'


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

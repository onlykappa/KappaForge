"""Observe the browser job for the exact PR source; browser failures are repair evidence."""
from engine.coder import gh
from engine.runner import ROOT


def needed(repo, paths):
    return repo == ROOT and any(p.startswith(('preview/', 'ios/KappaForge/Web/', 'tests/web-', 'tools/visual-')) for p in paths)


def result(branch, sha, token):
    rows = gh(f'repos/{ROOT}/actions/workflows/tests.yml/runs?head_sha={sha}&per_page=100', token).get('workflow_runs', [])
    for run in rows:
        if (run.get('head_sha') != sha or run.get('head_branch') != branch or run.get('event') != 'pull_request'
                or run.get('path') != '.github/workflows/tests.yml'):
            continue
        jobs = gh(f"repos/{ROOT}/actions/runs/{run['id']}/jobs?per_page=100", token).get('jobs', [])
        web = next((j for j in jobs if j.get('name') == 'web'), None)
        if not web:
            return None
        return dict(run, status=web['status'], conclusion=web.get('conclusion'), evidenceKind='browser', browserJob=web['id'])
    return None

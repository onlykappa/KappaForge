"""Admission to existing free execution capacity. No provisioning or billing mutations.

Public standard Actions jobs are unmetered; private allowances and custom runners
cannot prove a zero-cost reservation, so this policy does not select them.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.parse
import urllib.request

ROOT = 'onlykappa/KappaForge'
WORKFLOWS = frozenset(('agent.yml', 'sandbox-tests.yml', 'project-tests.yml', 'review-graph.yml', 'ios-build.yml', 'recovery.yml', 'continuous.yml'))
RUNNERS = frozenset(('ubuntu-latest', 'macos-15'))
LINUX_RUNNERS = frozenset(('ubuntu-latest',))
WORKFLOW_DIR = Path(__file__).resolve().parents[1] / '.github' / 'workflows'
POLICY = json.loads((WORKFLOW_DIR.parents[1] / 'config/execution-infrastructure.json').read_text(encoding='utf-8'))
MIB = 1024 ** 2


class InfrastructureBlocked(PermissionError):
    category = 'execution_resource'
    terminal = True


def blocked(reason):
    return InfrastructureBlocked('Free execution unavailable: ' + reason +
        ' No paid capacity, remote Docker, or host execution was selected. Correct the reported condition and retry.')


def read(path, token=None):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'KappaForge-Free-Execution',
               'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        request = urllib.request.Request('https://api.github.com/' + path, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read(512_001))
    except Exception as exc:
        # Never echo API response bodies, URLs carrying credentials, or environment values.
        raise blocked('GitHub permissions/resource metadata could not be verified (' + type(exc).__name__ +
                      '); restore repository/Actions read access or wait for GitHub availability.') from None


def public_repository(get):
    metadata = get('repos/' + ROOT)
    if (not isinstance(metadata, dict) or metadata.get('full_name') != ROOT
            or metadata.get('private') is not False or metadata.get('visibility') != 'public'
            or metadata.get('archived') is not False or metadata.get('disabled', False) is not False):
        raise blocked('the execution repository must be the active public ' + ROOT +
                      '; private-repository allowances and billing settings are not a free-capacity guarantee.')


def metadata_reader(get, token=None):
    fetch = get or (lambda path: read(path, token))
    def checked(path):
        try:
            data = fetch(path)
            if not isinstance(data, dict):
                raise ValueError('metadata shape')
            return data
        except InfrastructureBlocked:
            raise
        except Exception as exc:
            raise blocked('GitHub permissions/resource metadata could not be verified (' + type(exc).__name__ +
                          '); restore repository/Actions read access or wait for GitHub availability.') from None
    return checked


def workflow_runners(text):
    """Accept only the repository's deliberately simple, literal job declarations.

    This is not a general YAML parser. Unknown/indirect job syntax needs review,
    rather than interpreting a runner expression or reusable workflow as free.
    """
    match = re.search(r'^jobs:\s*\n((?:[ \t].*\n|\n|#.*\n)*)', text + '\n', re.M)
    if not match or len(re.findall(r'^jobs:', text, re.M)) != 1:
        raise blocked('workflow jobs do not have the reviewed literal runner structure.')
    declarations = re.findall(r'^  ([^\s#].*)$', match[1], re.M)
    if (any(not re.fullmatch(r'[A-Za-z0-9_-]+:', row) for row in declarations)
            or len(set(declarations)) != len(declarations)):
        raise blocked('workflow contains indirect or duplicate job declarations.')
    jobs = re.split(r'^  [A-Za-z0-9_-]+:\s*\n', match[1], flags=re.M)[1:]
    if not jobs:
        raise blocked('workflow has no verifiable standard runner jobs.')
    selected = []
    for job in jobs:
        for line in re.findall(r'^    ([^\s#].*)$', job, re.M):
            if line.startswith('- '):  # Existing workflows use indentless step sequences.
                continue
            key = re.match(r'([a-z][a-z-]*):', line)
            if not key or key[1] not in ('name', 'if', 'runs-on', 'permissions', 'steps', 'needs', 'timeout-minutes',
                                        'outputs', 'env', 'concurrency', 'defaults', 'continue-on-error'):
                raise blocked('workflow contains an unreviewed job resource declaration.')
        labels = re.findall(r'^    runs-on: ([A-Za-z0-9.-]+)\s*$', job, re.M)
        if len(labels) != 1 or labels[0] not in RUNNERS or re.search(r'^    (?:uses|strategy):', job, re.M):
            raise blocked('workflow requests an unreviewed, dynamic, reusable, self-hosted or larger runner; use the existing standard runners.')
        selected.extend(labels)
    return selected


def authorize_dispatch(url, payload, token=None, get=None):
    """Recheck free classification before the API call which can allocate a job."""
    parsed = urllib.parse.urlsplit(url)
    if re.search(r'/actions/(?:runs|jobs)/[^/]+/(?:rerun|rerun-failed-jobs)/?$', parsed.path):
        # A re-run repeats whatever runners and ref the original run used, which this guard cannot pin.
        raise blocked('automatic workflow re-runs are not admitted; the engine dispatches the reviewed workflow instead.')
    if not parsed.path.endswith('/dispatches'):
        return
    match = re.fullmatch(r'/repos/onlykappa/KappaForge/actions/workflows/([A-Za-z0-9.-]+)/dispatches', parsed.path)
    if parsed.scheme != 'https' or parsed.netloc != 'api.github.com' or parsed.query or not match or match[1] not in WORKFLOWS:
        raise blocked('automatic infrastructure dispatch is outside the reviewed workflow allowlist.')
    ref = (payload or {}).get('ref')
    if ref not in ('main', 'codex/phase4-cloud-execution'):
        raise blocked('workflow execution requires its existing reviewed ref.')
    get = metadata_reader(get, token)
    public_repository(get)
    workflow = match[1]
    metadata = get(f'repos/{ROOT}/actions/workflows/{workflow}')
    if metadata.get('state') != 'active' or metadata.get('path') != '.github/workflows/' + workflow:
        raise blocked('the approved Actions workflow is unavailable or disabled; enable the reviewed workflow without upgrading capacity.')
    sha = get(f'repos/{ROOT}/git/ref/heads/{ref}').get('object', {}).get('sha', '')
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise blocked('the reviewed workflow ref could not be resolved.')
    file = get(f'repos/{ROOT}/contents/.github/workflows/{workflow}?ref={sha}')
    try:
        if file.get('encoding') != 'base64' or file.get('path') != '.github/workflows/' + workflow:
            raise ValueError('file metadata')
        text = base64.b64decode(file['content'], validate=False).decode('utf-8').replace('\r\n', '\n')
        reviewed = (WORKFLOW_DIR / workflow).read_text(encoding='utf-8')
    except (ValueError, KeyError, OSError, UnicodeError):
        raise blocked('the workflow source could not be checked against this reviewed engine.') from None
    if (POLICY.get('version') != 1 or POLICY.get('repository') != ROOT or set(POLICY.get('runners', [])) != RUNNERS
            or set(POLICY.get('workflows', {})) != WORKFLOWS
            or hashlib.sha256(text.encode()).hexdigest() != POLICY['workflows'].get(workflow) or text != reviewed):
        raise blocked('the workflow changed since this engine started; restart from the reviewed main revision.')
    runners = workflow_runners(text)
    if get(f'repos/{ROOT}/git/ref/heads/{ref}').get('object', {}).get('sha') != sha:
        raise blocked('the workflow ref moved during admission; retry against the current reviewed revision.')
    return dict(repository=ROOT, workflow=workflow, revision=sha, runners=runners, free=True)


def runtime(get=None, env=None):
    env = os.environ if env is None else env
    if (env.get('GITHUB_ACTIONS') != 'true' or env.get('GITHUB_REPOSITORY') != ROOT
            or env.get('RUNNER_ENVIRONMENT') != 'github-hosted' or env.get('RUNNER_OS') != 'Linux'
            or env.get('GITHUB_SERVER_URL') != 'https://github.com'):
        raise blocked('sandbox execution requires the existing standard GitHub-hosted Linux job in the public execution repository.')
    run, attempt = env.get('GITHUB_RUN_ID', ''), env.get('GITHUB_RUN_ATTEMPT', '')
    if not re.fullmatch('[1-9][0-9]*', run) or not re.fullmatch('[1-9][0-9]*', attempt) or not env.get('RUNNER_NAME'):
        raise blocked('the current Actions run, attempt or runner identity is missing.')
    get = metadata_reader(get, env.get('GITHUB_TOKEN'))
    public_repository(get)
    data = get(f'repos/{ROOT}/actions/runs/{run}/attempts/{attempt}/jobs?per_page=100')
    rows = data.get('jobs')
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise blocked('Actions did not return verifiable current-job metadata; restore Actions read access.')
    jobs = [job for job in rows if job.get('runner_name') == env['RUNNER_NAME']
            and job.get('status') == 'in_progress' and job.get('run_id') == int(run)]
    if (type(data.get('total_count')) is not int or data['total_count'] > 100 or len(jobs) != 1
            or type(jobs[0].get('id')) is not int or jobs[0]['id'] <= 0
            or jobs[0].get('labels') not in ([label] for label in LINUX_RUNNERS)):
        raise blocked('the actual running job is not a verified standard ubuntu-latest allocation; restore Actions read access and use the existing runner.')
    return dict(repository=ROOT, run=int(run), attempt=int(attempt), job=jobs[0]['id'],
                runner=jobs[0]['labels'][0], free=True)


def local_endpoint(env=None):
    env = os.environ if env is None else env
    if (env.get('DOCKER_HOST', '') not in ('', 'unix:///var/run/docker.sock', 'unix:///run/docker.sock')
            or env.get('DOCKER_CONTEXT', '') not in ('', 'default')):
        raise blocked('a remote or custom Docker endpoint/context is configured; remove it and use the runner-local Docker socket.')


def host_resources(root):
    try:
        memory = re.search(r'^MemAvailable:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)
        if not memory:
            raise ValueError('MemAvailable')
        return dict(memory=int(memory[1]) * 1024, disk=shutil.disk_usage(root).free)
    except (OSError, ValueError):
        raise blocked('available host memory/disk cannot be measured; restore read access to the local resource counters.') from None


def resources(docker, profile, preparing=False, stats=None):
    """Check actual daemon access, isolation controls and already allocated headroom."""
    local_endpoint()
    result = docker.call(['info', '--format', '{{json .}}'], timeout=30)
    try:
        info = json.loads(result.stdout) if result.returncode == 0 else {}
        if (info.get('OSType') != 'linux' or any(info.get(key) is not True for key in
                ('MemoryLimit', 'SwapLimit', 'CpuCfsQuota', 'PidsLimit'))
                or not any(str(option).startswith('name=seccomp') for option in info.get('SecurityOptions', []))):
            raise blocked('the local Docker daemon lacks required memory, swap, CPU, PID or seccomp enforcement; restore the standard Linux daemon.')
        if not re.fullmatch(r'[1-9][0-9]*m', profile.memory):
            # Engine profiles use m/g suffixes; parse the latter explicitly below.
            if not re.fullmatch(r'[1-9][0-9]*g', profile.memory):
                raise blocked('the requested memory profile is not bounded.')
        memory = int(profile.memory[:-1]) * MIB * (1024 if profile.memory[-1] == 'g' else 1)
        cpus = float(profile.cpus)
        if (not 0 < cpus <= 2 or not 0 < memory <= 2048 * MIB or not 0 < profile.pids <= 256
                or not 0 < profile.work_mb <= 1024 or not 0 < profile.tmp_mb <= 512
                or not 0 < profile.timeout <= 900 or not 0 < profile.output_bytes <= 200_000):
            raise blocked('the requested profile exceeds existing sandbox resource limits.')
        root = info.get('DockerRootDir')
        if not isinstance(root, str) or not root.startswith('/'):
            raise blocked('the local Docker storage location is unknown.')
        free = (stats or host_resources)(root)
        if (info.get('NCPU', 0) < cpus or info.get('MemTotal', 0) < memory
                or free['memory'] < memory + 512 * MIB or free['disk'] < (4096 if preparing else 1024) * MIB):
            raise blocked('insufficient CPU, memory or disk in the existing allocation; wait for capacity or remove stale sandbox data. Do not upgrade the runner.')
        return dict(cpus=info['NCPU'], availableMemory=free['memory'], availableDisk=free['disk'])
    except (ValueError, TypeError, KeyError):
        raise blocked('the local Docker resource report is missing or invalid; restore daemon access and retry.') from None


def main():
    # -m initially loads this file as __main__; Docker imports the package class.
    from engine.infrastructure import InfrastructureBlocked as AdmissionBlocked
    from engine.sandbox import Docker, PROFILES, SandboxUnavailable
    try:
        print(json.dumps(Docker().authorize(PROFILES['test'], preparing=True), sort_keys=True))
    except (AdmissionBlocked, SandboxUnavailable) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())

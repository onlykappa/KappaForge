"""Isolated, short-lived execution of candidate code before any commit (Phase 1, step 2).

The engine holds the candidate tree in memory and never runs repository code itself: every command runs in a Docker
container on the same GitHub-hosted runner, from a fresh copy of the candidate on a size-limited tmpfs, with no network,
no runner environment, no credentials, a read-only root filesystem, an unprivileged user and CPU, memory, process and
time limits. Dependencies are installed by a separate container that receives only the manifests and lockfiles.

Repository files, test output and tool responses are untrusted. Profiles, images and network settings come from this
module, never from the repository. Without Docker the sandbox stops with SandboxUnavailable: it never falls back to
running candidate code on the runner. See docs/phase1/execution-architecture.md for the threat model and limits.
"""
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import difflib
import io
import json
import os
import re
import shlex
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request
import uuid

MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_DEPS_MB = 2048
PYTHON_VERSIONS = ('3.10', '3.11', '3.12', '3.13')
NODE_VERSIONS = ('18', '20', '22', '24')
DEFAULT_PYTHON, DEFAULT_NODE = '3.13', '22'
UID = '65534:65534'
# Shell operators mean nothing without a shell, and none is ever used: a command is one program and its arguments.
SHELL_TOKENS = re.compile(r'^(?:\||\|\||&&?|;|>>?|<<?|2>&1|\$\(.*|`.*)$')
SECRET_PATTERNS = re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|'
                             r'xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})')


class SandboxUnavailable(RuntimeError):
    """Compliant isolated execution is not possible here; nothing ran. The message says what to fix."""
    terminal = True
    category = 'sandbox_unavailable'


class CommandRejected(ValueError):
    category = 'sandbox_policy'


@dataclass(frozen=True)
class Profile:
    name: str
    network: bool
    cpus: str
    memory: str
    pids: int
    work_mb: int
    tmp_mb: int
    timeout: int
    output_bytes: int


PROFILES = {
    'check': Profile('check', False, '1', '512m', 128, 512, 64, 120, 64_000),
    'test': Profile('test', False, '2', '2g', 256, 1024, 256, 900, 200_000),
    'install': Profile('install', True, '2', '2g', 256, 256, 512, 600, 64_000),
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def redact(text):
    """Remove secret-shaped strings and the runner's secret environment values from untrusted output."""
    text = SECRET_PATTERNS.sub('[redacted]', text)
    for name, value in os.environ.items():
        if len(value) >= 4 and re.search(r'TOKEN|SECRET|PASSWORD|API_?KEY|WEBHOOK|CREDENTIAL|PRIVATE|AUTH|DSN|DATABASE_URL', name, re.I):
            text = text.replace(value, '[redacted]')
    text = re.sub(r'(?i)(https?://)[^/\s:@]+:[^/\s@]+@', r'\1[redacted]@', text)
    text = re.sub(r'(?i)(authorization\s*[:=]\s*(?:bearer|basic)\s+)\S+', r'\1[redacted]', text)
    return text


def safe_path(path):
    """A relative POSIX path that stays inside the workspace and is not Git's own data."""
    return (isinstance(path, str) and 0 < len(path) <= 400 and '\\' not in path and '\0' not in path
            and not path.startswith('/') and all(part not in ('', '.', '..') for part in path.split('/'))
            and not (path == '.git' or path.startswith('.git/')))


@dataclass
class RunResult:
    """One command's machine-readable outcome. status: passed, failed, timeout, rejected, skipped or error."""
    argv: list
    profile: str
    status: str
    exit_code: int = None
    started_at: str = ''
    finished_at: str = ''
    duration_s: float = 0.0
    stdout: str = ''
    stderr: str = ''
    truncated: bool = False
    image: str = ''
    reason: str = ''
    source: str = 'engine'
    test_counts: dict = field(default_factory=dict)

    @property
    def ok(self):
        return self.status == 'passed'

    def to_dict(self):
        return asdict(self)


class _Bounded:
    """Keeps the first and last part of a stream so a flood of output cannot exhaust memory."""
    def __init__(self, limit):
        self.half, self.head, self.tail, self.total = max(1, limit // 2), bytearray(), bytearray(), 0

    def feed(self, chunk):
        self.total += len(chunk)
        room = self.half - len(self.head)
        if room > 0:
            self.head += chunk[:room]
            chunk = chunk[room:]
        if chunk:
            self.tail += chunk
            del self.tail[:max(0, len(self.tail) - self.half)]

    @property
    def truncated(self):
        return self.total > len(self.head) + len(self.tail)

    def text(self):
        omitted = self.total - len(self.head) - len(self.tail)
        data = bytes(self.head) + (f'\n[... {omitted} bytes omitted ...]\n'.encode() if omitted else b'') + bytes(self.tail)
        return redact(data.decode('utf-8', 'replace'))


@dataclass
class Exec:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    truncated: bool = False


class Docker:
    """The only place a process is started. Tests substitute a fake that records the arguments."""
    def __init__(self, binary='docker'):
        self.binary = binary

    def call(self, args, stdin=b'', timeout=60, limit=64_000, on_timeout=None):
        from engine.infrastructure import local_endpoint
        local_endpoint()
        # Explicit local transport and an empty configuration prevent Docker contexts,
        # credential helpers and remote builders in the runner's home from being used.
        with tempfile.TemporaryDirectory(prefix='kappa-docker-') as config:
            return self._call(args, config, stdin, timeout, limit, on_timeout)

    def authorize(self, profile, preparing=False):
        from engine import infrastructure
        infrastructure.local_endpoint()
        receipt = infrastructure.runtime()
        receipt.update(infrastructure.resources(self, profile, preparing))
        receipt['checkedAt'] = now()
        return receipt

    def _call(self, args, config, stdin, timeout, limit, on_timeout):
        try:
            # The CLI itself gets no secrets either, so even a mistaken "--env NAME" could not copy one into a container.
            env = {k: v for k, v in os.environ.items() if k in ('PATH', 'XDG_RUNTIME_DIR')}
            proc = subprocess.Popen([self.binary, '--host', 'unix:///var/run/docker.sock', '--config', config, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=env)
        except OSError as exc:
            raise SandboxUnavailable('Docker could not be started: ' + type(exc).__name__) from None
        out, err = _Bounded(limit), _Bounded(limit)

        def pump(stream, sink):
            for chunk in iter(lambda: stream.read(65536), b''):
                sink.feed(chunk)

        def feed():
            try:
                proc.stdin.write(stdin)
            except (BrokenPipeError, OSError):
                pass
            finally:
                try:
                    proc.stdin.close()
                except OSError:
                    pass

        threads = [threading.Thread(target=pump, args=(proc.stdout, out), daemon=True),
                   threading.Thread(target=pump, args=(proc.stderr, err), daemon=True),
                   threading.Thread(target=feed, daemon=True)]
        for thread in threads:
            thread.start()
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            if on_timeout:
                on_timeout()
            proc.kill()
            proc.wait(timeout=30)
        for thread in threads:
            thread.join(timeout=10)
        for stream in (proc.stdout, proc.stderr):
            stream.close()
        return Exec(proc.returncode, out.text(), err.text(), timed_out, out.truncated or err.truncated)

    def available(self):
        try:
            return self.call(['info', '--format', '{{.ServerVersion}}'], timeout=30).returncode == 0
        except SandboxUnavailable:
            return False


class Tree:
    """An exact repository revision as regular files only, held by the engine; never a Git checkout."""
    def __init__(self, repo, sha, files, modes=None, skipped=()):
        self.repo, self.sha, self.files, self.modes, self.skipped = repo, sha, dict(files), dict(modes or {}), list(skipped)

    @classmethod
    def from_tarball(cls, repo, sha, data):
        if len(data) > MAX_ARCHIVE_BYTES:
            raise ValueError('Repository archive exceeds the sandbox limit')
        files, modes, skipped, root = {}, {}, [], None
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
            for member in archive:
                top, _, path = member.name.partition('/')
                if root is None:
                    root = top
                    # GitHub names the archive root owner-repo-<short sha>: a different revision is not this candidate.
                    if not re.fullmatch(r'[A-Za-z0-9_.-]+-' + re.escape(sha[:7]) + r'[0-9a-f]*', top):
                        raise ValueError('Repository archive does not hold the requested revision')
                if top != root:
                    raise ValueError('Repository archive has more than one root')
                if not path or member.isdir():
                    continue
                if not member.isfile() or not safe_path(path) or member.size > MAX_FILE_BYTES:
                    skipped.append(path[:200])
                    continue
                files[path] = archive.extractfile(member).read()
                modes[path] = 0o755 if member.mode & 0o111 else 0o644
        return cls(repo, sha, files, modes, skipped)

    def text(self, path):
        data = self.files.get(path)
        if data is None:
            return None
        try:
            return data.decode('utf-8')
        except UnicodeDecodeError:
            return None


def fetch_revision(repo, sha, token, opener=urllib.request.urlopen):
    """Download one exact, authorized revision with the engine's token. The token never enters a container."""
    from engine.runner import allowed_repo
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo or '') or not allowed_repo(repo):
        raise PermissionError('Sandbox execution needs an allowed repository')
    if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        raise ValueError('Sandbox execution needs a full commit SHA')
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'KappaForge-Sandbox'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(f'https://api.github.com/repos/{repo}/tarball/{sha}', headers=headers)
    with opener(request, timeout=120) as response:
        data = response.read(MAX_ARCHIVE_BYTES + 1)
    return Tree.from_tarball(repo, sha, data)


# Toolchain adapters: what a project needs installed, which commands are allowed and how its tests are found.
class Toolchain:
    name = ''

    def detect(self, tree):
        raise NotImplementedError

    def install(self, tree):
        """(argv, manifest paths, dependency mount) or a reason string when installing is not possible."""
        return None

    def tests(self, tree):
        return []

    def allows(self, argv, tree):
        """None when allowed, otherwise the reason."""
        return 'not a ' + self.name + ' command'


class Python(Toolchain):
    name = 'python'
    MODULES = {'unittest', 'pytest', 'compileall', 'py_compile'}

    def detect(self, tree):
        return any(p.endswith('.py') for p in tree.files) or any(p in tree.files for p in ('pyproject.toml', 'requirements.txt'))

    def requirements(self, tree):
        return [p for p in ('requirements.txt', 'requirements-dev.txt') if p in tree.files]

    def install(self, tree):
        files = self.requirements(tree)
        if not files:
            return None
        argv = ['python', '-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '--no-cache-dir',
                '--only-binary=:all:', '--target', '/deps/python']
        for name in files:
            argv += ['-r', name]
        return argv, files, '/deps/python'

    def tests(self, tree):
        requirements = '\n'.join(tree.text(p) or '' for p in self.requirements(tree))
        if re.search(r'^\s*pytest\b', requirements, re.M | re.I):
            return [['python', '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider']]
        folders = sorted({p.rsplit('/', 1)[0] if '/' in p else '.' for p in tree.files
                          if re.search(r'(?:^|/)test_[^/]*\.py$', p) and p.count('/') <= 1})
        if 'tests' in folders:
            # As in CI: "python -m" puts the workspace first on sys.path, with or without tests/__init__.py.
            return [['python', '-B', '-m', 'unittest', 'discover', '-s', 'tests']]
        if folders:
            return [['python', '-B', '-m', 'unittest', 'discover', '-s', folders[0]]]
        return []

    def allows(self, argv, tree):
        if argv[0] not in ('python', 'python3'):
            return super().allows(argv, tree)
        rest = argv[1:]
        while rest and rest[0] in ('-B', '-u'):
            rest = rest[1:]
        if len(rest) >= 2 and rest[0] == '-m':
            return None if rest[1] in self.MODULES else 'python -m ' + rest[1][:40] + ' is not an allowed module'
        if rest and rest[0].endswith('.py') and rest[0] in tree.files:
            return None
        return 'python may run only an allowed module or a script in the repository'


class Node(Toolchain):
    name = 'node'

    def detect(self, tree):
        return 'package.json' in tree.files

    def package(self, tree):
        try:
            data = json.loads(tree.text('package.json') or '{}')
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def scripts(self, tree):
        scripts = self.package(tree).get('scripts')
        return {k: v for k, v in scripts.items() if isinstance(v, str)} if isinstance(scripts, dict) else {}

    def install(self, tree):
        package = self.package(tree)
        if not (package.get('dependencies') or package.get('devDependencies')):
            return None
        lock = next((p for p in ('package-lock.json', 'npm-shrinkwrap.json') if p in tree.files), None)
        if not lock:
            return 'package.json has dependencies but no package-lock.json; installs without a lockfile are not allowed'
        # Lifecycle scripts never run during install; the network is on, so the container gets only these two files.
        return ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['package.json', lock], '/deps/node_modules'

    def tests(self, tree):
        test = self.scripts(tree).get('test', '')
        return [['npm', 'test']] if test and 'no test specified' not in test else []

    def allows(self, argv, tree):
        program, rest = argv[0], argv[1:]
        if program == 'npm':
            if rest[:1] == ['test'] or rest[:1] == ['t']:
                return None
            if rest[:1] == ['run'] and len(rest) >= 2:
                return None if rest[1] in self.scripts(tree) else 'npm run ' + rest[1][:40] + ' is not a package.json script'
            return 'npm may only run package.json scripts'
        if program == 'node':
            if rest[:1] in (['--test'], ['--check']):
                return None
            if rest and rest[0].endswith(('.js', '.mjs', '.cjs')) and rest[0] in tree.files:
                return None
            return 'node may run tests, syntax checks or a script in the repository'
        return super().allows(argv, tree)


TOOLCHAINS = (Python(), Node())


class Policy:
    """Which commands the sandbox will run. Repository-named commands pass the same checks as the engine's own."""
    def __init__(self, toolchains):
        self.toolchains = toolchains

    def parse(self, command):
        try:
            argv = shlex.split(command) if isinstance(command, str) else command
        except ValueError:
            raise CommandRejected('The command could not be parsed (unbalanced quotes)') from None
        if (not isinstance(argv, list) or not argv or len(argv) > 64
                or any(not isinstance(a, str) or not a or len(a) > 4096 or '\0' in a for a in argv)):
            raise CommandRejected('A command is a program and up to 64 arguments')
        if any(SHELL_TOKENS.match(a) for a in argv):
            raise CommandRejected('Shell operators are not supported; run one program at a time')
        return argv

    def check(self, command, tree):
        argv = self.parse(command)
        reasons = [t.allows(argv, tree) for t in self.toolchains]
        if all(reasons):
            raise CommandRejected(next((r for r in reasons if not r.startswith('not a ')), 'unsupported program: ' + argv[0][:40]))
        return argv


def kappa_test_command(tree):
    """A project's own "Test command: ..." line in KAPPA.md, read from the base revision only."""
    text = tree.text('KAPPA.md') or ''
    match = re.search(r'^test command:\s*`?([^`\n]+?)`?\s*$', text, re.I | re.M)
    return match.group(1).strip() if match else None


def image_versions(tree):
    python = (tree.text('.python-version') or '').strip()
    python = '.'.join(python.split('.')[:2])
    node = (tree.text('.nvmrc') or '').strip().lstrip('v').split('.')[0]
    return (python if python in PYTHON_VERSIONS else DEFAULT_PYTHON), (node if node in NODE_VERSIONS else DEFAULT_NODE)


# Built on the runner from official images only. git comes from Debian's mirrors (tests often create scratch
# repositories); the build context is this text alone, so no source or secret is present while it has network.
DOCKERFILE = """FROM node:{node}-slim AS node
FROM python:{python}-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ARG GIT=1
RUN if [ "$GIT" = 1 ]; then apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 update \\
    && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; fi
"""
# Fixed bootstrap: unpack the candidate copy sent on stdin, then exec the command's argv (never a shell string).
BOOTSTRAP = ['sh', '-c', 'tar -x -f - -C /work && exec "$@"', 'kappaforge-sandbox']


@dataclass
class Session:
    """One task's sandbox: the base tree, the uncommitted candidate, dependency volumes and every result."""
    base: Tree
    docker: Docker = field(default_factory=Docker)
    versions: tuple = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    changes: dict = field(default_factory=dict)
    results: list = field(default_factory=list)
    image: str = ''
    volumes: dict = field(default_factory=dict)
    closed: bool = False
    observer: object = field(default=None, repr=False)
    infrastructure: dict = field(default_factory=dict)

    def __post_init__(self):
        self.versions = self.versions or image_versions(self.base)
        self.toolchains = [t for t in TOOLCHAINS if t.detect(self.base)]
        self.policy = Policy(TOOLCHAINS)
        self._count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()

    # The candidate: edits stay here until the engine commits a validated result.
    def apply(self, changes):
        for path, text in changes.items():
            if not safe_path(path):
                raise ValueError('Unsafe candidate path: ' + str(path)[:120])
            if text is not None and (not isinstance(text, str) or len(text.encode()) > MAX_FILE_BYTES):
                raise ValueError('Candidate file is not text within the size limit: ' + path)
        for path, text in changes.items():
            data = None if text is None else text.encode()
            if data == self.base.files.get(path) or (data is None and path not in self.base.files):
                self.changes.pop(path, None)
            else:
                self.changes[path] = data
        if self.observer:
            self.observer.changed()

    def revert(self, paths=None):
        for path in list(self.changes) if paths is None else paths:
            self.changes.pop(path, None)
        if self.observer:
            self.observer.changed()

    def current(self):
        files = dict(self.base.files)
        for path, data in self.changes.items():
            if data is None:
                files.pop(path, None)
            else:
                files[path] = data
        return files

    def candidate(self):
        return Tree(self.base.repo, self.base.sha, self.current(), self.base.modes)

    def diff(self, limit=60_000):
        parts = []
        for path in sorted(self.changes):
            before, after = self.base.files.get(path), self.changes[path]
            try:
                a = before.decode().splitlines(True) if before is not None else []
                b = after.decode().splitlines(True) if after is not None else []
            except UnicodeDecodeError:
                parts.append(f'Binary file {path} differs\n')
                continue
            parts.append(''.join(difflib.unified_diff(a, b, 'a/' + path if before is not None else '/dev/null',
                                                      'b/' + path if after is not None else '/dev/null')))
        text = ''.join(parts)
        return text if len(text) <= limit else text[:limit] + f'\n[... diff truncated at {limit} characters ...]\n'

    def test_definition_changed(self):
        """True when the candidate edits the commands that decide whether it passes (they are read from the base)."""
        if any(path == '.npmrc' or path.endswith('/.npmrc') for path in self.changes):
            return True  # npm config can disable lifecycle checks or select another workspace with identical scripts.
        if 'KAPPA.md' in self.changes and kappa_test_command(self.base) != kappa_test_command(self.candidate()):
            return True
        if 'package.json' in self.changes:
            node = Node()
            before, after = node.scripts(self.base), node.scripts(self.candidate())
            # npm resolves hooks and arbitrarily delegated scripts from the candidate, even when argv came from
            # the base. Freeze its script map: shell indirection cannot be safely inferred from just "test".
            return before != after
        return False

    def test_commands(self):
        """Validation commands from the base revision: KAPPA.md, then each toolchain's own layout."""
        named = kappa_test_command(self.base)
        if named:
            return [('KAPPA.md', self.policy.check(named, self.base))]
        return [(t.name, argv) for t in self.toolchains for argv in t.tests(self.base)]

    # Execution.
    def _name(self):
        self._count += 1
        return f'kfsb-{self.id}-{self._count}'

    def _limits(self, profile):
        args = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--init',
                '--user', UID, '--cpus', profile.cpus, '--memory', profile.memory, '--memory-swap', profile.memory,
                '--pids-limit', str(profile.pids), '--ulimit', 'nofile=1024:1024',
                '--tmpfs', f'/tmp:rw,noexec,nosuid,nodev,size={profile.tmp_mb}m',
                '--label', 'kappaforge.sandbox=' + self.id]
        args += [] if profile.network else ['--network', 'none']
        return args

    def _env(self):
        env = {'HOME': '/tmp', 'CI': 'true', 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
               'npm_config_cache': '/tmp/.npm', 'npm_config_update_notifier': 'false', 'NO_COLOR': '1'}
        if '/deps/python' in self.volumes:
            env['PYTHONPATH'] = '/deps/python'
        return [arg for key, value in env.items() for arg in ('--env', f'{key}={value}')]

    def _tar(self, files):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as archive:
            for path in sorted(files):
                info = tarfile.TarInfo(path)
                info.size, info.mode, info.mtime = len(files[path]), self.base.modes.get(path, 0o644), 0
                archive.addfile(info, io.BytesIO(files[path]))
        return buffer.getvalue()

    def _container(self, name, profile, argv, stdin, workdir='/work', mounts=()):
        args = ['run', '--rm', '-i', '--name', name, *self._limits(profile), *self._env(),
                '--tmpfs', f'/work:rw,exec,nosuid,nodev,size={profile.work_mb}m,uid=65534,gid=65534,mode=0755']
        for source, target, readonly in mounts:
            args += ['--mount', f'type=volume,src={source},dst={target}' + (',readonly' if readonly else '')]
        args += ['-w', workdir, self.image, *BOOTSTRAP, *argv]
        started, clock = now(), time.monotonic()
        result = self.docker.call(args, stdin=stdin, timeout=profile.timeout, limit=profile.output_bytes,
                                  on_timeout=lambda: self.docker.call(['rm', '-f', name], timeout=30))
        return result, started, round(time.monotonic() - clock, 3)

    def _outcome(self, argv, profile, result, started, duration, source):
        if result.timed_out:
            status, reason = 'timeout', f'Stopped after the {profile.timeout} s limit'
        elif result.returncode == 0:
            status, reason = 'passed', ''
        elif result.returncode in (125, 126, 127) and not result.stdout and result.stderr.startswith(('docker:', 'sh:', 'exec')):
            status, reason = 'error', 'The sandbox could not start the command: ' + result.stderr.strip()[:300]
        elif result.returncode == 137:
            status, reason = 'failed', 'Killed: out of memory or a resource limit (exit 137)'
        else:
            status, reason = 'failed', f'Exit code {result.returncode}'
        run = RunResult(list(argv), profile.name, status, None if result.timed_out else result.returncode, started, now(),
                        duration, result.stdout, result.stderr, result.truncated, self.image, reason, source)
        self.results.append(run)
        return run

    def prepare(self, profile=None):
        """Check Docker, then build the session image offline from official Python and Node images."""
        if self.closed:
            raise SandboxUnavailable('This sandbox session is closed')
        self.infrastructure = self.docker.authorize(profile or PROFILES['test'], preparing=not bool(self.image))
        if self.image:
            return self.image
        if not self.docker.available():
            raise SandboxUnavailable('Docker is not available on this runner. KappaForge runs candidate code only in '
                                     'isolated containers; use the GitHub-hosted ubuntu-latest runner, which includes Docker.')
        python, node = self.versions
        for base in (f'python:{python}-slim', f'node:{node}-slim'):
            if self.docker.call(['image', 'inspect', base], timeout=30).returncode:
                pulled = self.docker.call(['pull', '--quiet', base], timeout=600)
                if pulled.returncode:
                    detail = 'rate limited by Docker Hub (429)' if '429' in pulled.stderr else pulled.stderr.strip()[:200]
                    raise SandboxUnavailable(f'Could not download the official {base} image: {detail}. Nothing ran; '
                                             'retry later or pre-load the image on the runner.')
        dockerfile = DOCKERFILE.format(python=python, node=node).encode()
        for git in (True, False):
            tag = f'kappaforge-sandbox:py{python}-node{node}' + ('' if git else '-nogit')
            if self.docker.call(['image', 'inspect', tag], timeout=30).returncode == 0:
                break
            built = self.docker.call(['build', '--quiet', '--build-arg', f'GIT={int(git)}', *([] if git else ['--network', 'none']),
                                      '-t', tag, '-'], stdin=dockerfile, timeout=600)
            if built.returncode == 0:
                break
            if not git:
                raise SandboxUnavailable('Could not build the sandbox image: ' + built.stderr.strip()[:300])
        # Without git the image still runs everything else; tests that need git then fail visibly, never silently.
        self.missing_tools = [] if git else ['git']
        self.image = tag
        return tag

    def install(self):
        """Install each toolchain's locked dependencies into a session volume; source code never reaches this step."""
        self.prepare(PROFILES['install'])
        results = []
        profile = PROFILES['install']
        for toolchain in self.toolchains:
            plan = toolchain.install(self.base)
            if plan is None:
                continue
            if isinstance(plan, str):
                if self.observer:
                    self.observer.started([], profile.name, toolchain.name, reusable=False)
                run = RunResult([], profile.name, 'skipped', reason=plan, started_at=now(), finished_at=now(), source=toolchain.name)
                self.results.append(run)
                results.append(run)
                if self.observer:
                    self.observer.finished(run)
                continue
            argv, manifests, target = plan
            self.infrastructure = self.docker.authorize(profile)
            volume = f'kfsb-{self.id}-{toolchain.name}'
            self.docker.call(['volume', 'create', '--label', 'kappaforge.sandbox=' + self.id, volume], timeout=30)
            # A fresh volume belongs to root; hand it to the sandbox user with only the CHOWN capability.
            self.docker.call(['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
                              '--label', 'kappaforge.sandbox=' + self.id, '--mount', f'type=volume,src={volume},dst=/v',
                              self.image, 'chown', UID, '/v'], timeout=60)
            stdin = self._tar({path: self.base.files[path] for path in manifests})
            name = self._name()
            workdir = '/deps' if target == '/deps/node_modules' else '/work'
            args = ['run', '--rm', '-i', '--name', name, *self._limits(profile), *self._env(),
                    '--tmpfs', f'{workdir}:rw,exec,nosuid,nodev,size={profile.work_mb}m,uid=65534,gid=65534,mode=0755',
                    '--mount', f'type=volume,src={volume},dst={target}', '-w', workdir, self.image,
                    'sh', '-c', f'tar -x -f - -C {workdir} && exec "$@"', 'kappaforge-sandbox', *argv]
            started, clock = now(), time.monotonic()
            if self.observer:
                self.observer.started(argv, profile.name, toolchain.name, reusable=False)
            result = self.docker.call(args, stdin=stdin, timeout=profile.timeout, limit=profile.output_bytes,
                                      on_timeout=lambda name=name: self.docker.call(['rm', '-f', name], timeout=30))
            run = self._outcome(argv, profile, result, started, round(time.monotonic() - clock, 3), toolchain.name)
            if run.ok:
                size = self.docker.call(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', UID,
                                         '--mount', f'type=volume,src={volume},dst=/v,readonly', self.image,
                                         'du', '-sm', '/v'], timeout=120)
                used = int(size.stdout.split()[0]) if size.returncode == 0 and size.stdout.split()[:1] and size.stdout.split()[0].isdigit() else None
                if used is None or used > MAX_DEPS_MB:
                    run.status, run.reason = 'failed', f'Dependencies use {used} MB, over the {MAX_DEPS_MB} MB limit' if used else 'Dependency size could not be checked'
            if run.ok:
                self.volumes[target] = volume
            results.append(run)
            if self.observer:
                self.observer.finished(run)
        return results

    def run(self, command, profile='test', source='model'):
        """Run one allowed command on a fresh copy of the candidate. Rejected commands never start a container."""
        profile = PROFILES[profile] if isinstance(profile, str) else profile
        if profile.network:
            raise CommandRejected('Commands never run with network access; dependencies are installed by the engine')
        try:
            argv = self.policy.check(command, self.candidate())
        except CommandRejected as exc:
            if self.observer:
                self.observer.started(command if isinstance(command, list) else [str(command)[:400]], profile.name, source)
            run = RunResult(command if isinstance(command, list) else [str(command)[:400]], profile.name, 'rejected',
                            started_at=now(), finished_at=now(), reason=str(exc), source=source)
            self.results.append(run)
            if self.observer:
                self.observer.finished(run)
            return run
        if self.observer:
            cached = self.observer.cached(argv, profile.name, source)
            if cached:
                self.results.append(cached)
                self.observer.finished(cached, reused=True)
                return cached
            self.observer.started(argv, profile.name, source)
        self.prepare(profile)
        files = {p: d for p, d in self.current().items() if not p.startswith('node_modules/')}
        mounts = [(volume, '/work/node_modules' if target == '/deps/node_modules' else target, True)
                  for target, volume in self.volumes.items()]
        result, started, duration = self._container(self._name(), profile, argv, self._tar(files), mounts=mounts)
        run = self._outcome(argv, profile, result, started, duration, source)
        if self.observer:
            self.observer.finished(run)
        return run

    def run_tests(self, profile='test'):
        if self.test_definition_changed():
            run = RunResult([], PROFILES[profile].name, 'rejected', started_at=now(), finished_at=now(),
                            reason='Candidate changes the test command', source='policy')
            self.results.append(run)
            return [run]
        commands = self.test_commands()
        if not commands:
            run = RunResult([], PROFILES[profile].name, 'skipped', started_at=now(), finished_at=now(),
                            reason='No test command found in KAPPA.md, package.json or the Python test layout')
            self.results.append(run)
            return [run]
        return [self.run(argv, profile, source) for source, argv in commands]

    def close(self):
        """Remove every container and volume of this session, including ones a timeout left behind."""
        if self.closed:
            return
        self.closed = True
        label = 'label=kappaforge.sandbox=' + self.id
        listed = self.docker.call(['ps', '-aq', '--filter', label], timeout=30)
        ids = listed.stdout.split() if listed.returncode == 0 else []
        if ids:
            self.docker.call(['rm', '-f', *ids], timeout=60)
        volumes = self.docker.call(['volume', 'ls', '-q', '--filter', label], timeout=30)
        names = set(volumes.stdout.split() if volumes.returncode == 0 else []) | set(self.volumes.values())
        if names:
            self.docker.call(['volume', 'rm', '-f', *sorted(names)], timeout=60)
        self.volumes.clear()

    def summary(self):
        return {'session': self.id, 'repo': self.base.repo, 'base': self.base.sha, 'image': self.image,
                'infrastructure': dict(self.infrastructure),
                'missingTools': list(getattr(self, 'missing_tools', [])),
                'changed': sorted(self.changes), 'testDefinitionChanged': self.test_definition_changed(),
                'results': [r.to_dict() for r in self.results]}


def open_session(repo, sha, token, opener=urllib.request.urlopen, docker=None):
    """Fetch the exact revision and start a session. Callers use it as a context manager so cleanup always runs."""
    return Session(fetch_revision(repo, sha, token, opener), docker or Docker())

"""Bind free infrastructure admission to the reviewed workflow source, without network or provisioning.

Run after deliberately reviewing a workflow change; CI checks for drift.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'config' / 'execution-infrastructure.json'
WORKFLOWS = ('agent.yml', 'continuous.yml', 'ios-build.yml', 'project-tests.yml', 'recovery.yml', 'review-graph.yml', 'sandbox-tests.yml', 'task282-progress.yml')
# GitHub's standard hosted labels, unmetered for public repositories. Larger runners (custom names, *-large,
# *-xlarge) are billed even for public repositories. Same pattern as chat-backend/src/free-execution.js.
STANDARD_RUNNER = re.compile(r'(?:ubuntu-(?:latest|2[24]\.04)(?:-arm)?|windows-(?:latest|202[25]|11-arm)|macos-(?:latest|1[3-5]|26)(?:-intel)?)')


def paid_runners(text):
    """Problems that could put any job of this workflow on billed capacity; empty when every job is standard.

    Every workflow runs automatically on some event, not only the dispatched ones, so all of them are checked.
    Only literal labels are accepted: an expression, list, group or reusable job cannot be proven free here.
    """
    match = re.search(r'^jobs:\s*\n((?:[ \t].*\n|\n|#.*\n)*)', text + '\n', re.M)
    if not match:
        return ['no jobs block']
    problems = []
    for job in re.split(r'^(?=  [^\s#])', match[1], flags=re.M)[1:]:
        name = job.split(':', 1)[0].strip()
        labels = re.findall(r'^    runs-on:(.*)$', job, re.M)
        if re.search(r'^    uses:', job, re.M):
            problems.append(f'{name}: reusable workflow job')
        elif len(labels) != 1:
            problems.append(f'{name}: needs exactly one literal runs-on label')
        elif not STANDARD_RUNNER.fullmatch(labels[0].strip()):
            problems.append(f'{name}: runs-on {labels[0].strip()[:60]!r} is not a standard GitHub-hosted runner')
    return problems


KEY = re.compile(r'^(\s*)(- )?([\'"]?)([A-Za-z0-9_.-]+)\3:(?:\s|$)')


def duplicate_keys(text):
    """Keys repeated within one block mapping. GitHub rejects such a workflow outright, while PyYAML silently keeps
    the last value, so local tooling would otherwise pass a file that never runs (agent.yml, Phase 1 Step 7)."""
    problems, stack, scalar = [], [], None  # stack: [indent, keys of the mapping at that indent]
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        indent = len(line) - len(line.lstrip(' '))
        if scalar is not None:
            if indent > scalar:
                continue  # Inside a | or > block scalar.
            scalar = None
        match = KEY.match(line)
        if not match:
            continue
        level = indent + (2 if match[2] else 0)
        if match[2]:  # A sequence item starts a new mapping.
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append([level, set()])
        while stack and stack[-1][0] > level:
            stack.pop()
        if not stack or stack[-1][0] < level:
            stack.append([level, set()])
        if match[4] in stack[-1][1]:
            problems.append(f'line {number}: duplicate key {match[4]!r}')
        stack[-1][1].add(match[4])
        if re.match(r'[|>][-+0-9]*\s*(?:#.*)?$', line[match.end():].strip()):
            scalar = level
    return problems


def check_runners():
    problems = [f'{path.name}: {problem}' for path in sorted((ROOT / '.github/workflows').glob('*.y*ml'))
                for check in (duplicate_keys, paid_runners) for problem in check(path.read_text(encoding='utf-8'))]
    if problems:
        raise ValueError('Workflows GitHub would reject, or that could run on billed or unverifiable runners '
                         '(use unique keys and a standard GitHub-hosted label):\n  ' + '\n  '.join(problems))


def build():
    return dict(version=1, repository='onlykappa/KappaForge', runners=['ubuntu-latest', 'macos-15'],
                workflows={name: hashlib.sha256((ROOT / '.github/workflows' / name).read_text(encoding='utf-8').encode()).hexdigest()
                           for name in WORKFLOWS})


def main():
    text = json.dumps(build(), indent=2) + '\n'
    if sys.argv[1:] == ['--check']:
        check_runners()
        if TARGET.read_text(encoding='utf-8') != text:
            raise ValueError('Free execution workflow manifest is stale; review the workflow changes, then run python3 scripts/execution-policy.py')
        print('Free execution workflow manifest matches reviewed sources; every workflow uses standard runners')
        return
    if sys.argv[1:]:
        raise ValueError('Only --check or no arguments are supported')
    TARGET.write_bytes(text.encode())
    print('Updated reviewed execution workflow manifest')


if __name__ == '__main__':
    main()

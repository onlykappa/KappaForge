"""Bind free infrastructure admission to the reviewed workflow source, without network or provisioning.

Run after deliberately reviewing a workflow change; CI checks for drift.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'config' / 'execution-infrastructure.json'
WORKFLOWS = ('agent.yml', 'continuous.yml', 'ios-build.yml', 'project-tests.yml', 'recovery.yml', 'review-graph.yml', 'sandbox-tests.yml')


def build():
    return dict(version=1, repository='onlykappa/KappaForge', runners=['ubuntu-latest', 'macos-15'],
                workflows={name: hashlib.sha256((ROOT / '.github/workflows' / name).read_text(encoding='utf-8').encode()).hexdigest()
                           for name in WORKFLOWS})


def main():
    text = json.dumps(build(), indent=2) + '\n'
    if sys.argv[1:] == ['--check']:
        if TARGET.read_text(encoding='utf-8') != text:
            raise ValueError('Free execution workflow manifest is stale; review the workflow changes, then run python3 scripts/execution-policy.py')
        print('Free execution workflow manifest matches reviewed sources')
        return
    if sys.argv[1:]:
        raise ValueError('Only --check or no arguments are supported')
    TARGET.write_bytes(text.encode())
    print('Updated reviewed execution workflow manifest')


if __name__ == '__main__':
    main()

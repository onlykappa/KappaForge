"""Run KappaForge's own test suites inside the Phase 1 execution sandbox and print the results as JSON.

The checked-out commit is packed with `git archive` (no token, no .git), installed from its lockfile in the networked
install container, and tested in networkless run containers, exactly as a task candidate would be. Exits nonzero unless
every detected test command passed."""
import json
import subprocess
import sys

from engine import sandbox


def main():
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    data = subprocess.run(['git', 'archive', '--format=tar.gz', f'--prefix=onlykappa-KappaForge-{sha[:7]}/', 'HEAD'],
                          capture_output=True, check=True).stdout
    tree = sandbox.Tree.from_tarball('onlykappa/KappaForge', sha, data)
    with sandbox.Session(tree) as session:
        installs = session.install()
        tests = session.run_tests()
        report = {'sha': sha, 'image': session.image, 'missingTools': session.summary()['missingTools'],
                  'install': [{k: r.to_dict()[k] for k in ('argv', 'status', 'reason', 'duration_s')} for r in installs],
                  'tests': [{**{k: r.to_dict()[k] for k in ('argv', 'source', 'status', 'reason', 'duration_s')},
                             'tail': (r.stdout + r.stderr).strip().splitlines()[-6:]} for r in tests]}
    print(json.dumps(report, indent=2))
    return 0 if tests and all(r.ok for r in tests) and all(r.ok for r in installs) else 1


if __name__ == '__main__':
    sys.exit(main())

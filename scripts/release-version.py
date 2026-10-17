"""Pick the version a push to main releases: config/app.json's, or the next patch after the newest release.

Every merge that changes the app should reach the phone without anyone bumping the version by hand.
Reads published release tags (one per line) on stdin; --apply writes the chosen version (and notes) to config/app.json.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.build_config import ROOT, load_config
from tools.diagnostics import run


def parse(version):
    return tuple(int(part) for part in version.split('.'))


def next_version(configured, tags):
    published = [t.lstrip('vV') for t in tags if re.fullmatch(r'[vV]?\d+\.\d+\.\d+', t.strip())]
    published = [p.strip() for p in published]
    if configured not in published and all(parse(configured) > parse(p) for p in published):
        return configured
    newest = max([parse(configured)] + [parse(p) for p in published])
    return '%d.%d.%d' % (newest[0], newest[1], newest[2] + 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--notes', default='')
    args = parser.parse_args()
    config = load_config()
    version = next_version(config['version'], sys.stdin.read().split())
    if args.apply and version != config['version']:
        config['version'] = version
        config['released'] = datetime.date.today().isoformat()
        if args.notes.strip():
            config['notes'] = args.notes.strip()[:300]
        (ROOT / 'config/app.json').write_text(json.dumps(config, indent=2) + '\n')
    print(version)


if __name__ == '__main__':
    sys.exit(run(main, 'release version'))

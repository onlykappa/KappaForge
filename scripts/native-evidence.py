"""Validate xcresulttool's real summary before reporting native UI success."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.native_evidence import summarize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('summary')
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        report = summarize(json.loads(Path(args.summary).read_text()), args.candidate)
    except (ValueError, OSError) as error:
        report = dict(version=1, candidate=args.candidate, kind='native_simulator', state='unknown', reason=str(error))
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print('Native simulator evidence: ' + report['state'] + ' — ' + report['reason'])
    return 0 if report['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())

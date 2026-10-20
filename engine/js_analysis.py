"""Trusted parse-only bridge to the pinned vendored JavaScript parser.

Candidate source travels over stdin as JSON. It is never imported or executed.
"""
from functools import lru_cache
import json
from pathlib import Path
import shutil
import subprocess

HELPER = Path(__file__).with_name('js-analysis.mjs')


@lru_cache(maxsize=48)
def analyze(source):
    if not shutil.which('node'):
        raise ValueError('JavaScript verification requires Node; analysis is unavailable')
    result = subprocess.run(['node', str(HELPER)], input=json.dumps({'files': [{'path': 'candidate.js', 'source': source}]}),
                            capture_output=True, text=True, timeout=25)
    if result.returncode:
        raise ValueError('JavaScript parser unavailable: ' + result.stderr[:250])
    data = json.loads(result.stdout)[0]
    if data.get('error'):
        raise ValueError('JavaScript source could not be parsed: ' + data['error'][:250])
    return data


def executable_quote(source, quote):
    """A source quote must overlap code tokens, not just comments or data."""
    tokens = analyze(source)['tokens']
    start = source.find(quote)
    while start >= 0:
        if any(a < start + len(quote) and b > start for a, b in tokens):
            return True
        start = source.find(quote, start + 1)
    return False

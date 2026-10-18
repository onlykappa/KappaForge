"""Deterministic fixture, not a production task. Replay the real runner's progress writer in browser tests."""
import json
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from engine import developer

base = float(sys.argv[1]) / 1000
clock = iter([base, base, base + 24, base + 24, base + 36, base + 36, base + 76, base + 90])
bodies = []
with patch.object(developer.Progress, 'clock', lambda: next(clock)), patch.object(developer, 'gh', side_effect=lambda path, token, payload, **kw: bodies.append(payload['body']) or {'id': 77}):
    progress = developer.Progress(77, 'fixture-no-token', ahead=['Identify issues', 'Implement fixes', 'Run regression tests'])
    progress.now('Reading project files')
    progress.ok('Reading project files: 12 fixture files analyzed')
    progress.now('Identifying issues', phase=True)
    progress.ok('Identifying issues: 2 fixture cases confirmed')
    progress.now('Step 1 of 3: Implement parsing fix', phase=True)
    progress.now('Step 2 of 3: Add recovery test')
    progress.fail('Fixture validation failure, intentionally exercised')
print(json.dumps({'initial': bodies[0], 'middle': bodies[-2], 'failed': bodies[-1]}))

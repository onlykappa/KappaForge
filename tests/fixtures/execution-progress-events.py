"""Real backend snapshots for the task UI contract; recording Docker boundary, no code execution."""
import json
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from engine import developer, recovery, sandbox_repair_controller
from tests.test_execution_recovery import session, TASK, CONTEXT
from tests.test_recovery_journal import GitHub

world = GitHub()
journal = world.journal()
rows = []
with patch.object(developer, 'gh', side_effect=lambda path, token, payload, **kw: rows.append(payload['body']) or {'id': 7}):
    progress = developer.Progress(130, 'fixture-no-credentials')
    progress.now('Running isolated tests')
    controller = sandbox_repair_controller.SandboxRepairController(session(), journal, CONTEXT, progress)
    controller.run_repair(TASK, None, 'no-credentials', {'app.py': 'value=2\n'})
snapshots = [json.loads(row.split('<!-- KAPPA_PROGRESS_V1 ')[1].split(' -->')[0]) for row in rows]
running = next(row for row in snapshots if (row.get('execution') or {}).get('currentCommand', {})
               and row['execution']['currentCommand']['status'] == 'running')
print(json.dumps(dict(running=running, completed=snapshots[-1])))

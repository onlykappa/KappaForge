"""Real Python recovery controller against the isolated runtime's GitHub fixture."""
import contextlib
import io
import json
import os
import sys
import time
from unittest.mock import patch
from test_recovery_journal import GitHub
from engine import intent_guard, recovery


def main():
    world = GitHub()
    with patch.dict(os.environ, {'GITHUB_RUN_ID':'41', 'KAPPA_ROUTER_URL':'', 'KAPPA_ROUTER_TOKEN':''}):
        if sys.argv[1] == 'prepare':
            now = time.time()
            auth = dict(id='runtime-owner', conversationId='runtime-conversation', requestId='runtime-request',
                        repo=recovery.ROOT, mode='develop', intent='execution', state='executing', expiresAt=(now+3600)*1000)
            world.issue['labels'] = [{'name':'kappa-task'}]
            world.issue['body'] += '\nApproved from KappaForge Chat.\n<!-- kappa-authorization:'+json.dumps(auth)+' -->'
            intent_guard.activate(world.issue)
            journal = recovery.Journal(world.issue, world.read, world.write)
            journal.checkpoint('b'*40, files=['value.py'])
            journal.defer(RuntimeError('isolated runtime fixture outage'))
            journal.state['nextAt'] = now+4
            journal.persist()
            return dict(issue=world.issue, rows=world.rows, auth=auth, nextAt=journal.state['nextAt']*1000)
        fixture = json.load(sys.stdin)
        world.issue, world.rows = fixture['issue'], fixture['rows']
        world.now = time.time()
        intent_guard.activate(world.issue)
        result = recovery.scan(world.read, world.write, task=world.issue['number'])
        dispatches = [payload for path, payload, method in world.calls if path.endswith('/dispatches')]
        assert result == [(130, 'queued')], result
        assert len(dispatches) == 1, dispatches
        intent_guard.activate(world.issue)
        journal = recovery.Journal(world.issue, world.read, world.write)
        with patch.dict(os.environ, {'GITHUB_RUN_ID':'42'}):
            assert journal.begin(dispatches[0]['inputs']['action'])
            assert not journal.begin(dispatches[0]['inputs']['action'])
        assert journal.state['candidate'] == 'b'*40
        assert journal.state['run'] == '42'
        assert journal.state['status'] == 'running'
        return dict(scanner=result, agentDispatches=len(dispatches), runnerAcknowledged=True,
                    candidate=journal.state['candidate'], rows=world.rows)


if __name__ == '__main__':
    # Fixture diagnostic logs are not part of the JSON boundary.
    with contextlib.redirect_stdout(io.StringIO()):
        result = main()
    print(json.dumps(result))

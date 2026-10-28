"""The real Worker renewal must preserve a checkpoint the real Python engine can restore."""
import copy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from engine import intent_guard, recovery, task_goal
from tests.test_recovery_journal import GitHub

ROOT = Path(__file__).resolve().parents[1]


class TaskRenewalTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(intent_guard.ACTIVE.reset, intent_guard.ACTIVE.set(None))
        self.addCleanup(task_goal.CURRENT.reset, task_goal.CURRENT.set(None))
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(None))

    def checkpoint(self, origin, header_case=False):
        world = GitHub()
        world.prs = []
        world.issue['labels'] = [{'name': 'kappa-task'}]
        world.issue['body'] += '\nDo not merge.'
        if origin == 'chat':
            record = dict(id='previous-owner-grant', conversationId='previous-chat', requestId='previous-request',
                          repo=recovery.ROOT, mode='develop', intent='execution', state='executing',
                          restrictions={'noMerge': True}, expiresAt=(world.now + 3600) * 1000)
            world.issue['body'] += '\nApproved from KappaForge Chat.\n<!-- kappa-authorization:' + json.dumps(record) + ' -->'
        if header_case:
            world.issue['body'] = world.issue['body'].replace('Mode:', 'mOdE:').replace('Repository:', 'rEpOsItOrY:')
        intent_guard.activate(world.issue)
        journal = world.journal()
        journal.checkpoint('b' * 40, files=['value.py'])
        journal.event('Retained test failure', model='fixture', outcome='waiting')
        journal.state.update(status='waiting', run='41', nextAt=world.now + 60,
                             budgets={'modelCalls': 17, 'edits': 2, 'fixCycles': 3})
        journal.persist()
        return world, journal

    def renew(self, world, now, authorization):
        result = subprocess.run(['node', 'tests/fixtures/task-renewal-driver.mjs'], cwd=ROOT,
                                input=json.dumps(dict(issue=world.issue, rows=world.rows, now=now * 1000,
                                                      authorization=authorization)),
                                text=True, capture_output=True, check=True, timeout=30)
        return json.loads(result.stdout)

    def test_expired_owner_task_restores_real_checkpoint_without_resetting_history(self):
        for origin, header_case in (('github', False), ('chat', False), ('github', True), ('chat', True)):
            with self.subTest(origin=origin, header_case=header_case):
                world, journal = self.checkpoint(origin, header_case)
                original = world.issue['body']
                saved = copy.deepcopy(journal.state)
                now = journal.scope.expires + 10
                authorization = dict(id='fresh-owner-grant', conversationId='new-chat', requestId='new-request',
                                     issuedAt=now * 1000)
                output = self.renew(world, now, authorization)
                world.issue, world.now = output['issue'], now
                with patch('engine.intent_guard.time.time', return_value=now):
                    intent_guard.activate(world.issue)
                    restored = world.journal()
                self.assertTrue(restored.renewed_scope)
                self.assertEqual(restored.scope.resume_from,
                                 {'authorization': journal.scope.identity, 'digest': journal.scope.digest})
                for key in ('candidate', 'files', 'budgets', 'events', 'continuations'):
                    self.assertEqual(restored.state[key], saved[key], key)
                self.assertEqual(restored.scope.identity, authorization['id'])
                self.assertTrue(restored.scope.restrictions['noMerge'])
                self.assertFalse(json.loads(intent_guard.MARKER.findall(world.issue['body'])[0])['allowMerge'])
                self.assertEqual(output['scheduled'], 1)
                self.assertEqual(output['result']['status'], 'recovery_requested')
                self.assertEqual(output['writes'], [{'path': '/repos/onlykappa/KappaForge/issues/130', 'method': 'PATCH'}])
                if origin == 'github':
                    self.assertTrue(world.issue['body'].startswith(original))

    def test_expired_task_without_fresh_authorization_cannot_renew_or_dispatch(self):
        world, journal = self.checkpoint('github')
        original = world.issue['body']
        output = self.renew(world, journal.scope.expires + 10, None)
        self.assertEqual(output['result']['status'], 409)
        self.assertEqual(output['issue']['body'], original)
        self.assertEqual(output['writes'], [])
        self.assertEqual(output['scheduled'], 0)

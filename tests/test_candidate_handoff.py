"""Owner handoff preserves rejected proposals and cumulative usage; no manual marker edits."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import unittest
from unittest.mock import Mock, patch

from engine import candidate_handoff as handoff, execution, intent_guard, recovery, task_goal, queue_authority as authority
from tests.test_recovery_journal import GitHub

ROOT = recovery.ROOT
BASE, HEAD, OLD_ENGINE, ENGINE = ('a' * 40, 'b' * 40, 'c' * 40, 'd' * 40)
TASK = 'Implement scoped ingestion without lifecycle actions.'


def iso(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat()


class World(GitHub):
    def __init__(self):
        super().__init__()
        self.issue.update(number=314, body=f'Repository: {ROOT}\nMode: develop\nBase: fix/phase3-queue-base-314\n\n{TASK}')
        intent_guard.activate(self.issue)
        self.control = dict(number=319, state='open', user={'login': 'onlykappa'}, body='Original finite queue', created_at=iso(self.now - 60))
        self.row = dict(issue=314, digest=authority.digest(self.issue['body']), base='fix/phase3-queue-base-314', existing=False)
        self.grant = dict(version=1, control=319, grant=authority.digest(self.control['body']), enginePR=312,
                          engineRef='fix/308-phase3-followups', tasks=[self.row])
        self.owner_rows = []
        self.pr = dict(number=320, state='open', draft=True, user={'login': 'onlykappa'}, changed_files=2,
            html_url=f'https://github.com/{ROOT}/pull/320',
            head=dict(sha=HEAD, ref='kappa/dev-314', repo={'full_name': ROOT}),
            base=dict(sha=BASE, ref=self.row['base'], repo={'full_name': ROOT}))
        self.runs = {n: dict(id=n, status='completed' if n == 90 else 'in_progress', conclusion='failure' if n == 90 else None,
            event='workflow_dispatch', path='.github/workflows/agent.yml', repository={'full_name': ROOT},
            actor={'login': 'onlykappa'}, triggering_actor={'login': 'onlykappa'}, head_sha=OLD_ENGINE if n == 90 else ENGINE,
            head_branch=self.grant['engineRef'], display_title='Agent task #319 queue', updated_at=iso(self.now - 20)) for n in (90, 91)}
        self.comparison = dict(status='ahead', merge_base_commit={'sha': BASE}, ahead_by=1, commits=[{'sha': HEAD}],
                              files=[{'filename': 'engine/review_ingestion.py'}, {'filename': 'tests/test_reviews.py'}])
        self.validation = dict(id=92, head_sha=HEAD, event='pull_request', path='.github/workflows/tests.yml',
                               repository={'full_name': ROOT}, status='completed', conclusion='success')
        self.active = []

    def read(self, path):
        p = path.removeprefix(f'repos/{ROOT}/')
        if p == 'issues/314': return deepcopy(self.issue)
        if p == 'issues/319': return deepcopy(self.control)
        if p.startswith('issues/319/comments?'): return deepcopy(self.owner_rows)
        if p == 'issues/comments/700': return deepcopy(self.owner_rows[0])
        if p.startswith('actions/runs/'): return deepcopy(self.runs[int(p.rsplit('/', 1)[1])])
        if p.startswith('contents/config/phase3-queue.json?'):
            return dict(path=authority.PATH, encoding='base64', content=base64.b64encode(json.dumps(self.grant).encode()).decode())
        if p == 'pulls/312':
            return dict(state='open', draft=True, user={'login': 'onlykappa'},
                        head=dict(ref=self.grant['engineRef'], repo={'full_name': ROOT}), base=dict(ref='main', repo={'full_name': ROOT}))
        if p.startswith('pulls?'): return [deepcopy(self.pr)]
        if p == 'pulls/320': return deepcopy(self.pr)
        if p == 'git/ref/heads/' + self.row['base']: return dict(object=dict(sha=BASE))
        if p == 'git/ref/heads/kappa/dev-314': return dict(object=dict(sha=self.pr['head']['sha']))
        if p.startswith('commits/'): return dict(commit=dict(committer=dict(date=iso(self.now - 10))))
        if p.startswith('compare/'): return deepcopy(self.comparison)
        if p.startswith('actions/workflows/agent.yml/runs?'): return dict(workflow_runs=deepcopy(self.active))
        if p.startswith('actions/workflows/tests.yml/runs?'): return dict(workflow_runs=[deepcopy(self.validation)])
        return super().read(path)


class CandidateHandoffTests(unittest.TestCase):
    def setUp(self):
        for variable in (intent_guard.ACTIVE, recovery.CURRENT, task_goal.CURRENT):
            token = variable.set(None)
            self.addCleanup(variable.reset, token)
        self.world = World()
        self.journal = self.world.journal()
        self.journal.checkpoint(BASE, base=self.world.row['base'])
        execution.seed(self.journal, ROOT, BASE, {'engine/old.py': 'rejected = True\n'}, TASK,
                       dict(kind='develop', base=self.world.row['base']))
        data = execution.pending(self.journal)
        data.pop('changes')
        data['controller'] = dict(phase='complete', status='failed', stop_reason='attempt_limit',
            attempts=[dict(index=n, fingerprint=str(n)) for n in range(1, 11)], actions=30,
            models=['earlier'], seen_patches=['old'], seen_errors=['old-error'], history=['old diagnosis'],
            invalid=0, repeated=1, action_key=None, fingerprint='old', last_diff='', last_summary='', rationale='retained')
        self.journal.state['executionCheckpoint'] = execution._write_blob(self.journal, data, self.journal.state['executionCheckpoint'])
        self.journal.state['engine'] = dict(task=314, digest=self.world.row['digest'], sha=OLD_ENGINE,
            ref=self.world.grant['engineRef'], originRun='90', queueRun='90')
        self.journal.state['budgets'] = dict(modelCalls=55, edits=6)
        self.journal.persist()
        self.before = deepcopy(self.journal.state)
        self.approval = dict(control=319, manifest=authority.digest(json.dumps(self.world.grant, sort_keys=True)),
            task=314, digest=self.world.row['digest'], fromRun='90', fromCandidate=BASE,
            executionHash=self.before['executionCheckpoint']['hash'], pr=320, candidate=HEAD, engine=ENGINE)
        self.world.owner_rows = [dict(id=700, user={'login': 'onlykappa'}, created_at=iso(self.world.now - 1),
                                     body='<!-- ' + handoff.MARKER + ' ' + json.dumps(self.approval) + ' -->')]
        self.env = dict(INPUT_ACTION='fix', KAPPA_QUEUE_RUN='91', GITHUB_SHA=ENGINE)
        self.journal.scope.queue_guard = Mock()

    def inspect(self):
        return handoff.inspect(self.world.read, self.world.grant, self.world.row, self.journal.state,
                               ENGINE, '91', self.world.pr, self.world.now)

    def test_exact_owner_receipt_is_required_not_just_a_green_manual_pr(self):
        self.assertEqual(self.inspect()['receipt'], 700)
        self.world.owner_rows[0]['user']['login'] = 'reviewer'
        self.assertIsNone(self.inspect())
        self.assertEqual(self.journal.state, self.before)

    def test_every_bound_field_and_receipt_freshness_is_required(self):
        for key in self.approval:
            with self.subTest(key=key):
                changed = dict(self.approval, **{key: 'different'})
                self.world.owner_rows[0]['body'] = '<!-- ' + handoff.MARKER + ' ' + json.dumps(changed) + ' -->'
                self.assertIsNone(self.inspect())
        self.world.owner_rows[0]['body'] = '<!-- ' + handoff.MARKER + ' ' + json.dumps(self.approval) + ' -->'
        self.world.owner_rows[0]['created_at'] = iso(self.world.now - 100)
        self.assertIsNone(self.inspect())

    def test_active_worker_revocation_expiry_or_bad_candidate_never_adopts(self):
        cases = ('active', 'closed', 'expired', 'head', 'foreign', 'workflow', 'ci', 'ancestry')
        for case in cases:
            with self.subTest(case=case):
                pr, control, comparison = deepcopy(self.world.pr), deepcopy(self.world.control), deepcopy(self.world.comparison)
                try:
                    if case == 'active': self.world.active = [dict(display_title='Agent task #314 fix')]
                    if case == 'closed': self.world.control['state'] = 'closed'
                    if case == 'expired': self.world.control['created_at'] = iso(self.world.now - 86401)
                    if case == 'head': self.world.pr['head']['sha'] = 'e' * 40
                    if case == 'foreign': self.world.pr['head']['repo']['full_name'] = 'other/repo'
                    if case == 'workflow': self.world.comparison['files'][0]['filename'] = '.github/workflows/agent.yml'
                    if case == 'ci': self.world.validation['conclusion'] = 'failure'
                    if case == 'ancestry': self.world.comparison['status'] = 'diverged'
                    with self.assertRaises(PermissionError): handoff.adopt(self.journal, 700, self.env)
                    self.assertEqual(self.journal.state, self.before)
                finally:
                    self.world.pr, self.world.control, self.world.comparison = pr, control, comparison
                    self.world.active = []
                    self.world.validation['conclusion'] = 'success'

    def test_adoption_archives_proposal_and_transfers_all_counts_into_next_repair(self):
        handoff.adopt(self.journal, 700, self.env)
        self.assertEqual(self.journal.state['candidate'], HEAD)
        self.assertEqual(self.journal.state['budgets'], self.before['budgets'])
        self.assertEqual(self.journal.state['executionDiagnostics']['finalValidation'], 'pending')
        self.assertEqual(self.journal.state['executionDiagnostics']['attempt'], 10)
        self.assertEqual(self.journal.state['executionDiagnostics']['previousSource'], BASE)
        self.assertEqual(self.journal.state['expiresAt'], self.before['expiresAt'])
        self.assertTrue(any('ownerCandidateHandoff' in r['body'] for r in self.world.rows))
        self.assertIsNone(execution.pending(self.journal, 'fix'), 'archived develop proposal must not be replayed as a Fix')
        frozen = handoff.carry(self.journal, HEAD)
        self.assertEqual(len(frozen['attempts']), 10)
        self.assertEqual(frozen['actions'], 30)
        self.assertEqual(frozen['phase'], 'candidate')
        execution.seed(self.journal, ROOT, HEAD, {'app.py': 'value=2\n'}, TASK, dict(kind='fix'))
        saved = execution.pending(self.journal, 'fix')
        self.assertEqual(saved['controller']['attempts'], frozen['attempts'])
        self.assertEqual(saved['controller']['actions'], 30)
        from tests.test_execution_recovery import session
        from engine.sandbox_repair_controller import SandboxRepairController
        control = SandboxRepairController(session(sha=HEAD), journal=self.journal)
        result = control.run_repair(TASK, Mock(side_effect=AssertionError('no new inference')), 'fixture')
        self.assertEqual(result['status'], 'success', result['summary'])
        after = execution.pending(self.journal, 'fix')['controller']
        self.assertEqual(after['attempts'][:10], frozen['attempts'])
        self.assertEqual(len(after['attempts']), 11)
        self.assertEqual(after['actions'], 30)
        self.assertEqual(self.journal.state['budgets'], self.before['budgets'])

    def test_automatic_or_unbound_handoff_and_exhausted_capacity_are_denied(self):
        with self.assertRaises(PermissionError): handoff.adopt(self.journal, 700, dict(self.env, INPUT_ACTION='resume:0:x'))
        self.journal.scope.queue_guard = None
        with self.assertRaises(PermissionError): handoff.adopt(self.journal, 700, self.env)
        self.assertEqual(self.journal.state, self.before)

    def test_failed_archival_preserves_the_original_candidate_and_checkpoint(self):
        with patch.object(self.journal, 'archive', side_effect=OSError('archive unavailable')):
            with self.assertRaises(OSError): handoff.adopt(self.journal, 700, self.env)
        self.assertEqual(self.journal.state, self.before)

    def test_exhausted_inner_history_cannot_be_bypassed_by_an_owner_source_handoff(self):
        data = execution.pending(self.journal)
        data.pop('changes')
        data['controller']['attempts'] = [dict(index=n, fingerprint=str(n)) for n in range(1, 21)]
        self.journal.state['executionCheckpoint'] = execution._write_blob(self.journal, data, self.journal.state['executionCheckpoint'])
        self.journal.persist()
        self.approval['executionHash'] = self.journal.state['executionCheckpoint']['hash']
        self.world.owner_rows[0]['body'] = '<!-- ' + handoff.MARKER + ' ' + json.dumps(self.approval) + ' -->'
        with self.assertRaises(execution.CheckpointMismatch): handoff.adopt(self.journal, 700, self.env)
        self.assertEqual(self.journal.state['candidate'], BASE)
        self.assertNotIn('carriedRepair', self.journal.state)

    def test_real_begin_keeps_the_previous_receipt_while_binding_the_new_queue_engine(self):
        env = dict(self.env, GITHUB_RUN_ID='91', GITHUB_REF_NAME=self.world.grant['engineRef'],
                   GITHUB_REPOSITORY=ROOT, KAPPA_ENGINE_CHECK='true', **{handoff.ENV: '700'})
        from engine import runtime_engine
        with patch.dict(os.environ, env), patch.object(runtime_engine.subprocess, 'check_output', return_value=ENGINE):
            self.assertTrue(self.journal.begin('fix'))
        self.assertEqual(self.journal.state['candidate'], HEAD)
        self.assertEqual(self.journal.state['ownerCandidateAdoption']['fromRun'], '90')
        self.assertEqual(self.journal.state['engine']['queueRun'], '91')
        self.assertEqual(self.journal.state['budgets'], self.before['budgets'])

    def test_queue_consumes_handoff_once_and_debits_launch_five_without_reset(self):
        from engine import task_queue as queue_module
        self.journal.state.update(status='blocked', run='90')
        self.journal.persist()
        prior = dict(version=1, control=319, manifest=self.approval['manifest'], sha=OLD_ENGINE, run='90',
            status='blocked', tasks={'314':dict(status='running', attempts=4, run='90', reservationSha=BASE)})
        self.world.owner_rows.append(dict(id=701, user={'login':'github-actions[bot]'},
            body='<!-- KAPPA_QUEUE_V1 ' + json.dumps(prior) + ' -->'))
        read = self.world.read
        def api(path, payload=None, method=None):
            if payload is not None:
                self.assertEqual(path, f'repos/{ROOT}/issues/comments/701')
                self.world.owner_rows[-1].update(payload)
                return dict(id=701)
            if path.endswith('/git/ref/heads/kappa/queue-claim-319-314'):
                return dict(object=dict(sha=BASE))
            return read(path)
        queue = queue_module.Queue(api, self.world.grant, '91', ENGINE, clock=lambda:self.world.now)
        queue.load()
        self.assertEqual(queue.state['tasks']['314']['attempts'], 4)
        self.assertEqual(queue.handoffs, {'314':700})
        child = Mock(returncode=0)
        child.poll.return_value = 0
        with patch.object(queue_module.subprocess, 'Popen', return_value=child) as spawn:
            queue.launch(self.world.row, 'fix', self.world.now + 60)
        self.assertEqual(spawn.call_count, 1)
        self.assertEqual(spawn.call_args.kwargs['env'][handoff.ENV], '700')
        self.assertEqual(queue.state['tasks']['314']['attempts'], 5)
        self.assertFalse(queue.handoffs)

    def test_publication_carries_updated_usage_forward_to_a_later_fix(self):
        from engine import developer
        handoff.adopt(self.journal, 700, self.env)
        execution.seed(self.journal, ROOT, HEAD, {'engine/new.py':'fixed = True\n'}, TASK, dict(kind='fix'))
        data = execution.pending(self.journal, 'fix')
        data.pop('changes')
        data['controller']['actions'] = 31
        self.journal.state['executionCheckpoint'] = execution._write_blob(self.journal, data, self.journal.state['executionCheckpoint'])
        self.journal.state['candidate'] = 'e' * 40
        developer.publication_finished(self.journal)
        carried = handoff.carry(self.journal, 'e' * 40)
        self.assertEqual(carried['actions'], 31)
        self.assertEqual(len(carried['attempts']), 10)

    def test_withdrawal_during_archival_stops_before_adoption_and_retains_old_state(self):
        write = self.journal.write
        def withdraw(*args, **kwargs):
            result = write(*args, **kwargs)
            self.world.owner_rows[0]['body'] = 'Owner withdrew the handoff'
            return result
        with patch.object(self.journal, 'write', side_effect=withdraw):
            with self.assertRaises(PermissionError): handoff.adopt(self.journal, 700, self.env)
        self.assertEqual(self.journal.state, self.before)

    def test_old_generation_material_is_archived_without_claiming_it_was_published(self):
        from engine import developer
        self.journal.state['generationPlan'] = execution._write_blob(self.journal, dict(task=314, rejectedPlan='old plan'))
        old_hash = self.journal.state['generationPlan']['hash']
        handoff.adopt(self.journal, 700, self.env)
        execution.seed(self.journal, ROOT, HEAD, {'engine/new.py':'fixed = True\n'}, TASK, dict(kind='fix'))
        developer.publication_finished(self.journal)
        self.assertEqual(self.journal.state['ownerCandidatePriorGeneration']['generationPlan'], old_hash)
        self.assertNotIn('generationPlanPublished', self.journal.state)
        self.assertTrue(any('rejectedPlan' in r['body'] for r in self.world.rows if 'ownerCandidateHandoff' in r['body']))

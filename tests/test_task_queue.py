"""Exercise authority, persisted starts and real queue advancement with an injected GitHub API."""
import base64
import copy
import hashlib
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
from datetime import datetime, timezone

from engine import intent_guard, queue_authority as auth, runtime_engine, task_queue as q


class World:
    def __init__(self):
        self.now = 1793234000
        self.sha = 'a' * 40
        self.issues = {318: dict(number=318, state='open', user={'login': 'onlykappa'}, body='Owner queue; no merge.',
                                created_at='2026-10-29T00:46:00Z')}
        self.grant = dict(version=1, control=318, grant=auth.digest(self.issues[318]['body']), enginePR=312,
                          engineRef='fix/308-phase3-followups', tasks=[])
        for n in (313, 314):
            base = self.grant['engineRef'] if n == 313 else f'fix/phase3-queue-base-{n}'
            body = f'Repository: {q.ROOT}\nMode: develop\nBase: {base}\n\nImplement bounded code and tests.'
            self.issues[n] = dict(number=n, state='open', user={'login': 'onlykappa'}, body=body,
                                  created_at='2026-10-29T00:16:00Z', labels=[{'name': 'kappa-task'}])
            self.grant['tasks'].append(dict(issue=n, digest=auth.digest(body), base=base, existing=n == 313))
        self.run = dict(id=90, status='in_progress', event='workflow_dispatch', path='.github/workflows/agent.yml',
                        repository={'full_name': q.ROOT}, actor={'login': 'onlykappa'}, triggering_actor={'login': 'onlykappa'},
                        head_sha=self.sha, head_branch=self.grant['engineRef'], display_title='Agent task #318 queue')
        self.engine = dict(state='open', draft=True, changed_files=1, user={'login': 'onlykappa'},
                           base=dict(ref='main', repo={'full_name': q.ROOT}),
                           head=dict(ref=self.grant['engineRef'], sha=self.sha, repo={'full_name': q.ROOT}))
        self.comments, self.refs, self.prs, self.runs, self.writes = [], {}, {}, {}, []
        self.paths = {}
        self.started = []
        self.checkpoints = {}
        self.history = {}
        self.engine_files = [{'filename': 'engine/task_queue.py', 'status': 'modified'}]
        self.seed_runs = {}

    def complete(self, n):
        row = next(r for r in self.grant['tasks'] if r['issue'] == n)
        sha = hex(n)[2:].zfill(40)
        pr = dict(number=n + 100, state='open', draft=True, changed_files=1,
                  body='<!-- KAPPA_REVIEW_V1 {"complete": true, "problems": []} -->',
                  head=dict(ref=f'kappa/dev-{n}', sha=sha, repo={'full_name': q.ROOT}),
                  base=dict(ref=row['base'], repo={'full_name': q.ROOT}))
        self.prs[n] = pr
        self.paths[n] = [{'filename': 'engine/review_sync.py', 'status': 'added'}]
        self.runs['sandbox-tests.yml', n] = dict(status='completed', conclusion='success', event='workflow_dispatch',
            path='.github/workflows/sandbox-tests.yml', head_branch='main', repository={'full_name': q.ROOT},
            display_title=f'Sandbox validation kappa/dev-{n} @ {sha}')
        state = dict(version=1, task=n, repo=q.ROOT, digest=row['digest'], run=str(self.run['id']), candidate=sha,
                     status='engine_pinned', engineStatus='testing', engine=dict(queueRun=str(self.run['id']), sha=self.sha))
        self.checkpoints[n] = dict(id=n, user={'login': 'github-actions[bot]'},
                                  body='### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(state) + ' -->')
        return pr

    def api(self, path, payload=None, method=None):
        p = path.removeprefix(q.PREFIX)
        if payload is not None:
            self.writes.append((p, copy.deepcopy(payload), method))
            if p == 'git/refs':
                name = payload['ref'].removeprefix('refs/heads/')
                if name in self.refs:
                    raise urllib.error.HTTPError('', 422, 'exists', {}, None)
                self.refs[name] = payload['sha']
                return {}
            if p.endswith('/labels'):
                return []
            if p.endswith('/comments'):
                row = dict(id=len(self.comments) + 1, user={'login': 'github-actions[bot]'}, **payload)
                self.comments.append(row)
                return copy.deepcopy(row)
            if p.startswith('issues/comments/'):
                row = next(c for c in self.comments if c['id'] == int(p.rsplit('/', 1)[1]))
                row.update(payload)
                return copy.deepcopy(row)
            raise AssertionError('Unexpected mutation ' + p)
        if p.startswith('actions/runs/'):
            n = int(p.rsplit('/', 1)[1])
            return copy.deepcopy(self.run if n == self.run['id'] else self.history[n])
        if p.startswith('commits/'):
            return dict(commit=dict(message=auth.PUSH_MESSAGE, committer=dict(date='2026-10-29T00:47:00Z')))
        if p.startswith('contents/'):
            return dict(path=auth.PATH, encoding='base64', content=base64.b64encode(json.dumps(self.grant).encode()).decode())
        if p == 'pulls/312':
            return copy.deepcopy(self.engine)
        if p.startswith('pulls/312/files?'):
            return copy.deepcopy(self.engine_files)
        if p.startswith('issues/') and '/comments?' not in p:
            return copy.deepcopy(self.issues[int(p.rsplit('/', 1)[1])])
        if '/comments?' in p:
            n = int(p.split('/')[1])
            return copy.deepcopy(self.comments if n == 318 else [self.checkpoints[n]] if n in self.checkpoints else [])
        if p.startswith('git/ref/heads/'):
            name = p.removeprefix('git/ref/heads/')
            if name not in self.refs:
                raise urllib.error.HTTPError('', 404, 'missing', {}, None)
            return {'object': {'sha': self.refs[name]}}
        if p.startswith('pulls?'):
            n = int(p.split('kappa/dev-')[1].split('&')[0])
            return [copy.deepcopy(self.prs[n])] if n in self.prs else []
        if p.startswith('pulls/'):
            n = int(p.split('/')[1]) - 100
            return copy.deepcopy(self.paths[n] if '/files?' in p else self.prs[n])
        if 'actions/workflows/agent.yml/runs?' in p:
            if 'head_sha=' in p:
                sha = p.split('head_sha=')[1].split('&')[0]
                return {'workflow_runs': [copy.deepcopy(r) for r in [self.run, *self.history.values()] if r['head_sha'] == sha]}
            return {'workflow_runs': []}
        if p.startswith('actions/workflows/'):
            workflow = p.split('/')[2]
            if 'head_sha=' in p:
                return {'workflow_runs': copy.deepcopy(self.seed_runs.get(workflow, []))}
            return {'workflow_runs': [copy.deepcopy(r) for (wf, n), r in self.runs.items() if wf == workflow]}
        raise AssertionError('Unexpected read ' + p)

    def queue(self):
        return q.Queue(self.api, self.grant, str(self.run['id']), self.sha, clock=lambda: self.now, sleep=lambda _: None)


class QueueAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.w = World()

    def test_manifest_denies_duplicate_arbitrary_base_or_task_and_unbounded_queue(self):
        auth.manifest(self.w.grant)
        for change in ('duplicate', 'base', 'extra', 'empty'):
            grant = copy.deepcopy(self.w.grant)
            if change == 'duplicate': grant['tasks'].append(grant['tasks'][0])
            if change == 'base': grant['tasks'][1]['base'] = 'main'
            if change == 'extra': grant['allowMerge'] = True
            if change == 'empty': grant['tasks'] = []
            with self.subTest(change=change), self.assertRaises(PermissionError):
                auth.manifest(grant)

    def test_pinned_owner_workflow_is_required_not_just_a_queue_environment_variable(self):
        self.assertEqual(auth.owner_run('90', self.w.api, self.w.sha, now=self.w.now), self.w.grant)
        for field, value in [('actor', {'login': 'reviewer'}), ('triggering_actor', {'login': 'github-actions[bot]'}),
                             ('event', 'push'), ('head_sha', 'b' * 40), ('display_title', 'Agent task #314 fix'),
                             ('status', 'completed')]:
            original = self.w.run[field]
            self.w.run[field] = value
            with self.subTest(field=field), self.assertRaises(PermissionError):
                auth.owner_run('90', self.w.api, self.w.sha, now=self.w.now)
            self.w.run[field] = original

    def test_push_start_requires_fresh_owner_approval_of_exact_source_and_manifest(self):
        self.w.run.update(event='push', display_title=auth.PUSH_TITLE, created_at='2026-10-29T00:49:00Z')
        proof = dict(control=318, sha=self.w.sha, manifest=auth.digest(json.dumps(self.w.grant, sort_keys=True)))
        row = dict(user=dict(login='onlykappa'), created_at='2026-10-29T00:48:00Z',
                   body='<!-- ' + auth.START_MARKER + ' ' + json.dumps(proof) + ' -->')
        self.w.comments = [row]
        self.assertEqual(auth.owner_run('90', self.w.api, now=self.w.now), self.w.grant)
        for key, value in [('user', dict(login='github-actions[bot]')),
                           ('created_at', '2026-10-29T00:46:00Z'), ('created_at', '2026-10-29T00:50:00Z'),
                           ('body', row['body'].replace(self.w.sha, 'b' * 40)),
                           ('body', row['body'].replace(proof['manifest'], 'c' * 64)), ('body', '<!-- KAPPA_QUEUE_START_V1 {} -->')]:
            with self.subTest(key=key, value=value):
                self.w.comments = [dict(row, **{key: value})]
                with self.assertRaises(PermissionError):
                    auth.owner_run('90', self.w.api, now=self.w.now)
        self.w.comments = [row]
        api = self.w.api
        def ordinary(path, *args):
            result = api(path, *args)
            if '/commits/' in path: result['commit']['message'] = 'Ordinary source update'
            return result
        with self.assertRaises(PermissionError):
            auth.owner_run('90', ordinary, now=self.w.now)

    def test_source_start_is_consumed_once_and_revoked_grant_cannot_consume_it(self):
        queue = self.w.queue()
        q.claim_start(queue)
        with self.assertRaises(urllib.error.HTTPError):
            q.claim_start(queue)
        self.assertEqual(len(self.w.refs), 1)
        self.w.issues[318]['state'] = 'closed'
        writes = len(self.w.writes)
        with self.assertRaises(PermissionError):
            q.claim_start(queue)
        self.assertEqual(len(self.w.writes), writes)

    def test_closed_edited_foreign_or_expired_queue_grants_are_not_authority(self):
        issue = self.w.issues[318]
        for key, value in [('state', 'closed'), ('body', 'reviewer changed scope'), ('user', {'login': 'reviewer'}),
                           ('created_at', '2025-01-01T00:00:00Z')]:
            old = issue[key]; issue[key] = value
            with self.subTest(key=key), self.assertRaises(PermissionError):
                auth.control(self.w.grant, self.w.api, self.w.now)
            issue[key] = old

    def test_task_scope_is_not_generated_or_expanded_by_queue(self):
        issue = self.w.issues[314]
        auth.task(self.w.grant, issue, self.w.now)
        for key, value in [('state', 'closed'), ('body', issue['body'] + '\nDo arbitrary work.'),
                           ('user', {'login': 'reviewer'}), ('created_at', '2025-01-01T00:00:00Z')]:
            old = issue[key]; issue[key] = value
            with self.subTest(key=key), self.assertRaises(PermissionError):
                auth.task(self.w.grant, issue, self.w.now)
            issue[key] = old

    def test_queue_receipt_cannot_select_missing_or_wrong_source_or_an_unlisted_task(self):
        scope = intent_guard.ExecutionScope(self.w.issues[314], self.w.now)
        value = dict(task=314, digest=scope.digest, queueRun='90', originRun='90', sha=self.w.sha,
                     ref=self.w.grant['engineRef'])
        self.assertEqual(auth.receipt(value, scope, self.w.api), self.w.grant)
        for change in ({'sha': None}, {'sha': 'b' * 40}, {'digest': 'f' * 64}, {'task': 999}, {'originRun': '91'}, {'ref': 'main'}):
            with self.subTest(change=change), self.assertRaises(PermissionError):
                auth.receipt(dict(value, **change), scope, self.w.api)

    def test_runtime_queue_receipt_remains_strict_and_cancellation_reaches_each_mutation(self):
        scope = intent_guard.ExecutionScope(self.w.issues[314], self.w.now)
        env = dict(GITHUB_SHA=self.w.sha, GITHUB_RUN_ID='90', GITHUB_REPOSITORY=q.ROOT,
                   GITHUB_REF_NAME=self.w.grant['engineRef'], KAPPA_QUEUE_RUN='90', INPUT_ACTION='queue-step')
        with patch('engine.queue_authority.time.time', return_value=self.w.now):
            receipt = runtime_engine.attest(scope, self.w.api, env=env, checkout=self.w.sha)
            self.assertEqual(runtime_engine.verify_receipt(receipt, scope, self.w.api), receipt)
            scope.check_current(self.w.issues[314], now=self.w.now)
            self.w.issues[318]['state'] = 'closed'
            with self.assertRaises(PermissionError):
                scope.check_current(self.w.issues[314], now=self.w.now)
        # Ordinary worker provenance cannot acquire a queue grant by setting an environment variable.
        self.w.run['display_title'] = 'Agent task #314 fix'
        with self.assertRaises(PermissionError):
            runtime_engine.attest(scope, self.w.api, env=env, checkout=self.w.sha)


class QueueProgressTests(unittest.TestCase):
    def setUp(self):
        self.w = World()

    def initial_ci(self, workflow, conclusion='success'):
        return dict(id=80, status='completed', conclusion=conclusion, head_sha=self.w.sha,
                    event='pull_request', path='.github/workflows/' + workflow, repository={'full_name': q.ROOT})

    def test_fresh_batch_starts_new_task_from_exact_independently_validated_owner_source(self):
        self.w.grant['tasks'] = [self.w.grant['tasks'][1]]
        self.w.seed_runs['tests.yml'] = [self.initial_ci('tests.yml')]
        queue = self.w.queue()
        def launch(row, action, deadline):
            self.assertEqual(row['issue'], 314)
            self.assertEqual(action, 'queue-step')
            self.assertEqual(self.w.refs[row['base']], self.w.sha)
            queue.state['tasks']['314'] = dict(attempts=1, status='running')
            self.w.complete(314)
        with patch.object(queue, 'launch', side_effect=launch): queue.run(self.w.now + 100)
        self.assertEqual(queue.state['seed']['validations'][0]['sha'], self.w.sha)
        self.assertEqual(queue.state['status'], 'awaiting_owner_review')
        self.assertNotIn('313', queue.state['tasks'], 'A fresh goal does not reset or replay an exhausted task')

    def test_initial_source_cannot_start_work_after_failed_ci_or_branch_movement(self):
        for change in ('failed', 'moved'):
            self.w = World(); self.w.grant['tasks'] = [self.w.grant['tasks'][1]]
            self.w.seed_runs['tests.yml'] = [self.initial_ci('tests.yml', 'failure' if change == 'failed' else 'success')]
            if change == 'moved': self.w.engine['head']['sha'] = 'b' * 40
            queue = self.w.queue()
            with patch.object(queue, 'launch') as launch, self.subTest(change=change), self.assertRaises(q.Blocked):
                queue.run(self.w.now + 100)
            launch.assert_not_called()
            self.assertNotIn('fix/phase3-queue-base-314', self.w.refs)

    def test_initial_native_source_waits_for_separate_native_ci(self):
        self.w.engine_files = [{'filename': 'ios/App/View.swift', 'status': 'modified'}]
        self.w.seed_runs['tests.yml'] = [self.initial_ci('tests.yml')]
        queue = self.w.queue()
        def wait(_): self.w.seed_runs['ios-build.yml'] = [self.initial_ci('ios-build.yml')]
        queue.sleep = Mock(side_effect=wait)
        queue.load()
        self.assertEqual(queue.seed(self.w.now + 100), self.w.sha)
        queue.sleep.assert_called_once_with(30)
        self.assertEqual({e['workflow'] for e in queue.state['seed']['validations']}, {'tests.yml', 'ios-build.yml'})

    def prepare_unpublished_failure(self):
        self.w.grant['tasks'] = [self.w.grant['tasks'][1]]
        row = self.w.grant['tasks'][0]
        self.w.complete(314)
        self.w.prs.clear()
        state = json.loads(self.w.checkpoints[314]['body'].split('KAPPA_RECOVERY_V1 ')[1].split(' -->')[0])
        state.update(candidate=self.w.sha, files=[], pr='', engineStatus='blocked')
        self.w.checkpoints[314]['body'] = '### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(state) + ' -->'
        self.w.refs[row['base']] = self.w.sha
        self.w.refs['kappa/queue-claim-318-314'] = self.w.sha
        old = self.w.queue(); old.load()
        old.state['tasks']['314'] = dict(status='blocked', attempts=1, run='90')
        old.state['seed'] = dict(sha=self.w.sha, ownerRun='90', validations=[dict(workflow='tests.yml', run=80, sha=self.w.sha, conclusion='success')])
        old.save('blocked', 'Task stopped before publishing')
        self.w.history[80] = self.initial_ci('tests.yml')
        self.w.history[90] = dict(self.w.run, status='completed', conclusion='failure')
        self.w.sha = 'b' * 40
        self.w.run = dict(self.w.run, id=91, head_sha=self.w.sha)
        self.w.engine['head']['sha'] = self.w.sha
        return state

    def test_owner_retry_before_pr_preserves_original_seed_and_attempt_accounting(self):
        self.prepare_unpublished_failure()
        queue = self.w.queue()
        def launch(row, action, deadline):
            self.assertEqual(action, 'queue-step')
            self.assertEqual(queue.state['tasks']['314']['attempts'], 1)
            self.assertEqual(self.w.refs[row['base']], 'a' * 40)
            queue.state['tasks']['314'].update(attempts=2, status='running')
            self.w.complete(314)
        with patch.object(queue, 'launch', side_effect=launch): queue.run(self.w.now + 100)
        self.assertEqual(queue.state['tasks']['314']['attempts'], 2)
        self.assertEqual(queue.state['seed']['sha'], 'a' * 40)
        self.assertEqual(self.w.refs['kappa/queue-claim-318-314'], 'a' * 40)
        self.assertEqual(queue.state['status'], 'awaiting_owner_review')

    def test_unpublished_retry_refuses_branch_pending_work_closed_pr_or_changed_base(self):
        for change in ('branch', 'pending', 'closed', 'base'):
            self.w = World(); state = self.prepare_unpublished_failure()
            if change == 'branch': self.w.refs['kappa/dev-314'] = 'c' * 40
            if change == 'base': self.w.refs['fix/phase3-queue-base-314'] = 'c' * 40
            if change == 'pending':
                state['generationCheckpoint'] = {'hash': 'preserve-this'}
                self.w.checkpoints[314]['body'] = '### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(state) + ' -->'
            reader = self.w.api
            if change == 'closed':
                reader = lambda path, *args, **kwargs: [{'number': 999}] if 'pulls?state=all&head=' in path else self.w.api(path, *args, **kwargs)
            queue = q.Queue(reader, self.w.grant, '91', self.w.sha, clock=lambda: self.w.now)
            before = copy.deepcopy(self.w.comments)
            with self.subTest(change=change), self.assertRaises(q.Blocked): queue.load()
            self.assertIsNone(queue.comment)
            self.assertEqual(self.w.comments, before)

    def test_unpublished_sandbox_requires_intact_scope_and_original_base(self):
        row = self.w.grant['tasks'][1]
        self.w.refs[row['base']] = self.w.sha
        parts = []
        def blob(value):
            raw = json.dumps(value, sort_keys=True).encode()
            fingerprint = hashlib.sha256(raw).hexdigest()
            number = 500 + len(parts)
            envelope = dict(task=314, repo=q.ROOT, hash=fingerprint, part=0, total=1,
                            data=base64.b64encode(raw).decode())
            parts.append(dict(id=number, user=dict(login='github-actions[bot]'),
                body='### KappaForge execution checkpoint\n\n<!-- KAPPA_EXECUTION_V1 ' + json.dumps(envelope) + ' -->'))
            return dict(hash=fingerprint, parts=[number])
        proposal = dict(version=1, identity=dict(task=314, repo=q.ROOT, scope=row['digest'], base=self.w.sha),
                        context=dict(kind='develop', base=row['base']), patchRef=blob({'engine/feature.py': 'value=1\n'}))
        saved = dict(files=[], pr='', candidate=self.w.sha, executionCheckpoint=blob(proposal))
        def read(path, *args):
            if '/issues/314/comments?' in path: return copy.deepcopy(parts)
            return self.w.api(path, *args)
        self.assertTrue(q.unpublished(read, row, saved, self.w.now))
        self.assertTrue(saved['executionCheckpoint'])
        for change in ('scope', 'base', 'fragment'):
            with self.subTest(change=change):
                bad = copy.deepcopy(proposal)
                if change == 'scope': bad['identity']['scope'] = 'b' * 64
                if change == 'base': bad['identity']['base'] = 'b' * 40
                if change == 'fragment': parts[0]['user']['login'] = 'reviewer'
                altered = dict(saved, executionCheckpoint=blob(bad))
                self.assertFalse(q.unpublished(read, row, altered, self.w.now))
                parts[0]['user']['login'] = 'github-actions[bot]'

    def test_reused_seed_requires_its_actual_old_ci_to_remain_successful(self):
        self.prepare_unpublished_failure()
        queue = self.w.queue(); queue.load()
        self.w.history[80]['conclusion'] = 'failure'
        with self.assertRaises(q.Blocked): queue.seed(self.w.now + 100)
        self.assertEqual(queue.state['tasks']['314']['attempts'], 1)

    def test_automatic_advancement_waits_for_real_validation_and_preserves_draft_stack(self):
        queue = self.w.queue()
        def launch(row, action, deadline):
            self.w.started.append((row['issue'], action))
            queue.state['tasks'][str(row['issue'])] = dict(status='running', attempts=1)
            if row['issue'] == 314:
                self.assertEqual(queue.state['tasks']['313']['status'], 'complete')
                self.assertEqual(self.w.refs[row['base']], self.w.prs[313]['head']['sha'])
            self.w.complete(row['issue'])
        with patch.object(queue, 'launch', side_effect=launch):
            queue.run(self.w.now + 1000)
        self.assertEqual(self.w.started, [(313, 'fix'), (314, 'queue-step')])
        self.assertEqual(queue.state['status'], 'awaiting_owner_review')
        self.assertEqual(queue.state['tasks']['314']['status'], 'complete')
        self.assertFalse(any('/merge' in p or '/releases' in p or '/dispatches' in p for p, _, _ in self.w.writes))
        self.assertFalse(any(body.get('force') for _, body, _ in self.w.writes))
        self.assertNotIn(self.w.grant['engineRef'], self.w.refs)  # Existing PR bases are never advanced.

    def test_failed_or_unknown_validation_never_advances(self):
        pr = self.w.complete(313)
        run = self.w.runs['sandbox-tests.yml', 313]
        for state, conclusion, expected in [('in_progress', None, 'waiting'), ('completed', 'failure', 'repair')]:
            run.update(status=state, conclusion=conclusion)
            self.assertEqual(q.validation(self.w.api, pr, 313), expected)
        run.update(status='completed', conclusion='cancelled')
        with self.assertRaises(q.Blocked): q.validation(self.w.api, pr, 313)
        self.assertNotIn(314, self.w.prs)

    def test_forged_stale_foreign_and_wrong_workflow_passes_are_not_evidence(self):
        pr = self.w.complete(313)
        run = self.w.runs['sandbox-tests.yml', 313]
        for key, value in [('head_branch', 'kappa/dev-313'), ('event', 'pull_request'),
                           ('path', '.github/workflows/agent.yml'), ('repository', {'full_name': 'other/repo'}),
                           ('display_title', 'Sandbox validation kappa/dev-313 @ ' + 'f' * 40)]:
            old = run[key]; run[key] = value
            with self.subTest(key=key): self.assertEqual(q.validation(self.w.api, pr, 313), 'waiting')
            run[key] = old

    def test_native_changes_and_renames_require_separate_native_success(self):
        pr = self.w.complete(313)
        self.w.paths[313] = [dict(filename='engine/a.py', previous_filename='ios/Old.swift', status='renamed')]
        self.assertEqual(q.validation(self.w.api, pr, 313), 'waiting')
        native = dict(self.w.runs['sandbox-tests.yml', 313], path='.github/workflows/ios-build.yml',
                      display_title=f"iOS build kappa/dev-313 @ {pr['head']['sha']}")
        self.w.runs['ios-build.yml', 313] = native
        self.assertEqual(q.validation(self.w.api, pr, 313), 'complete')

    def test_complete_model_review_without_tests_or_complete_file_inventory_is_not_enough(self):
        pr = self.w.complete(313)
        self.w.runs.clear()
        self.assertEqual(q.validation(self.w.api, pr, 313), 'waiting')
        pr['changed_files'] = 2
        with self.assertRaises(q.Blocked): q.validation(self.w.api, pr, 313)

    def test_missing_review_marker_and_foreign_or_stale_checkpoints_do_not_advance(self):
        pr = self.w.complete(313)
        pr['body'] = 'Looks complete'
        self.assertEqual(q.validation(self.w.api, pr, 313), 'repair')
        row = self.w.grant['tasks'][0]
        self.assertEqual(q.checkpoint(self.w.api, row, '90', self.w.sha)['candidate'], pr['head']['sha'])
        for key, value in [('user', {'login': 'reviewer'}), ('body', 'not a checkpoint')]:
            old = self.w.checkpoints[313][key]; self.w.checkpoints[313][key] = value
            with self.assertRaises(q.Blocked): q.checkpoint(self.w.api, row, '90', self.w.sha)
            self.w.checkpoints[313][key] = old
        with self.assertRaises(q.Blocked): q.checkpoint(self.w.api, row, '91', self.w.sha)
        with self.assertRaises(q.Blocked): q.checkpoint(self.w.api, row, '90', 'f' * 40)

    def test_validation_search_returns_current_match_without_enumerating_thousands_of_old_runs(self):
        pr = self.w.complete(313)
        run = self.w.runs['sandbox-tests.yml', 313]
        reader = Mock(return_value={'workflow_runs': [run] + [dict(display_title='old')] * 99})
        self.assertEqual(q.latest_validation(reader, 'sandbox-tests.yml', run['display_title']), run)
        self.assertEqual(reader.call_count, 1)

    def test_active_run_check_uses_individual_statuses_and_exact_task_boundary(self):
        calls = []
        def reader(path):
            calls.append(path)
            return {'workflow_runs': [{'display_title': 'Agent task #313 queued'}] if 'status=waiting&' in path else
                    [{'display_title': 'Agent task #3130 fix'}]}
        self.assertTrue(q.active_agents(reader, 313))
        self.assertTrue(any('status=waiting&' in p for p in calls))

    def test_lost_launch_or_unfinished_checkpoint_is_not_replayed_after_restart(self):
        queue = self.w.queue(); queue.load()
        queue.state['tasks']['313'] = dict(status='running', attempts=1)
        queue.save()
        with self.assertRaisesRegex(q.Blocked, 'unfinished'):
            self.w.queue().load()
        self.w.comments.clear()
        self.w.refs['kappa/queue-claim-318-313'] = self.w.sha
        queue = self.w.queue()
        with patch.object(queue, 'launch') as launch, self.assertRaisesRegex(q.Blocked, 'reserved'):
            queue.run(self.w.now + 100)
        launch.assert_not_called()

    def test_existing_delivery_base_cannot_be_overwritten(self):
        queue = self.w.queue()
        self.w.refs['fix/phase3-queue-base-314'] = 'b' * 40
        with self.assertRaises(q.Blocked): queue.ref('fix/phase3-queue-base-314', self.w.sha)
        self.assertEqual(self.w.refs['fix/phase3-queue-base-314'], 'b' * 40)

    def test_edited_checkpoint_revision_is_refused(self):
        queue = self.w.queue(); queue.load()
        queue.state['sha'] = 'b' * 40; queue.save()
        with self.assertRaisesRegex(q.Blocked, 'another grant'):
            self.w.queue().load()

    def prepare_failed_queue(self):
        queue = self.w.queue(); queue.load()
        self.w.complete(313)
        state = json.loads(self.w.checkpoints[313]['body'].split('KAPPA_RECOVERY_V1 ')[1].split(' -->')[0])
        state['engineStatus'] = 'blocked'
        self.w.checkpoints[313]['body'] = '### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(state) + ' -->'
        queue.state['tasks']['313'] = dict(status='running', attempts=1)
        queue.save('blocked', 'Task #313 stopped; inspect its retained failure evidence')
        self.w.refs['kappa/queue-claim-318-313'] = self.w.sha
        self.w.history[90] = dict(self.w.run, status='completed', conclusion='failure')
        self.w.sha = 'b' * 40
        self.w.run = dict(self.w.run, id=91, head_sha=self.w.sha)
        return queue

    def test_explicit_new_owner_queue_can_resume_known_failed_task_without_resetting_attempts(self):
        self.prepare_failed_queue()
        queue = self.w.queue()
        def launch(row, action, deadline):
            record = queue.state['tasks'].setdefault(str(row['issue']), dict(attempts=0))
            if row['issue'] == 313:
                self.assertEqual(record['attempts'], 1)
                self.assertEqual(action, 'fix')
            record.update(attempts=record['attempts'] + 1, status='running')
            self.w.complete(row['issue'])
        with patch.object(queue, 'launch', side_effect=launch):
            queue.run(self.w.now + 1000)
        self.assertEqual(queue.state['tasks']['313']['attempts'], 2)
        self.assertEqual(queue.state['resumedFrom'], '90')
        self.assertEqual(self.w.refs['kappa/queue-claim-318-313'], 'a' * 40)
        self.assertEqual(queue.state['status'], 'awaiting_owner_review')

    def test_owner_retry_after_three_launches_preserves_prior_debits(self):
        self.prepare_failed_queue()
        for comment in self.w.comments:
            marker = 'KAPPA_QUEUE_V1 '
            if marker in comment['body']:
                state = json.loads(comment['body'].split(marker)[1].split(' -->')[0])
                state['tasks']['313']['attempts'] = 3
                comment['body'] = '### KappaForge automatic queue\n\n<!-- ' + marker + json.dumps(state) + ' -->'
        queue = self.w.queue()
        def launch(row, action, deadline):
            record = queue.state['tasks'].setdefault(str(row['issue']), dict(attempts=0))
            if row['issue'] == 313: self.assertEqual(record['attempts'], 3)
            record.update(attempts=record['attempts'] + 1, status='running')
            self.w.complete(row['issue'])
        with patch.object(queue, 'launch', side_effect=launch): queue.run(self.w.now + 1000)
        self.assertEqual(queue.state['tasks']['313']['attempts'], 4)
        self.assertEqual(self.w.refs['kappa/queue-claim-318-313'], 'a' * 40)

    def test_failed_queue_resume_refuses_cancellation_active_worker_drift_or_exhausted_attempts(self):
        for change in ('cancelled', 'active', 'drift', 'budget', 'ambiguous'):
            self.w = World(); old = self.prepare_failed_queue()
            if change == 'cancelled': self.w.history[90]['conclusion'] = 'cancelled'
            if change == 'active': self.w.history[90]['status'] = 'in_progress'
            if change == 'drift': self.w.prs[313]['head']['sha'] = 'c' * 40
            if change in ('budget', 'ambiguous'):
                state = json.loads(self.w.comments[0]['body'].split(q.MARKER + ' ')[1].split(' -->')[0])
                if change == 'budget': state['tasks']['313']['attempts'] = q.MAX_ATTEMPTS
                else: state['status'] = 'running'
                self.w.comments[0]['body'] = '<!-- ' + q.MARKER + ' ' + json.dumps(state) + ' -->'
            before = copy.deepcopy(self.w.comments)
            queue = self.w.queue()
            with self.subTest(change=change), self.assertRaises(q.Blocked): queue.load()
            self.assertIsNone(queue.comment, 'Invalid checkpoints must never be selected for error writes')
            self.assertEqual(self.w.comments, before)

    def prepare_owner_upgrade(self):
        self.prepare_failed_queue()
        self.w.history[90].update(conclusion='cancelled', updated_at=datetime.fromtimestamp(self.w.now - 10, timezone.utc).isoformat())
        prior = json.loads(self.w.comments[0]['body'].split(q.MARKER + ' ')[1].split(' -->')[0])
        prior['status'] = 'running'
        self.w.comments[0]['body'] = '<!-- ' + q.MARKER + ' ' + json.dumps(prior) + ' -->'
        checkpoint = json.loads(self.w.checkpoints[313]['body'].split('KAPPA_RECOVERY_V1 ')[1].split(' -->')[0])
        checkpoint['engineStatus'] = 'recovering'
        self.w.checkpoints[313]['body'] = '### KappaForge recovery checkpoint\n\n<!-- KAPPA_RECOVERY_V1 ' + json.dumps(checkpoint) + ' -->'
        value = dict(fromRun='90', fromSha='a' * 40, toSha='b' * 40,
                     manifest=prior['manifest'], task=313, candidate=self.w.prs[313]['head']['sha'])
        row = dict(id=100, user={'login': 'onlykappa'}, created_at=datetime.fromtimestamp(self.w.now - 5, timezone.utc).isoformat(),
                   body='<!-- ' + q.UPGRADE_MARKER + ' ' + json.dumps(value) + ' -->')
        self.w.comments.append(row)
        return row, value

    def test_owner_can_stop_a_known_broken_engine_and_select_an_exact_new_revision(self):
        self.prepare_owner_upgrade()
        queue = self.w.queue(); queue.load()
        self.assertEqual(queue.reservations, {'313': 'a' * 40})
        self.assertEqual(queue.state['tasks']['313']['attempts'], 1)

    def test_engine_upgrade_cannot_be_inferred_from_bot_stale_or_wrong_revision_comment(self):
        for change in ('bot', 'stale', 'candidate', 'revision', 'manifest', 'task'):
            self.w = World(); comment, value = self.prepare_owner_upgrade()
            if change == 'bot': comment['user'] = {'login': 'github-actions[bot]'}
            elif change == 'stale': comment['created_at'] = datetime.fromtimestamp(self.w.now - 20, timezone.utc).isoformat()
            else:
                key = {'candidate': 'candidate', 'revision': 'toSha', 'manifest': 'manifest', 'task': 'task'}[change]
                value[key] = 999 if change == 'task' else 'c' * (64 if change == 'manifest' else 40)
                comment['body'] = '<!-- ' + q.UPGRADE_MARKER + ' ' + json.dumps(value) + ' -->'
            before = copy.deepcopy(self.w.comments)
            queue = self.w.queue()
            with self.subTest(change=change), self.assertRaises(q.Blocked): queue.load()
            self.assertIsNone(queue.comment)
            self.assertEqual(self.w.comments, before)

    def test_multiple_upgrades_preserve_first_claim_and_last_coder_when_supervisor_never_launched(self):
        comment, marker = self.prepare_owner_upgrade()
        original = 'c' * 40
        self.w.history[80] = dict(self.w.history[90], id=80, head_sha=original, conclusion='failure')
        self.w.refs['kappa/queue-claim-318-313'] = original
        first = self.w.queue(); first.load()
        self.assertEqual(first.reservations['313'], original)
        first.save('blocked', 'Immutable queue reservation/base moved')
        # Simulate the legacy checkpoint after its pre-launch supervisor failure:
        # only the supervisor identity advanced; the coder and original claim did not.
        prior = json.loads(self.w.comments[0]['body'].split(q.MARKER + ' ')[1].split(' -->')[0])
        prior['tasks']['313'].pop('reservationSha')
        prior['tasks']['313'].pop('run')
        self.w.comments[0]['body'] = '<!-- ' + q.MARKER + ' ' + json.dumps(prior) + ' -->'
        self.w.history[91] = dict(self.w.run, status='completed', conclusion='failure')
        self.w.sha = 'd' * 40
        self.w.run = dict(self.w.run, id=92, head_sha=self.w.sha)
        marker['toSha'] = self.w.sha
        self.w.comments.append(dict(comment, id=101, body='<!-- ' + q.UPGRADE_MARKER + ' ' + json.dumps(marker) + ' -->'))
        resumed = self.w.queue(); resumed.load()
        self.assertEqual(resumed.reservations['313'], original)
        self.assertEqual(resumed.state['tasks']['313']['reservationSha'], original)
        self.assertEqual(resumed.state['tasks']['313']['run'], '90')
        self.assertEqual(resumed.state['tasks']['313']['attempts'], 1)
        self.assertEqual(resumed.state['resumedFrom'], '91')
        self.assertEqual(self.w.refs['kappa/queue-claim-318-313'], original)

    def test_legacy_claim_needs_actual_owner_provenance_and_recorded_claim_cannot_move(self):
        for recorded in (False, True):
            self.w = World(); self.prepare_failed_queue()
            self.w.refs['kappa/queue-claim-318-313'] = 'c' * 40
            if recorded:
                state = json.loads(self.w.comments[0]['body'].split(q.MARKER + ' ')[1].split(' -->')[0])
                state['tasks']['313']['reservationSha'] = 'a' * 40
                self.w.comments[0]['body'] = '<!-- ' + q.MARKER + ' ' + json.dumps(state) + ' -->'
            before = copy.deepcopy(self.w.comments)
            queue = self.w.queue()
            with self.subTest(recorded=recorded), self.assertRaises(q.Blocked): queue.load()
            self.assertIsNone(queue.comment)
            self.assertEqual(self.w.comments, before)
            self.assertEqual(self.w.refs['kappa/queue-claim-318-313'], 'c' * 40)

    def test_cancelled_grant_during_model_call_terminates_child(self):
        queue = self.w.queue()
        child = Mock(pid=100, returncode=None)
        child.poll.return_value = None
        child.wait.return_value = -15
        def sleep(_): self.w.issues[318]['state'] = 'closed'
        queue.sleep = sleep
        with patch('engine.task_queue.subprocess.Popen', return_value=child), patch('engine.task_queue.os.killpg') as kill:
            with self.assertRaises(PermissionError): queue.launch(self.w.grant['tasks'][0], 'fix', self.w.now + 100)
        kill.assert_called_once_with(100, q.signal.SIGTERM)

    def test_child_failure_stops_queue_and_does_not_start_successor(self):
        queue = self.w.queue()
        with patch.object(queue, 'launch', side_effect=q.Blocked('failed')) as launch:
            with self.assertRaises(q.Blocked): queue.run(self.w.now + 100)
        self.assertEqual(launch.call_count, 1)
        self.assertNotIn('fix/phase3-queue-base-314', self.w.refs)


if __name__ == '__main__':
    unittest.main()

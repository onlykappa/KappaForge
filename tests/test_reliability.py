"""Deterministic regressions through actual persistence, routing and authorization."""
import copy
import io
import json
import os
import re
import time
import unittest
import urllib.error
from unittest.mock import MagicMock, patch
from engine import developer, intent_guard, recovery, runner, reliability, projects
from test_recovery_journal import GitHub


class DurableRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.handle = recovery.CURRENT.set(self.journal)
        self.journal.begin()
        self.journal.checkpoint('b' * 40)
        self.addCleanup(recovery.CURRENT.reset, self.handle)
        self.addCleanup(intent_guard.ACTIVE.set, None)
        runner.PROVIDER_PAUSES.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)

    def test_19_unicode_entries_and_hundreds_more_fit_actual_payload_bytes(self):
        for index in range(219):
            self.journal.event('測😀' * 250, model='writer', signature='proposal-' + str(index))
        for _, payload, _ in self.world.calls:
            if 'body' in payload:
                self.assertLessEqual(len(payload['body'].encode('utf-8')), recovery.MAX_COMMENT_BYTES)
        self.assertEqual(len(self.journal.state['events']) + self.journal.state['archivedEvents'], 219)
        self.assertEqual(len(self.journal.ledger), 219)
        restored = self.world.journal()
        self.assertTrue(restored.rejected('proposal-0'))
        self.assertEqual(restored.state['candidate'], 'b' * 40)
        archives = [json.loads(re.search(r'ARCHIVE_V1 (.*?) -->', r['body'])[1]) for r in self.world.rows if 'ARCHIVE_V1' in r['body']]
        groups = {}
        for part in archives: groups.setdefault(part['archiveId'], {})[part['part']] = part
        count = 0
        for parts in groups.values():
            data = ''.join(parts[i]['data'] for i in range(len(parts)))
            count += len(json.loads(data))
        self.assertEqual(count, self.journal.state['archivedEvents'])

    def test_failed_replacement_preserves_previous_checkpoint_and_in_memory_state(self):
        original = copy.deepcopy(self.journal.state)
        body = self.world.rows[0]['body']
        with patch.object(self.journal, 'write', side_effect=urllib.error.URLError('offline')):
            with self.assertRaises(urllib.error.URLError): self.journal.checkpoint('c' * 40)
        self.assertEqual(self.journal.state, original)
        self.assertEqual(self.world.rows[0]['body'], body)
        self.assertEqual(self.world.journal().state['candidate'], 'b' * 40)

    def test_failure_intelligence_survives_rotation_but_new_source_can_be_reconsidered(self):
        self.journal.event('matched 0 times', model='writer', signature='original')
        self.journal.event('matched 0 times again', model='writer', signature='second')
        for n in range(60): self.journal.event('new rejected edit', signature='other-' + str(n))
        restored = self.world.journal()
        self.assertTrue(restored.rejected('original'))
        self.assertIn('writer', restored.avoid_models())
        restored.checkpoint('c' * 40)
        self.assertFalse(restored.rejected('original'))
        self.assertNotIn('writer', restored.avoid_models())
        self.assertFalse(self.journal.rejected('original\nsource:new-evidence'))

    def test_former_40_boundary_is_typed_and_can_continue(self):
        scope = intent_guard.ACTIVE.get()
        for n in range(40): scope.recover(str(n), round_id=n)
        with self.assertRaises(reliability.RecoveryBudgetExceeded) as caught: scope.recover('next', round_id=41)
        self.assertNotIsInstance(caught.exception, PermissionError)
        self.assertEqual(recovery.diagnose(caught.exception)[0], 'recovery_budget')
        self.assertTrue(self.journal.defer(caught.exception))
        self.assertEqual(self.journal.state['budgets']['edits'], 40)
        self.assertEqual(self.world.journal().state['budgets']['edits'], 40)

    def test_cumulative_budget_cannot_be_reset_by_restart_or_new_candidate(self):
        self.journal.project = dict(self.journal.project, budgets={'edits':2})
        reliability.RecoveryCoordinator.charge(self.journal, 'edits')
        restarted = self.world.journal(); restarted.project = self.journal.project
        restarted.checkpoint('c' * 40)
        reliability.RecoveryCoordinator.charge(restarted, 'edits')
        with self.assertRaises(reliability.RecoveryBudgetExceeded) as error:
            reliability.RecoveryCoordinator.charge(restarted, 'edits')
        self.assertTrue(error.exception.terminal)
        self.assertFalse(restarted.defer(error.exception))

    def test_hour_cooldown_survives_restart_without_consuming_continuations(self):
        until = self.world.now + 3600
        self.assertTrue(self.journal.defer(reliability.ProviderRoutesUnavailable('rate limited', retry_at=until)))
        for delta in (301, 1200, 2400, 3599):
            self.world.now = until - 3600 + delta
            restarted = self.world.journal()
            self.assertFalse(restarted.queue())
            self.assertEqual(restarted.state['continuations'], 0)
        self.world.now = until + 31
        restarted = self.world.journal()
        self.assertTrue(restarted.queue())
        self.assertFalse(restarted.queue())
        self.assertEqual(sum(p.endswith('/dispatches') for p, _, _ in self.world.calls), 1)

    def test_waiting_deadline_and_authorization_expiry_are_enforced(self):
        self.journal.project = dict(self.journal.project, maxWaitSeconds=100)
        self.assertFalse(self.journal.defer(reliability.ProviderRoutesUnavailable('offline', retry_at=self.world.now+3600)))
        self.assertEqual(self.journal.state['status'], 'paused')
        self.world.now += 86401
        with self.assertRaises(PermissionError): self.world.journal()

    def test_permanent_provider_permission_failure_does_not_schedule_retries(self):
        error = reliability.ProviderRoutesUnavailable('Access requires configuration', terminal=True)
        self.assertFalse(self.journal.defer(error))
        self.assertEqual(self.journal.state['continuations'], 0)

    def test_authorized_registered_external_project_queues_and_resumes_same_candidate(self):
        self.world.issue['body'] = self.world.issue['body'].replace(recovery.ROOT, 'onlykappa/OmniPC')
        intent_guard.activate(self.world.issue)
        j = self.world.journal()
        metadata = dict(full_name='onlykappa/OmniPC', permissions={'push':True})
        def target(path):
            self.assertTrue(path.startswith('repos/onlykappa/OmniPC'))
            return metadata if path == 'repos/onlykappa/OmniPC' else {'object':{'sha':'b'*40}}
        with patch.object(j, 'target_read', side_effect=target):
            j.begin(); j.checkpoint('b'*40, files=['src/main.py'])
            j.defer(RuntimeError('offline')); self.world.now += 301
            self.assertTrue(j.queue())
            self.assertTrue(j.begin(f'resume:1:{j.scope.digest[:12]}'))
            self.assertFalse(j.begin(f'resume:1:{j.scope.digest[:12]}'))
        self.assertEqual(j.state['repo'], 'onlykappa/OmniPC')
        self.assertEqual(j.state['candidate'], 'b'*40)
        scope = intent_guard.ACTIVE.get()
        with self.assertRaises(PermissionError): scope.permit('https://api.github.com/repos/onlykappa/KappaForge/git/blobs', {}, 'POST')

    def test_unregistered_project_and_missing_external_access_are_blocked(self):
        self.world.issue['body'] = self.world.issue['body'].replace(recovery.ROOT, 'onlykappa/unregistered')
        with self.assertRaises(PermissionError): self.world.journal()
        with patch.dict(os.environ, {'KAPPA_CODER_TOKEN':''}):
            with self.assertRaises(PermissionError): projects.access('onlykappa/OmniPC', 'root-token')
        self.assertFalse(projects.branch_allowed('onlykappa/OmniPC', 'main'))

    def test_project_failure_ledger_and_budgets_do_not_leak(self):
        self.journal.event('bad edit', model='writer', signature='same')
        reliability.RecoveryCoordinator.charge(self.journal, 'edits')
        self.world.issue['body'] = self.world.issue['body'].replace(recovery.ROOT, 'onlykappa/Apk-revival')
        intent_guard.activate(self.world.issue)
        other = self.world.journal()
        self.assertFalse(other.rejected('same'))
        self.assertEqual(other.state['budgets'], {'edits':0,'modelCalls':0})
        self.assertEqual(other.ledger, {})

    def test_secret_redaction_and_terminal_transition_validation(self):
        secret = 'secret-provider-key-1234'
        with patch.dict(os.environ, {'FIXTURE_API_KEY':secret}):
            self.journal.event('denied ' + secret, model='writer')
        self.assertNotIn(secret, json.dumps(self.world.rows))
        with self.assertRaises(reliability.RecoveryBudgetExceeded):
            reliability.RecoveryCoordinator.transition('completed','running')
        reliability.RecoveryCoordinator.transition('completed','running', resuming=True)
    def test_routing_cooldown_survives_both_generation_error_wrappers(self):
        until = self.world.now + 3600
        answer = '{"files":[ BAD ]}'
        outage = reliability.ProviderRoutesUnavailable('routing timeout', retry_at=until)
        with patch.object(developer, 'run_model', side_effect=[('writer',answer),outage]):
            with self.assertRaises(developer.GenerationFailure) as error:
                developer.generate_with('key','change value',recovery.ROOT,{}, {},'',None,developer.SMALL)
        self.assertEqual(error.exception.retry_at,until)
        self.journal.split_used = True
        with patch.object(developer, 'generate_with', side_effect=[error.exception,error.exception]):
            with self.assertRaises(developer.GenerationFailure) as final:
                developer.generate('key','change value',recovery.ROOT,{}, {})
        self.assertEqual(final.exception.retry_at,until)
        self.assertTrue(self.journal.defer(final.exception))
        self.assertGreater(self.journal.state['nextAt'],until)

    def test_ready_requires_independent_exact_candidate_checks(self):
        from engine import native_build
        success = dict(status='completed',conclusion='success')
        with patch.object(developer,'sandbox_result',return_value=success), \
                patch.object(native_build,'result',return_value=None),patch.object(native_build,'needed',return_value=False):
            result = recovery.resume_checks(self.journal, {'body':developer.review_record([])}, 'fixture')
        self.assertEqual(result,'ready')
        self.assertEqual(self.journal.state['executionState'],'completed')

    def test_three_fix_boundary_changes_strategy_without_abandoning_authorized_work(self):
        from engine import native_build
        comments = [{'body':developer.FIX_MARKER+'prior -->'} for _ in range(3)]
        def gh(path,token,payload=None,method=None):
            if '/issues/133/comments?' in path:return comments
            return self.world.read(path) if payload is None else self.world.write(path,payload,method or 'POST')
        with patch.object(developer,'gh',side_effect=gh), \
                patch.object(developer,'sandbox_result',return_value=dict(id=123,status='completed',conclusion='failure')), \
                patch.object(native_build,'result',return_value=None),patch.object(developer,'owner_guidance',return_value=[]), \
                patch.object(developer,'revise_branch',side_effect=RuntimeError('reached repair strategy')) as repair, \
                patch.object(developer,'report_stuck') as stopped:
            with self.assertRaisesRegex(RuntimeError,'reached repair strategy'):
                developer.fix_pull_request(self.world.issue,'key','fixture')
        repair.assert_called_once();stopped.assert_not_called()
        self.assertEqual(self.journal.state['budgets']['fixCycles'],4)
        self.assertEqual(self.journal.state['repairStrategy'],'compact')
        self.assertEqual(self.world.journal().state['budgets']['fixCycles'],4)

    def test_large_active_requirements_are_preserved_outside_small_checkpoint(self):
        self.journal.requirements(['😀' * 3900 + str(i) for i in range(3)])
        for index in range(40): self.journal.event('測' * 500, signature='large-catalog-'+str(index))
        self.assertEqual(len(self.world.journal().state['requirements']),3)
        self.assertEqual(self.world.journal().state['requirements'],self.journal.state['requirements'])
        for _, payload, _ in self.world.calls:
            if 'body' in payload:self.assertLessEqual(len(payload['body'].encode()),recovery.MAX_COMMENT_BYTES)

    def test_verification_cannot_complete_after_concurrent_branch_update(self):
        from engine import native_build
        self.world.refs['kappa/dev-130'] = 'c'*40
        with patch.object(developer,'sandbox_result',return_value=dict(status='completed',conclusion='success')), \
                patch.object(native_build,'result',return_value=None),patch.object(native_build,'needed',return_value=False):
            self.assertEqual(recovery.resume_checks(self.journal,{'body':developer.review_record([])},'fixture'),'blocked')
        self.assertNotEqual(self.journal.state['executionState'],'completed')
        self.assertEqual(self.world.refs['kappa/dev-130'],'c'*40)

    def test_failure_policy_changes_with_source_context_not_history_rotation(self):
        self.journal.context='large-context'
        self.journal.event('bad schema',model='writer',signature='one')
        self.journal.event('bad schema',model='writer',signature='two')
        self.assertIn('writer',self.journal.avoid_models('large-context'))
        self.assertNotIn('writer',self.journal.avoid_models('compact-context'))
        self.assertTrue(self.journal.rejected('one'))



class ProviderHealthTests(unittest.TestCase):
    def setUp(self):
        runner._lists.clear(); runner.PROVIDER_PAUSES.clear(); runner.COOLDOWN.clear(); runner.EXHAUSTED.clear(); runner.REQUEST_REJECTIONS.clear()
        self.addCleanup(runner.PROVIDER_PAUSES.clear)
        self.addCleanup(runner.COOLDOWN.clear)
        self.addCleanup(runner.EXHAUSTED.clear)
        self.now = 2000000000
        self.clock = patch.object(runner.time, 'time', side_effect=lambda:self.now); self.clock.start(); self.addCleanup(self.clock.stop)
        self.config = {'order':['fixture','healthy'],'exclude':'embed','maxModelsPerProvider':2,'providers':{
            n:dict(kind='openai',base='https://'+n,context=100000,maxOutput=8192,key='FIXTURE_KEY') for n in ('fixture','healthy')}}
        self.cfg=patch.object(runner,'PROVIDERS',self.config);self.cfg.start();self.addCleanup(self.cfg.stop)
        self.env=patch.dict(os.environ,{'FIXTURE_KEY':'test-key'});self.env.start();self.addCleanup(self.env.stop)

    def test_discovery_403_does_not_repeat_and_other_provider_remains_healthy(self):
        with patch.object(runner.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('fixture',403,'denied',{},None)) as call:
            self.assertEqual(runner.provider_models('fixture'),[])
            self.now += 86400
            self.assertEqual(runner.provider_models('fixture'),[])
        self.assertEqual(call.call_count,1)
        row=runner.health_record(runner.provider_identity('fixture'))
        self.assertEqual(row['category'],'authorization');self.assertTrue(row['blocked'])
        self.assertFalse(runner.provider_paused(runner.provider_identity('healthy')))
        with patch.dict(os.environ,{'FIXTURE_KEY':'legitimately-updated-key'}):
            self.assertFalse(runner.provider_paused(runner.provider_identity('fixture')))

    def test_classification_and_model_specific_quarantine(self):
        for code, expected in ((401,'authentication'),(403,'authorization'),(429,'rate_limit'),(503,'server_outage')):
            self.assertEqual(reliability.classify(code),expected)
        runner.provider_failure('fixture','bad',403)
        identity=runner.provider_identity('fixture')
        self.assertTrue(runner.provider_paused(identity,'bad'))
        self.assertFalse(runner.provider_paused(identity,'good'))

    def test_retry_after_exponential_backoff_and_single_half_open_probe(self):
        runner.provider_failure('fixture',code=429,headers={'Retry-After':'3600'})
        identity=runner.provider_identity('fixture')
        self.assertEqual(runner.health_record(identity)['until'],self.now+3600)
        self.now += 3601
        self.assertFalse(runner.provider_paused(identity,probe=True))
        self.assertTrue(runner.provider_paused(identity,probe=True))
        self.now += 121
        runner.provider_failure('fixture',code=503)
        self.assertEqual(runner.health_record(identity)['until'],self.now+120)
        self.assertEqual(reliability.retry_after({'Retry-After':'Wed, 18 May 2033 03:33:20 GMT'},0),2000000000)

    def test_quarantine_and_reason_survive_process_restart(self):
        world=GitHub();j=world.journal();j.begin();handle=recovery.CURRENT.set(j)
        try:
            runner.provider_failure('fixture',code=401)
            runner.PROVIDER_PAUSES.clear()
            restored=world.journal(); recovery.CURRENT.set(restored)
            self.assertTrue(runner.provider_paused(runner.provider_identity('fixture')))
            self.assertEqual(next(iter(restored.state['providerHealth'].values()))['category'],'authentication')
        finally:recovery.CURRENT.reset(handle);intent_guard.ACTIVE.set(None)

    def test_all_malformed_completion_envelopes_produce_typed_errors(self):
        for data in (None,[],{}, {'choices':None}, {'choices':[1]}, {'choices':[{'message':[]}]},
                     {'choices':[{'message':{'content':7}}]}, {'choices':[{'message':{'content':'ok','tool_calls':[{}]}}]}):
            with self.subTest(data=data), self.assertRaises(reliability.ProviderResponseError): reliability.completion(data)
        for raw in (b'[]',b'{"choices":',b'null'):
            with self.assertRaises(reliability.ProviderResponseError):reliability.response_json(io.BytesIO(raw))
        for data in (None,[],{}, {'data':[None]}, {'data':[{'id':None}]}):
            with self.assertRaises(reliability.ProviderResponseError):reliability.models(data)
        self.assertEqual(reliability.completion({'choices':[{'message':{'content':'valid'}}]})[0],'valid')

    def test_malformed_provider_response_switches_to_healthy_alternative(self):
        def urlopen(req,timeout=None):
            response=MagicMock();response.__enter__.return_value=response
            response.read.return_value=b'[]' if 'fixture' in req.full_url else b'{"choices":[{"message":{"content":"valid"}}]}'
            return response
        with patch.object(runner,'provider_models',return_value=['free-model']),patch.object(runner.urllib.request,'urlopen',side_effect=urlopen):
            self.assertEqual(runner.run_fallback_providers('prompt',1000,[]),('healthy:free-model','valid'))
        self.assertEqual(runner.health_record(runner.provider_identity('fixture')+':free-model')['category'],'invalid_response')


    def test_request_413_remembers_exact_payload_but_allows_smaller_request(self):
        calls=[]
        def urlopen(req,timeout=None):
            content=json.loads(req.data)['messages'][0]['content'];calls.append(content)
            if content=='large':raise urllib.error.HTTPError(req.full_url,413,'too large',{},None)
            result=MagicMock();result.__enter__.return_value=result
            result.read.return_value=b'{"choices":[{"message":{"content":"valid"}}]}'
            return result
        with patch.object(runner,'provider_models',return_value=['free']),patch.object(runner.urllib.request,'urlopen',side_effect=urlopen):
            self.assertIsNone(runner.run_fallback_providers('large',1000,[],allowed={'fixture'}))
            self.assertIsNone(runner.run_fallback_providers('large',1000,[],allowed={'fixture'}))
            self.assertEqual(runner.run_fallback_providers('small',1000,[],allowed={'fixture'}),('fixture:free','valid'))
        self.assertEqual(calls,['large','small'])

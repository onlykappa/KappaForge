import contextlib
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import gateway, developer, recovery, runner, intent_guard


class GatewayEvidenceTests(unittest.TestCase):
    def test_mixed_route_failures_preserve_recoverable_quota_wait(self):
        import time
        for category in ('authentication', 'billing_blocked', 'provider_denied', 'model_unavailable'):
            data = {'code':'free_route_unavailable', 'retryAt':(time.time()+60)*1000,
                    'failure':{'source':'upstream', 'category':category},
                    'attempts':[{'category':'rate_limit', 'status':429}, {'category':category, 'status':401}]}
            error = gateway.error(503, data)
            self.assertFalse(error.terminal)
            self.assertGreater(error.retry_at, time.time())
            self.assertEqual(recovery.diagnose(error)[1], 'switch_or_defer')
        data.pop('retryAt')
        self.assertFalse(gateway.error(503, data).terminal, 'transient history still permits bounded recovery')
        self.assertTrue(gateway.error(503, data, pinned=True).terminal, 'pinned execution keeps its explicit bounds')

    def test_transport_and_invalid_gateway_responses_preserve_sanitized_evidence(self):
        import urllib.error
        for cause, category in [(TimeoutError('secret fixture'), 'timeout'),
                                (urllib.error.URLError('secret fixture'), 'network_failure'),
                                (runner.ProviderResponseError('secret fixture'), 'malformed_response')]:
            with self.subTest(category=category), patch.dict(os.environ, {
                    'KAPPA_ROUTER_URL':'https://fixture.example', 'KAPPA_ROUTER_TOKEN':'x'*40}), \
                    patch.object(runner.urllib.request, 'urlopen', side_effect=cause) as network, \
                    patch.object(gateway, 'record') as record:
                with self.assertRaises(gateway.GatewayUnavailable) as error:
                    runner.run_integrated_router('private original brief', 100, ['nvidia','groq'])
                evidence = record.call_args.args[1]
                self.assertEqual(evidence['failure']['category'], category)
                self.assertEqual(evidence['failure']['source'], 'transport' if category != 'malformed_response' else 'normalization')
                self.assertIsNone(evidence['usage'])
                self.assertEqual(error.exception.retry_at, 0)
                self.assertIsNone(error.exception.status)
                self.assertNotIn('HTTP 503', str(error.exception))
                self.assertNotIn('secret fixture', str(error.exception))
                self.assertNotIn('private original brief', json.dumps(evidence))
                limits = runner.PROVIDERS['routing']['defaults']
                self.assertGreater(network.call_args.kwargs['timeout']*1000, limits['requestTimeoutMs'])
                self.assertTrue(json.loads(network.call_args.args[0].data)['fallback'])

    def test_unpinned_providers_do_not_depend_on_groq_diagnostics(self):
        import time
        issue = dict(number=174, state='open', user={'login':'onlykappa'},
                     created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     body='Repository: onlykappa/KappaForge\nMode: develop\nImplement the authorized change.')
        for providers in (['nvidia'], ['mistral'], ['openrouter'], ['ollama'], ['groq'], ['gemini'], ['nvidia', 'groq', 'mistral']):
            with self.subTest(providers=providers):
                scope = intent_guard.ExecutionScope(issue)
                handle = recovery.CURRENT.set(SimpleNamespace(scope=scope))
                response = Mock(status=200)
                response.__enter__ = Mock(return_value=response)
                response.__exit__ = Mock(return_value=False)
                response.read.return_value = json.dumps({'route':providers[0]+':fixture', 'text':'ok'}).encode()
                try:
                    with patch.dict(os.environ, {'KAPPA_ROUTER_URL':'https://fixture.example', 'KAPPA_ROUTER_TOKEN':'x'*40, 'GITHUB_TOKEN':'fixture'}), \
                            patch.object(runner, 'github', return_value=issue) as current, \
                            patch.object(gateway, 'probe', side_effect=gateway.GatewayUnavailable('Groq cooldown', terminal=True)) as diagnostic, \
                            patch.object(gateway, 'record'), \
                            patch.object(runner.urllib.request, 'urlopen', return_value=response) as network:
                        self.assertEqual(runner.run_integrated_router('Exact original instructions', 100, providers)[1], 'ok')
                        current.assert_called_once()
                        diagnostic.assert_not_called()
                        payload = json.loads(network.call_args.args[0].data)
                        self.assertEqual(payload['providers'], sorted(set(providers) | {'gemini'}), 'Gemini, the primary, is always eligible')
                        self.assertTrue(payload['fallback'])
                finally:
                    recovery.CURRENT.reset(handle)

    def test_saved_bounded_document_can_be_repaired_but_not_preexisting_or_broader_diffs(self):
        path = 'docs/integration/RECOVERY-NOTE.md'
        journal = SimpleNamespace(scope=SimpleNamespace(edit_path=path, inference_route='groq:openai/gpt-oss-120b'),
                                  state={'repairStrategy': '', 'events': [], 'candidate': 'b'*40}, checkpoint=Mock(),
                                  avoid_models=lambda key: set(), rejected=lambda signature: False, context='')
        handle = recovery.CURRENT.set(journal)
        pr = {'number': 1, 'html_url': 'https://github.com/onlykappa/KappaForge/pull/1', 'body': ''}
        try:
            for delta in [[{'filename': path, 'status': 'added'}], [{'filename': path, 'status': 'modified'}],
                          [{'filename': path, 'status': 'added'}, {'filename': 'other.md', 'status': 'modified'}]]:
                with self.subTest(delta=delta), \
                        patch.object(developer, 'gh', side_effect=lambda url, *args: delta if '/files?' in url else []), \
                        patch.object(developer, 'list_tree', return_value=({path: 10}, {})), \
                        patch.object(developer, 'project_guide', return_value=''), \
                        patch.object(developer, 'read_source', return_value='# Old note\n'), \
                        patch.object(developer, 'requirements_open', return_value=[]), \
                        patch.object(developer, 'is_private', return_value=False), \
                        patch.object(developer, 'code_providers', return_value={'groq'}), \
                        patch.object(developer, 'run_model', return_value=('groq:openai/gpt-oss-120b', json.dumps({
                            'files': [{'path': path, 'content': '# Corrected note\n'}]}))) as model:
                    if len(delta) == 1 and delta[0]['status'] == 'added':
                        result = developer.revise_branch({'title': 'Correct note', 'body': 'Only ' + path},
                                                        pr, 'kappa/dev-1', 'b'*40, [], 'fixture', '')
                        self.assertEqual(result[2], {path: '# Corrected note\n'})
                        model.assert_called_once()
                    else:
                        with self.assertRaises(PermissionError):
                            developer.revise_branch({'title': 'Correct note'}, pr, 'kappa/dev-1', 'b'*40, [], 'fixture', '')
                        model.assert_not_called()
        finally:
            recovery.CURRENT.reset(handle)

    def test_finalizing_an_unchanged_checkpoint_reuses_commit_without_github_write(self):
        with patch.object(developer, 'gh', side_effect=AssertionError('empty tree request')):
            result = developer.commit_changes(developer.ROOT, 'b'*40, {}, {}, 'already saved', 'fixture')
        self.assertEqual(result['sha'], 'b'*40)

    def test_verify_only_does_not_regenerate_when_checks_need_repair(self):
        pr = {'state': 'open', 'draft': True, 'head': {'sha': 'b'*40, 'ref': 'kappa/dev-152'}}
        journal = SimpleNamespace(scope=SimpleNamespace(inference_route='groq:openai/gpt-oss-120b', repo=developer.ROOT, number=152),
                                  state={'files': ['docs/note.md'], 'pr': 'https://github.com/onlykappa/KappaForge/pull/153', 'candidate': 'b'*40},
                                  target_read=Mock(return_value=pr), event=Mock(), publish=Mock())
        with patch.object(recovery, 'resume_checks', return_value='fix'), patch.object(developer, 'fix_pull_request') as fix:
            self.assertEqual(recovery.verify_saved_candidate(journal, 'fixture'), 'blocked')
        fix.assert_not_called()
        journal.publish.assert_called_once()

    def test_probe_reports_only_metadata_and_does_not_claim_capacity(self):
        data = {'provider': 'groq', 'model': 'openai/gpt-oss-120b', 'failedCondition': 'eligible',
                'secret': 'never-display-secret', 'bindings': {'secretPresent': True, 'key': 'never-display-secret'},
                'health': {'state': 'clear', 'category': 'provider_rejection'},
                'gatewayLimits': {'daily': {'available': True, 'used': 3, 'limit': 100}}}
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps(data).encode()
        output = io.StringIO()
        with patch.object(gateway.urllib.request, 'urlopen', return_value=response) as network, contextlib.redirect_stdout(output):
            result = gateway.check(gateway.probe('https://router.example', 'fixture-secret'))
        self.assertEqual(result['inferenceCapacity'], 'unverified')
        self.assertEqual(network.call_args.args[0].get_method(), 'GET')
        self.assertTrue(network.call_args.args[0].full_url.endswith('/router/diagnostics'))
        self.assertNotIn('never-display-secret', output.getvalue())
        self.assertNotIn('fixture-secret', output.getvalue())
        with self.assertRaises(gateway.GatewayUnavailable):
            gateway.check({**result, 'failedCondition': 'provider_or_model_cooldown'})

    def test_unpinned_coding_rechecks_current_task_before_any_gateway_request(self):
        import time
        issue = dict(number=174,state='open',user={'login':'onlykappa'},created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),body='Repository: onlykappa/KappaForge\nMode: develop\nImplement the authorized change.')
        scope = intent_guard.ExecutionScope(issue)
        handle = recovery.CURRENT.set(SimpleNamespace(scope=scope))
        try:
            with patch.dict(os.environ, {'KAPPA_ROUTER_URL':'https://fixture.example','KAPPA_ROUTER_TOKEN':'x'*40,'GITHUB_TOKEN':'fixture'}), patch.object(runner,'github',return_value=dict(issue,state='closed')), patch.object(runner.urllib.request,'urlopen') as network:
                with self.assertRaisesRegex(PermissionError,'cancelled'):
                    runner.run_integrated_router('Exact original instructions', 100, ['groq'])
                network.assert_not_called()
        finally:
            recovery.CURRENT.reset(handle)

    def test_account_authentication_cooldown_is_terminal_without_repeated_hammering(self):
        error = gateway.error(429, {'code':'free_capacity_cooldown','failure':{'source':'coordination','category':'authentication','upstreamStatus':401,'provider':'groq','model':'openai/gpt-oss-120b','attempted':False}})
        self.assertTrue(error.terminal)
        self.assertFalse(error.details['attempted'])
        self.assertIn('historical upstream HTTP 401', str(error))
        self.assertEqual(error.details['model'], 'openai/gpt-oss-120b')

    def test_error_translation_retains_only_structured_safe_failure_fields(self):
        failure = gateway.error(503, {'code': 'free_route_unavailable', 'failure': {
            'source': 'upstream', 'category': 'provider_rejection', 'upstreamStatus': 413,
            'rawBody': 'private prompt', 'key': 'secret'}}, pinned=True)
        self.assertEqual(failure.details, {'source': 'upstream', 'category': 'provider_rejection', 'upstreamStatus': 413})
        self.assertTrue(failure.terminal)

    def test_rate_limit_message_distinguishes_upstream_from_stored_coordination_refusal(self):
        upstream = gateway.error(429, {'code': 'free_capacity_cooldown', 'failure': {
            'source': 'upstream', 'category': 'rate_limit', 'upstreamStatus': 429}})
        self.assertIn('upstream HTTP 429', str(upstream))
        self.assertNotIn('shared route reservation refused', str(upstream))
        self.assertIn('quota remaining is unknown', str(upstream))
        cooldown = gateway.error(429, {'code': 'free_capacity_cooldown', 'failure': {
            'source': 'coordination', 'category': 'rate_limit', 'upstreamStatus': 429}})
        self.assertIn('shared route reservation refused', str(cooldown))
        self.assertIn('historical upstream HTTP 429', str(cooldown))
        unknown = gateway.error(429, {'code': 'free_capacity_cooldown'})
        self.assertIn('source not reported', str(unknown))
        self.assertNotIn('capacity is limited', str(unknown))

    def test_four_call_bound_survives_journal_reload(self):
        journal = SimpleNamespace(state={'pinnedGatewayCalls': 4}, persist=Mock())
        with self.assertRaises(gateway.GatewayUnavailable):
            gateway.pace(journal, Mock())
        journal.persist.assert_not_called()

    def test_successful_calls_are_paced_and_debited_before_network(self):
        journal = SimpleNamespace(state={'pinnedGatewayCalls': 1, 'lastGatewayCallAt': 100}, persist=Mock())
        with patch.object(gateway.time, 'time', side_effect=[110, 110, 110, 165, 165]), patch.object(gateway.time, 'sleep') as sleep:
            gateway.pace(journal, Mock())
        sleep.assert_called_once_with(5)
        self.assertEqual(journal.state['pinnedGatewayCalls'], 2)
        journal.persist.assert_called_once()

    def test_bounded_test_dispatch_disables_automatic_fixes_on_reviewed_ref(self):
        journal = SimpleNamespace(scope=SimpleNamespace(inference_route='groq:openai/gpt-oss-120b'))
        handle = recovery.CURRENT.set(journal)
        try:
            with patch.dict(os.environ, {'GITHUB_REF_NAME': 'codex/phase4-cloud-execution'}), patch.object(developer, 'gh') as request:
                developer.dispatch_tests(developer.ROOT, 'kappa/dev-152', 'b'*40, 'fixture', ['docs/note.md'])
            payload = request.call_args.args[2]
            self.assertEqual(payload['ref'], 'codex/phase4-cloud-execution')
            self.assertEqual(payload['inputs']['automatic_fixes'], 'false')
            self.assertEqual(payload['inputs']['candidate_sha'], 'b'*40)
        finally:
            recovery.CURRENT.reset(handle)

    def test_named_document_avoids_planning_call_and_preserves_full_instructions(self):
        path = 'docs/integration/BOUND-NOTE.md'
        scope = SimpleNamespace(inference_route='groq:openai/gpt-oss-120b', edit_path=path)
        handle = recovery.CURRENT.set(SimpleNamespace(scope=scope))
        try:
            guide = 'EXACT POLICY\n' * 1800
            task = 'Read docs/HANDOFF_TEMPLATE.md and create only ' + path
            files = {'docs/HANDOFF_TEMPLATE.md': 12}
            with patch.object(developer, 'run_model') as model:
                paths, stages, _ = developer.plan_change('', task, files, guide)
                model.assert_not_called()
            self.assertEqual(paths, ['docs/HANDOFF_TEMPLATE.md'])
            self.assertEqual(stages, [])
        finally:
            recovery.CURRENT.reset(handle)
        journal = SimpleNamespace(scope=scope, state={'repairStrategy': '', 'events': []}, avoid_models=lambda key: set(),
                                  rejected=lambda signature: False, context='')
        handle = recovery.CURRENT.set(journal)
        try:
            answer = json.dumps({'files': [{'path': path, 'content': '# Note\n- Cloud work'}]})
            with patch.object(developer, 'run_model', return_value=('groq:openai/gpt-oss-120b', answer)) as model:
                result = developer.generate('', task, developer.ROOT, {}, files, guide)
            self.assertIn(guide, model.call_args.args[1])
            self.assertIn(task, model.call_args.args[1])
            self.assertLess(len(model.call_args.args[1]), gateway.PINNED_PROMPT_CHARS)
            self.assertEqual(set(result[2]), {path})
            bad = json.dumps({'files': [{'path': 'wrong.md', 'content': '# Wrong'}]})
            with patch.object(developer, 'run_model', return_value=('groq:openai/gpt-oss-120b', bad)):
                with self.assertRaises(PermissionError):
                    developer.generate('', task, developer.ROOT, {}, files, guide)
        finally:
            recovery.CURRENT.reset(handle)


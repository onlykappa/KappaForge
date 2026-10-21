import contextlib
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import gateway, developer, recovery


class GatewayEvidenceTests(unittest.TestCase):
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

    def test_error_translation_retains_only_structured_safe_failure_fields(self):
        failure = gateway.error(503, {'code': 'free_route_unavailable', 'failure': {
            'source': 'upstream', 'category': 'provider_rejection', 'upstreamStatus': 413,
            'rawBody': 'private prompt', 'key': 'secret'}}, pinned=True)
        self.assertEqual(failure.details, {'source': 'upstream', 'category': 'provider_rejection', 'upstreamStatus': 413})
        self.assertTrue(failure.terminal)

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


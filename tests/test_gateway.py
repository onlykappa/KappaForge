import contextlib
import io
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from engine import gateway, developer, recovery


class GatewayEvidenceTests(unittest.TestCase):
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


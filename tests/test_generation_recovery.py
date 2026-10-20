"""Real generation and transport regressions from task #130's failed repair."""
import io
import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch
from engine import developer, runner

SOURCE = {'app.py': 'value = 1\n'}
EXISTING = {'app.py': 10}
GOOD = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
BAD = '{"files": [{"path": "app.py", BAD}'


class GenerationRecoveryTests(unittest.TestCase):
    def test_bad_json_is_repaired_then_passes_real_edit_and_syntax_validation(self):
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD), ('formatter', GOOD)]) as model:
            _, _, changes, _ = developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(changes, {'app.py': 'value = 2\n'})
        prompt = model.call_args_list[1].args[1]
        self.assertIn('Repair ONLY the JSON', prompt)
        self.assertIn(BAD, prompt)
        self.assertNotIn('SOURCE FILES', prompt)

    def test_json_repair_does_not_bypass_scope_checks_or_retry_forbidden_paths(self):
        unsafe = json.dumps({'files': [{'path': '.github/evil.py', 'content': 'value = 2'}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD), ('formatter', unsafe)]) as model:
            with self.assertRaisesRegex(ValueError, 'Protected path'):
                developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(model.call_count, 2)

    def test_two_bad_answers_then_route_timeout_uses_compact_source_and_succeeds(self):
        # Exact production sequence: two JSON failures, then routing RuntimeError.
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD), ('writer', BAD),
                RuntimeError('Model routes reached their shared four-minute budget'), ('other', GOOD)]) as model:
            _, _, changes, _ = developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(changes['app.py'], 'value = 2\n')
        compact = model.call_args_list[3]
        self.assertEqual(compact.kwargs['max_output_tokens'], 8192)
        self.assertIn('four-minute budget', compact.args[1])
        self.assertIn('SOURCE FILES', compact.args[1])
        self.assertIn('value = 1', compact.args[1])

    def test_exhausted_json_answers_get_compact_recovery_before_stopping(self):
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD)] * 5 + [('other', GOOD)]) as model:
            _, _, changes, _ = developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(changes['app.py'], 'value = 2\n')
        self.assertEqual(model.call_count, 6)

    def test_exhausted_edit_answers_try_compact_strategy_then_succeed(self):
        bad_edit = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'missing', 'replace': 'x'}]}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', bad_edit)] * 5 + [('other', GOOD)]) as model:
            _, _, changes, _ = developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(changes['app.py'], 'value = 2\n')
        self.assertEqual(model.call_count, 6)
        self.assertEqual(model.call_args.kwargs['max_output_tokens'], 8192)

    def test_recovery_stops_with_evidence_after_both_bounded_strategies(self):
        with patch.object(developer, 'run_model', return_value=('writer', BAD)) as model:
            with self.assertRaisesRegex(ValueError, 'large and compact recovery'):
                developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(model.call_count, 10)

    def test_final_failure_preserves_transport_reason_and_both_strategies(self):
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD),
                RuntimeError('shared four-minute budget'), RuntimeError('all approved providers offline')]) as model:
            with self.assertRaisesRegex(ValueError, 'large and compact recovery') as error:
                developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertIn('four-minute budget', str(error.exception))
        self.assertIn('all approved providers offline', str(error.exception))
        self.assertEqual(model.call_count, 3)

    def test_authorization_failure_is_not_treated_as_recoverable_generation(self):
        with patch.object(developer, 'run_model', side_effect=PermissionError('authorization expired')) as model:
            with self.assertRaises(PermissionError):
                developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(model.call_count, 1)

    def test_format_repair_is_bounded_and_returns_to_source_for_invalid_edits(self):
        invalid = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'missing', 'replace': 'x'}]}]})
        with patch.object(developer, 'run_model', side_effect=[('writer', BAD), ('formatter', invalid), ('other', GOOD)]) as model:
            _, _, changes, _ = developer.generate('key', 'change value', developer.ROOT, SOURCE, EXISTING)
        self.assertEqual(changes['app.py'], 'value = 2\n')
        self.assertIn('SOURCE FILES', model.call_args_list[2].args[1])
        self.assertIn('matched 0', model.call_args_list[2].args[1])


class StructuredProviderTests(unittest.TestCase):
    def run_provider(self, reject=False, json_mode=True):
        calls = []
        def urlopen(req, timeout=None):
            payload = json.loads(req.data)
            calls.append(payload)
            if reject and 'response_format' in payload:
                raise urllib.error.HTTPError(req.full_url, 400, 'unsupported format', {}, io.BytesIO())
            response = MagicMock()
            response.__enter__.return_value = response
            response.read.return_value = json.dumps({'choices': [{'message': {'content': '{}'}}]}).encode()
            return response
        with patch.object(runner, 'provider_models', return_value=['model']), patch.object(runner, 'fits', return_value=True), \
                patch.object(runner, 'model_timeout', return_value=1), patch('engine.runner.urllib.request.urlopen', side_effect=urlopen), \
                patch.dict(runner.PROVIDERS, {'order': ['groq']}), patch.dict(runner.COOLDOWN, {}, clear=True), \
                patch.object(runner, 'EXHAUSTED', set()):
            answer = runner.run_fallback_providers('Return JSON', 100, [], allowed={'groq'}, json_mode=json_mode)
        self.assertEqual(answer, ('groq:model', '{}'))
        return calls

    def test_json_mode_reaches_the_actual_provider_payload(self):
        self.assertEqual(self.run_provider()[0]['response_format'], {'type': 'json_object'})

    def test_unsupported_json_mode_retries_once_without_disabling_validation(self):
        calls = self.run_provider(reject=True)
        self.assertEqual(len(calls), 2)
        self.assertNotIn('response_format', calls[1])

    def test_plain_chat_requests_do_not_enable_json_mode(self):
        self.assertNotIn('response_format', self.run_provider(json_mode=False)[0])

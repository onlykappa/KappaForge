import unittest
from unittest.mock import patch
from scripts import provider_35000_probe as probe


class ProviderProbeTests(unittest.TestCase):
    def test_identical_exact_sample(self):
        self.assertEqual(len(probe.TEXT), 35000)

    def test_paid_model_is_never_selected_from_free_gateway(self):
        catalog = [{'id': 'paid:free', 'pricing': {'prompt': '0.1', 'completion': '0'}},
                   {'id': 'safe:free', 'pricing': {'prompt': '0', 'completion': '0'}}]
        self.assertEqual(probe.select_model('openrouter', {'freeOnly': True}, catalog), 'safe:free')
        self.assertIsNone(probe.select_model('openrouter', {'freeOnly': True}, catalog[:1]))

    def test_missing_credentials_send_nothing(self):
        with patch.dict('os.environ', {'UNAVAILABLE_TEST_KEY': ''}), patch.object(probe, 'send') as send:
            row = probe.probe('test', {'key': 'UNAVAILABLE_TEST_KEY'})
        send.assert_not_called()
        self.assertEqual(row['result'], 'not_tested')

    def test_metered_provider_sends_nothing(self):
        with patch.object(probe, 'send') as send:
            row = probe.probe('huggingface', {'metered': True})
        send.assert_not_called()
        self.assertEqual(row['inferenceRequests'], 0)

    def test_success_and_truncation_are_distinct(self):
        with patch.dict('os.environ', {'TEST_KEY': 'secret'}), patch.object(probe, 'send', return_value={
            'choices': [{'finish_reason': 'length'}], 'usage': {'prompt_tokens': 9000}}) as send:
            row = probe.probe('test', {'key': 'TEST_KEY', 'base': 'https://example.test', 'freeModels': ['free-model']})
        self.assertEqual(row['result'], 'accepted')
        self.assertEqual(row['finishReason'], 'length')
        self.assertEqual(len(send.call_args.args[2]['messages'][0]['content']), 35000)

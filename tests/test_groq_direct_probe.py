import contextlib
import io
import unittest
from unittest.mock import patch
from scripts import groq_direct_probe as probe


class DirectProbeTests(unittest.TestCase):
    def test_exact_sizes_and_bounded_answer(self):
        for size in probe.SIZES:
            body = probe.payload(size)
            self.assertEqual(len(body['messages'][0]['content']), size)
            self.assertEqual(body['model'], 'openai/gpt-oss-120b')
            self.assertEqual(body['max_completion_tokens'], 256)
        self.assertEqual(max(probe.SIZES), 80000)

    def test_no_credential_means_no_requests(self):
        with patch.dict('os.environ', {'GROQ_API_KEY': ''}), patch.object(probe.urllib.request, 'urlopen') as send:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(probe.main(), 2)
            send.assert_not_called()
            self.assertIn('"providerRequests": 0', output.getvalue())

    def test_direct_requests_and_usage(self):
        response = io.StringIO('{"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":100}}')
        with patch.dict('os.environ', {'GROQ_API_KEY': 'test-key'}), patch.object(probe, 'SIZES', (20000,)), \
                patch.object(probe.urllib.request, 'urlopen', return_value=response) as send:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(probe.main(), 0)
            self.assertEqual(send.call_args.args[0].full_url, 'https://api.groq.com/openai/v1/chat/completions')
            self.assertNotIn('test-key', output.getvalue())
            self.assertIn('"gatewayUsed": false', output.getvalue())

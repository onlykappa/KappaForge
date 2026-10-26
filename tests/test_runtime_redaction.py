"""Runtime transport settings must not corrupt checkpoints or bypass secret redaction."""
import unittest
from unittest.mock import patch
from engine import execution, sandbox, verify


class RuntimeRedactionTests(unittest.TestCase):
    def test_private_ip_routing_flag_preserves_source_and_review_receipts(self):
        with patch.dict('os.environ', {'CODEX_EXEC_SERVER_PROXY_PRIVATE_IPS_VIA_UPSTREAM': 'true'}):
            source = {'app.py': 'enabled = True\n', '.npmrc': 'ignore-scripts=true\n'}
            self.assertEqual(execution.sanitized(source), source)
            record = verify.review_record([])
            self.assertEqual(sandbox.redact(record), record)
            self.assertEqual(verify.open_problems({'body': execution.sanitized(record)}), [])

    def test_real_secrets_still_redact_even_when_equal_to_flag_value(self):
        with patch.dict('os.environ', {'CODEX_EXEC_SERVER_PROXY_PRIVATE_IPS_VIA_UPSTREAM': 'true',
                                      'PRIVATE_KEY': 'fixture-private-key', 'API_TOKEN': 'true'}):
            for redact in (sandbox.redact, execution.clean):
                result = redact('true fixture-private-key')
                self.assertNotIn('true', result)
                self.assertNotIn('fixture-private-key', result)

    def test_transport_variable_with_non_boolean_value_still_redacts(self):
        with patch.dict('os.environ', {'CODEX_EXEC_SERVER_PROXY_PRIVATE_IPS_VIA_UPSTREAM': 'unexpected-private-value'}):
            for redact in (sandbox.redact, execution.clean):
                self.assertNotIn('unexpected-private-value', redact('unexpected-private-value'))

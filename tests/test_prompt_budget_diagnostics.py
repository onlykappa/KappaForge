import contextlib
import copy
import io
import json
import unittest
from unittest.mock import patch
from engine import gateway, runner, task_state


class PromptBudgetDiagnosticsTests(unittest.TestCase):
    def capture_rejection(self, prompt):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(gateway.GatewayRequestTooLarge) as error:
            gateway.require_prompt_fits(prompt)
        return json.loads(output.getvalue().split('KAPPA_PROMPT_BUDGET ', 1)[1]), str(error.exception)

    def test_exact_boundary_and_private_content_never_logged(self):
        with patch.object(task_state, 'add_to_prompt', side_effect=lambda p, j: p), \
                patch.object(gateway, 'resource_ceiling', return_value=None):
            self.assertTrue(gateway.prompt_fits('x' * 20000))
            private = 'PRIVATE_SOURCE_' + 'x' * (20001 - len('PRIVATE_SOURCE_'))
            log, error = self.capture_rejection(private)
        self.assertEqual(log['promptChars'], 20001)
        self.assertEqual(log['promptCharCap'], 20000)
        self.assertEqual(log['failedChecks'], ['promptChars'])
        self.assertFalse(log['sent'])
        self.assertIn('20001/20000', error)
        self.assertNotIn('PRIVATE_SOURCE', json.dumps(log) + error)

    def test_unicode_byte_failure_is_distinct_from_character_failure(self):
        providers = copy.deepcopy(runner.PROVIDERS)
        providers['routing']['defaults']['maxRequestBytes'] = 4100
        with patch.object(runner, 'PROVIDERS', providers), \
                patch.object(task_state, 'add_to_prompt', side_effect=lambda p, j: p), \
                patch.object(gateway, 'resource_ceiling', return_value=None):
            log, _ = self.capture_rejection('😀' * 5)
        self.assertEqual(log['promptChars'], 10)
        self.assertEqual(log['promptJsonBytes'], 62)
        self.assertEqual(log['failedChecks'], ['requestBytes'])

    def test_task_envelope_and_learned_cap_are_measured(self):
        with patch.object(task_state, 'add_to_prompt', side_effect=lambda p, j: p + 'state'), \
                patch.object(gateway, 'resource_ceiling', return_value=1000):
            log, error = self.capture_rejection('x' * 996)
        self.assertEqual(log['promptChars'], 1001)
        self.assertEqual(log['resourceCharCap'], 1000)
        self.assertIn('1001/1000', error)

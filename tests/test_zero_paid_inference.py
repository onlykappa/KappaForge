"""Owner resource rules: free routes only, a clear owner notice when free capacity runs out, and output limits that
respect each route's own cap."""
import json
import os
import re
import unittest
from unittest.mock import patch

from engine import developer, gateway, intent_guard, recovery, runner
from engine.reliability import ProviderRoutesUnavailable
from test_recovery_journal import GitHub


class FreeCapacityExhaustionTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.handle = recovery.CURRENT.set(self.journal)
        self.journal.begin()
        self.journal.checkpoint('b' * 40)
        self.addCleanup(recovery.CURRENT.reset, self.handle)
        self.addCleanup(intent_guard.ACTIVE.set, None)
        self.notified = []
        patcher = patch.object(runner, 'notify', side_effect=self.notified.append)
        patcher.start()
        self.addCleanup(patcher.stop)

    def progress(self):
        return [row['body'] for row in self.world.rows if row['body'].startswith('### KappaForge is working on it')]

    def test_exhausted_free_routes_notify_the_owner_once_with_the_retry_time(self):
        retry_at = self.world.now + 900
        error = ProviderRoutesUnavailable('Approved Gemini routes unavailable: groq HTTP 429, ollama HTTP 429', retry_at=retry_at)
        self.assertTrue(self.journal.defer(error))
        self.assertGreaterEqual(self.journal.state['nextAt'], retry_at + 5, 'no blind retry before the provider retry time')
        self.assertLessEqual(self.journal.state['nextAt'], retry_at + 5, 'and no idle time after it')
        body = self.progress()[-1]
        self.assertIn('Free model capacity is exhausted', body)
        self.assertIn('No paid model was used', body)
        self.assertRegex(body, r'Next automatic retry: \d{4}-\d\d-\d\d \d\d:\d\d UTC')
        self.assertEqual(len(self.notified), 1)
        self.assertIn('#' + str(self.journal.scope.number), self.notified[0])
        self.assertIn('No paid model was used', self.notified[0])
        # A later scan in the same waiting episode does not notify again.
        self.journal.defer(ProviderRoutesUnavailable('still exhausted', retry_at=retry_at + 600))
        self.assertEqual(len(self.notified), 1)

    def test_a_stopped_wait_says_retries_have_stopped(self):
        error = ProviderRoutesUnavailable('Approved Gemini routes unavailable: all free routes HTTP 429',
                                          retry_at=self.world.now + 10 ** 7)
        self.assertFalse(self.journal.defer(error))
        self.assertEqual(len(self.notified), 1)
        self.assertIn('Automatic retries have stopped', self.notified[0])
        self.assertIn('Free model capacity is exhausted', self.progress()[-1])

    def test_ordinary_failures_do_not_claim_capacity_exhaustion(self):
        self.journal.defer(RuntimeError('Edit text must match exactly once (matched 0 times)'))
        self.assertEqual(self.notified, [])
        self.assertFalse(any('capacity is exhausted' in body for body in self.progress()))


class CodingOutputCeilingTests(unittest.TestCase):
    def payload_for(self, max_output_tokens, pinned=None):
        sent = []

        class Reply:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, *a): return json.dumps({'route': 'groq:x', 'text': 'ok'}).encode()

        def urlopen(request, timeout):
            sent.append(json.loads(request.data.decode()))
            return Reply()
        env = {'KAPPA_ROUTER_URL': 'https://router.example', 'KAPPA_ROUTER_TOKEN': 't' * 40, 'KAPPA_ROUTER_REQUIRED': 'true'}
        handle = recovery.CURRENT.set(None)
        try:
            with patch.dict(os.environ, env), patch.object(runner.urllib.request, 'urlopen', side_effect=urlopen):
                runner.run_integrated_router('prompt', max_output_tokens, ['groq'])
        finally:
            recovery.CURRENT.reset(handle)
        return sent[0]

    def test_the_gateway_ask_is_clamped_to_the_16k_coding_ceiling(self):
        self.assertEqual(runner.coding_output_ceiling(), 16384)
        self.assertEqual(self.payload_for(65536)['maxTokens'], 16384, 'large generation budgets ask for 16K, not 8K')
        self.assertEqual(self.payload_for(3500)['maxTokens'], 3500, 'smaller asks are unchanged')
        self.assertNotIn('premium', self.payload_for(65536))

    def test_pinned_routes_keep_their_768_token_limit(self):
        self.assertEqual(gateway.PINNED_OUTPUT_TOKENS, 768)
        from pathlib import Path
        source = Path(runner.__file__).read_text()
        self.assertRegex(source, r'max_output_tokens = min\(max_output_tokens, gateway\.PINNED_OUTPUT_TOKENS\)')

    def test_the_prompt_budget_enforces_the_engine_request_cap(self):
        limits = runner.PROVIDERS['routing']['defaults']
        self.assertEqual(limits['maxOutputTokens'], 8192)
        self.assertTrue(gateway.prompt_fits('x' * 20000))
        self.assertFalse(gateway.prompt_fits('x' * 20001))
        self.assertFalse(gateway.prompt_fits('x' * 80000))


class PaidInferenceSwitchTests(unittest.TestCase):
    def test_the_engine_has_no_paid_inference_switch_turned_on(self):
        self.assertFalse(developer.PAID_INFERENCE_ALLOWED)
        self.assertFalse(developer.premium_possible('proposal'))


if __name__ == '__main__':
    unittest.main()

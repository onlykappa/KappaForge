import json
import os
import unittest
from unittest.mock import patch
from engine import developer, gateway, recovery, runner, verify


class GatewayRequestBudgetTests(unittest.TestCase):
    def test_runner_posts_complete_fitting_prompt_within_shared_byte_limit(self):
        prompt = 'Exact task and code\n' + '😀' * 8000 + '\nFINAL REQUIREMENT'
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self): return b'{"route":"groq:openai/gpt-oss-120b","text":"fixture"}'
        with patch.dict(os.environ, {'KAPPA_ROUTER_URL': 'https://fixture.example', 'KAPPA_ROUTER_TOKEN': 'r' * 40}), \
                patch.object(runner.urllib.request, 'urlopen', return_value=Response()) as network:
            runner.run_integrated_router(prompt, 8192, ['groq'])
        request = network.call_args.args[0]
        self.assertLessEqual(len(request.data), runner.PROVIDERS['routing']['defaults']['maxRequestBytes'])
        self.assertEqual(json.loads(request.data)['messages'][0]['content'], prompt)

    def test_task_169_sized_source_context_fits_without_dropping_the_task_tail(self):
        task = 'Implement approved weather behavior.\n' + 'x' * 19800 + '\nFINAL: preserve manual entry and authorization.'
        sources = {'large.js': '// source evidence\n' * 19000, 'app.py': 'value = 1\n'}
        existing = {path: len(text) for path, text in sources.items()}
        proposal = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', return_value=('fixture', proposal)) as model:
            _, _, changes, _ = developer.generate('fixture', task, developer.ROOT, sources, existing, guide='EXACT GUIDE\n' * 500)
        prompt = model.call_args.args[1]
        self.assertTrue(gateway.prompt_fits(prompt))
        self.assertIn(task, prompt)
        self.assertIn('EXACT GUIDE\n' * 500, prompt)
        self.assertIn('showing relevant excerpts', prompt)
        self.assertEqual(changes['app.py'], 'value = 2\n')

    def test_review_selects_bounded_source_without_claiming_missing_evidence(self):
        task = 'Keep the complete task: ' + 'x' * 19900 + ' TAIL REQUIREMENT'
        sources = {'app.py': 'value = 1\n', 'large.py': '# source evidence\n' * 20000}
        verdict = json.dumps({'requirements': [{'text': 'Change value', 'met': True, 'evidence': {'path': 'app.py', 'quote': 'value = 2'}}], 'problems': [], 'files_needed': [], 'files_to_inspect': []})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', return_value=('fixture', verdict)) as model:
            result = verify.model_review(model, 'fixture', task, sources.get, {'app.py': 'value = 2\n'}, list(sources))
        self.assertIsNotNone(result)
        self.assertTrue(gateway.prompt_fits(model.call_args.args[1]))
        self.assertIn(task, model.call_args.args[1])

    def test_oversized_and_unicode_serialized_requests_stop_before_network(self):
        for prompt in ('x' * 357645, '😀' * 40000):
            with patch.dict(os.environ, {'KAPPA_ROUTER_URL': 'https://fixture.example', 'KAPPA_ROUTER_TOKEN': 'r' * 40}), \
                    patch.object(runner.urllib.request, 'urlopen') as network:
                with self.assertRaises(gateway.GatewayRequestTooLarge) as error:
                    runner.run_integrated_router(prompt, 8192, ['groq'])
            network.assert_not_called()
            self.assertEqual(recovery.diagnose(error.exception), ('request_size', 'reduce_source_context'))

    def test_gateway_size_error_is_distinct_from_account_quota_and_provider_outage(self):
        error = gateway.error(413, {'code': 'request_too_large', 'failure': {'source': 'gateway_guard', 'category': 'context_limit', 'upstreamStatus': None}})
        self.assertIn('provider was not contacted', str(error))
        self.assertEqual(recovery.diagnose(error), ('request_size', 'reduce_source_context'))
        self.assertTrue(error.terminal)

import json
import os
import unittest
from unittest.mock import patch
from engine import developer, gateway, recovery, runner, verify


class GatewayRequestBudgetTests(unittest.TestCase):
    def test_diagnostic_above_old_cap_reaches_router_without_losing_owner_brief(self):
        from engine import task_state
        prompt = 'EXACT OWNER BRIEF\n' + 'source\n' * 5000 + 'FINAL SCOPE RESTRICTION'
        token = task_state.ROUTING_ROLE.set('diagnose')
        try:
            with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                    patch.object(runner, 'run_integrated_router', return_value=('fixture', 'answer')) as route:
                self.assertEqual(runner.run_model('key', prompt), ('fixture', 'answer'))
            self.assertEqual(route.call_args.args[0], prompt)
            self.assertGreater(len(prompt), 20872)
        finally:
            task_state.ROUTING_ROLE.reset(token)

    def test_engine_enforces_shared_transport_cap_before_any_route(self):
        self.assertTrue(gateway.prompt_fits('x' * gateway.engine_prompt_cap()))
        self.assertFalse(gateway.prompt_fits('x' * (gateway.engine_prompt_cap() + 1)))
        with patch.object(runner, '_run_model') as provider:
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                runner.run_model('key', 'x' * (gateway.engine_prompt_cap() + 1))
        provider.assert_not_called()

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

    def test_owner_brief_that_cannot_fit_hard_cap_stops_before_inference(self):
        task = 'Implement approved weather behavior.\n' + 'x' * gateway.engine_prompt_cap() + '\nFINAL: preserve manual entry and authorization.'
        sources = {'large.js': '// source evidence\n' * 19000, 'app.py': 'value = 1\n'}
        existing = {path: len(text) for path, text in sources.items()}
        proposal = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', return_value=('fixture', proposal)) as model:
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                developer.generate('fixture', task, developer.ROOT, sources, existing, guide='EXACT GUIDE\n' * 500)
        model.assert_not_called()

    def test_large_code_context_is_reduced_until_each_request_fits_cap(self):
        task = 'Change app.py value and preserve owner approval. Do not merge.'
        guide = ('SOURCE: KAPPA.md\\n1. Autonomous Development Authority\\nDo not merge or deploy.\\n'
                 '6. Owner-Controlled Merge Authorization\\nOnly the owner can merge.\\n'
                 '11. Security & Credential Management\\nNever expose credentials.\\n' + 'rule\\n' * 5000)
        source = 'value = 1\n' + '# source evidence\n' * 15000
        proposal = json.dumps({'files': [{'path': 'app.py', 'reason': 'Change the requested value',
            'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', return_value=('fixture', proposal)) as model:
            _, _, changes, _ = developer.generate_with('fixture', task, 'example/app', {'app.py': source},
                {'app.py': len(source)}, guide, None, developer.LARGE, max_attempts=1)
        prompts = [call.args[1] for call in model.call_args_list]
        self.assertTrue(prompts)
        self.assertTrue(all(len(prompt) <= gateway.engine_prompt_cap() for prompt in prompts))
        self.assertIn('Only the owner can merge', prompts[0])
        self.assertIn('showing relevant excerpts', prompts[0])
        self.assertEqual(changes['app.py'], source.replace('value = 1', 'value = 2', 1))

    def test_review_refuses_owner_brief_that_cannot_fit_hard_cap(self):
        task = 'Keep the complete task: ' + 'x' * gateway.engine_prompt_cap() + ' TAIL REQUIREMENT'
        sources = {'app.py': 'value = 1\n', 'large.py': '# source evidence\n' * 20000}
        verdict = json.dumps({'requirements': [{'text': 'Change value', 'met': True, 'evidence': {'path': 'app.py', 'quote': 'value = 2'}}], 'problems': [], 'files_needed': [], 'files_to_inspect': []})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', return_value=('fixture', verdict)) as model:
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                verify.model_review(model, 'fixture', task, sources.get, {'app.py': 'value = 2\n'}, list(sources))
        model.assert_not_called()

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


class RetryPromptBudgetTests(unittest.TestCase):
    def test_retry_diagnostics_reduce_source_context_without_losing_owner_limits(self):
        task = 'Change value in app.py. Do not merge. Final requirement: preserve cancellation authorization.'
        guide = 'EXACT OWNER PROJECT RULES'
        sources = {'app.py': 'value = 1\n', **{'module%d.py' % n: '# ' + 'x' * 350 + '\n' for n in range(24)}}
        existing = {path: len(text) for path, text in sources.items()}
        bad = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'missing anchor', 'replace': 'value = 2'}]}]})
        good = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.dict(runner.PROVIDERS['routing']['defaults'], {'maxPromptChars': 8200}), \
                patch.object(developer, 'run_model', side_effect=[('fixture', bad), ('fixture', good)]) as model:
            _, _, changes, _ = developer.generate_with('fixture', task, developer.ROOT, sources, existing, guide, None, developer.LARGE)
            prompts = [call.args[1] for call in model.call_args_list]
            for prompt in prompts:
                self.assertTrue(gateway.prompt_fits(prompt))
                self.assertIn(task, prompt)
                self.assertIn(guide, prompt)
        self.assertEqual(len(prompts), 2)
        self.assertLess(prompts[1].count('===== FILE'), prompts[0].count('===== FILE'))
        self.assertIn('===== FILE app.py', prompts[1])
        self.assertIn('AUTONOMOUS REPAIR', prompts[1])
        self.assertEqual(changes['app.py'], 'value = 2\n')

    def test_oversized_serialization_evidence_regenerates_instead_of_overflowing(self):
        task = 'Change value. Do not merge. FINAL OWNER REQUIREMENT'
        sources = {'app.py': 'value = 1\n'}
        existing = {'app.py': 10}
        bad = '{"files":[' + ' ' * 10000
        good = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.dict(runner.PROVIDERS['routing']['defaults'], {'maxPromptChars': 8000}), \
                patch.object(developer, 'run_model', side_effect=[('fixture', bad), ('fixture', good)]) as model:
            developer.generate_with('fixture', task, developer.ROOT, sources, existing, '', None, developer.LARGE)
            for call in model.call_args_list:
                self.assertTrue(gateway.prompt_fits(call.args[1]))
                self.assertIn(task, call.args[1])
        self.assertNotIn('UNTRUSTED PROPOSAL', model.call_args.args[1])
        self.assertIn('SOURCE FILES', model.call_args.args[1])

    def test_fitting_json_repair_preserves_full_owner_brief_and_project_rules(self):
        task = 'Change value. Do not merge. FINAL OWNER REQUIREMENT'
        sources = {'app.py': 'value = 1\n'}
        good = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(developer, 'run_model', side_effect=[('fixture', '{bad'), ('fixture', good)]) as model:
            developer.generate_with('fixture', task, developer.ROOT, sources, {'app.py': 10}, 'EXACT GUIDE', None, developer.LARGE)
        prompt = model.call_args.args[1]
        self.assertIn('Repair ONLY the JSON', prompt)
        self.assertIn(task, prompt)
        self.assertIn('EXACT GUIDE', prompt)

    def test_owner_brief_too_large_stops_before_inference_instead_of_truncating_it(self):
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.dict(runner.PROVIDERS['routing']['defaults'], {'maxPromptChars': 5000}), \
                patch.object(developer, 'run_model') as model:
            with self.assertRaises(gateway.GatewayRequestTooLarge):
                developer.generate_with('fixture', 'Implement ' + 'x' * 9000 + ' FINAL OWNER LIMIT', developer.ROOT,
                                        {}, {}, '', None, developer.LARGE)
        model.assert_not_called()


    def test_transport_size_guard_gets_bounded_source_reduction_in_the_same_scope(self):
        task = 'Change app.py value. Do not merge. Keep the complete brief.'
        sources = {'app.py': 'value = 1\n', **{'module%d.py' % n: '# ' + 'x' * 350 + '\n' for n in range(24)}}
        existing = {path: len(text) for path, text in sources.items()}
        good = json.dumps({'files': [{'path': 'app.py', 'edits': [{'find': 'value = 1', 'replace': 'value = 2'}]}]})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.dict(runner.PROVIDERS['routing']['defaults'], {'maxPromptChars': 8000}), \
                patch.object(developer, 'run_model', side_effect=[gateway.GatewayRequestTooLarge('stricter wire envelope'), ('fixture', good)]) as model:
            _, _, changes, _ = developer.generate_with('fixture', task, developer.ROOT, sources, existing, '', None, developer.LARGE)
        self.assertEqual(model.call_count, 2)
        self.assertIn(task, model.call_args.args[1])
        self.assertLess(model.call_args.args[1].count('===== FILE'), model.call_args_list[0].args[1].count('===== FILE'))
        self.assertEqual(changes['app.py'], 'value = 2\n')

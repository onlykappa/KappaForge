"""Confirmed no-dispatch admission failures can safely rebuild source context."""
import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch

from engine import developer, gateway, intent_guard, recovery, runner, task_goal


def refused():
    return dict(code='request_too_large',retryAt=9999999999999,
        failure=dict(source='gateway_guard',category='context_limit',attempted=False),
        attempts=[dict(provider='groq',model='openai/gpt-oss-120b',source='gateway_guard',
                       category='context_limit',attempted=False,status=413)])


class RemoteRequestSizeRecoveryTests(unittest.TestCase):
    def setUp(self):
        for var in (recovery.CURRENT,intent_guard.ACTIVE,task_goal.CURRENT):
            token=var.set(None);self.addCleanup(var.reset,token)

    def test_real_router_adapter_preserves_size_type_and_never_claims_capacity_wait(self):
        error=urllib.error.HTTPError('https://fixture.example/router/infer',413,'size',{},io.BytesIO(json.dumps(refused()).encode()))
        with patch.dict(os.environ,{'KAPPA_ROUTER_URL':'https://fixture.example','KAPPA_ROUTER_TOKEN':'r'*40}), \
                patch.object(runner.urllib.request,'urlopen',side_effect=error) as network:
            with self.assertRaises(gateway.GatewayRequestTooLarge) as raised:
                runner.run_integrated_router('Original owner scope',1024,['groq'])
        self.assertEqual(network.call_count,1)
        self.assertEqual(raised.exception.retry_at,0,'A no-dispatch refusal is not an account cooldown')
        self.assertEqual(raised.exception.status,413)
        self.assertEqual(raised.exception.attempts[0]['attempted'],False)
        self.assertEqual(recovery.diagnose(raised.exception),('request_size','reduce_source_context'))
        self.assertTrue(raised.exception.terminal,'Callers without a safe builder must stop')

    def test_generation_rebuilds_source_after_real_typed_admission_refusal(self):
        task='Change only app.py value to2. Preserve owner authorization and do not merge or deploy.'
        source='value = 1\n'+'# unrelated source context\n'*2200
        proposal=dict(summary='Change value',files=[dict(path='app.py',edits=[dict(find='value = 1',replace='value = 2')])])
        prompts=[]
        def model(_key,prompt,**_kwargs):
            prompts.append(prompt)
            if len(prompts)==1:raise gateway.error(413,refused())
            return 'scripted:free',json.dumps(proposal)
        budget=developer.LARGE._replace(context_chars=50000,file_chars=50000,output_tokens=1024)
        with patch.object(developer,'run_model',side_effect=model):
            result=developer.generate_with('fixture',task,developer.ROOT,{'app.py':source},{'app.py':len(source)},
                '',None,budget,max_attempts=3)
        self.assertEqual(len(prompts),2,'Rebuild inside the authorized operation instead of terminating')
        self.assertLess(len(prompts[1]),len(prompts[0]))
        self.assertTrue(all(task in p for p in prompts),'The exact owner task survives every size reduction')
        self.assertEqual(result[2],{'app.py':source.replace('value = 1','value = 2',1)})

    def test_review_builder_reduces_evidence_without_learning_platform_limit(self):
        resources=gateway.ReviewResources();prompts=[];task='EXACT OWNER SCOPE: no merges or paid calls.\n'
        def build():return task+'x'*(int(resources.ceiling or 30000)-len(task))
        def model(_key,prompt,**_options):
            prompts.append(prompt)
            if len(prompts)==1:raise gateway.error(413,refused())
            return 'scripted','verdict'
        with patch.object(gateway,'remember_resource_limit',side_effect=AssertionError('Not Cloudflare1102 evidence')):
            self.assertEqual(resources.call(model,'fixture',build),('scripted','verdict'))
        self.assertEqual([len(p) for p in prompts],[30000,20000])
        self.assertTrue(all(p.startswith(task) for p in prompts));self.assertEqual(resources.reductions,0)

    def test_permanent_size_refusal_has_three_adaptations_and_no_identical_requests(self):
        resources=gateway.ReviewResources();sizes=[]
        def model(_key,prompt,**_options):
            sizes.append(len(prompt));raise gateway.error(413,refused())
        with self.assertRaises(gateway.GatewayRequestTooLarge):
            resources.call(model,'fixture',lambda:'x'*int(resources.ceiling or 30000))
        self.assertEqual(len(sizes),4)
        self.assertTrue(all(a>b for a,b in zip(sizes,sizes[1:])))

    def test_unshrinkable_owner_scope_is_not_truncated_or_repeated_on_network(self):
        resources=gateway.ReviewResources();task='FULL OWNER SCOPE '+'x'*30000
        prompts=[]
        def model(_key,prompt,**_options):
            prompts.append(prompt);raise gateway.error(413,refused())
        with self.assertRaises(gateway.GatewayRequestTooLarge):resources.call(model,'fixture',lambda:task)
        self.assertEqual(prompts,[task])

    def test_mixed_or_upstream_lookalikes_cannot_claim_no_provider_was_contacted(self):
        for change in ('upstream','attempted','mixed','wrong_status'):
            data=refused();status=413
            if change=='upstream':data['failure'].update(source='upstream',upstreamStatus=413)
            if change=='attempted':data['failure']['attempted']=True
            if change=='mixed':data['attempts'].append(dict(attempted=True,source='upstream',category='rate_limit'))
            if change=='wrong_status':status=503
            error=gateway.error(status,data)
            self.assertIsInstance(error,gateway.GatewayUnavailable)
            self.assertNotIn('provider was not contacted',str(error))
            self.assertGreater(error.retry_at,0,'Real mixed-pool deadlines remain intact')

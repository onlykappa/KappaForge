"""Legacy account catalog expansion cannot authorize paid Python fallback requests."""
import json
import os
import unittest
from unittest.mock import MagicMock, patch
from engine import runner


class FreeCostBoundaryTests(unittest.TestCase):
    def test_catalog_flags_do_not_approve_paid_or_new_gemini_models(self):
        approved=runner.PROVIDERS['routing']['primary']['freeModels'][0]
        with patch.dict(os.environ,{'KAPPA_ALL_MODEL_PROVIDERS':'*,gemini,kilo,openrouter'}):
            for name in ('gemini','kilo','openrouter'):
                self.assertFalse(runner.full_catalog(name))
            self.assertEqual(runner.select_models({approved,'gemini-3-pro','gemini-99-pro'}),[approved])

    def test_malformed_pricing_is_not_free(self):
        for value in [None,{},[],{'prompt':False},{'prompt':True},{'prompt':''},{'prompt':' '},
                      {'prompt':float('nan')},{'prompt':float('inf')},{'prompt':-1},{'prompt':'0.01'}, {'prompt':10**1000}]:
            with self.subTest(value=repr(value)[:40]):self.assertFalse(runner.free_prices(value))
        self.assertTrue(runner.free_prices({'prompt':'0','completion':0}))

    def test_named_free_pool_opt_in_never_admits_paid_routes(self):
        reply=MagicMock();reply.__enter__.return_value=reply;reply.__exit__.return_value=False
        reply.read.return_value=json.dumps({'data':[
            {'id':'kilo-auto/free','pricing':{'prompt':'0','completion':'0'}},
            {'id':'vendor/paid-model','pricing':{'prompt':1,'completion':1}},
            {'id':'vendor/falsely:free','pricing':{'prompt':0,'completion':1}}]}).encode()
        with patch.dict(os.environ,{'KAPPA_ALL_MODEL_PROVIDERS':'kilo'}), \
                patch.object(runner,'provider_paused',return_value=False), \
                patch.object(runner.urllib.request,'urlopen',return_value=reply):
            self.assertEqual(runner.list_provider_models('kilo',runner.PROVIDERS['providers']['kilo']),['kilo-auto/free'])

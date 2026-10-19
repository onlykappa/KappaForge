"""Executable regressions for the five pre-merge PR #135 audit findings."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from engine import verify


class QualityGapTests(unittest.TestCase):
    def review(self, replies, sources=None, changes=None):
        replies = list(replies)
        sources = sources or {'app/consumer.js': 'consume(weather);'}
        def model(*args, **kwargs):
            return 'model', json.dumps(replies.pop(0))
        return verify.model_review(model, 'key', 'Use weather', lambda p: sources.get(p, ''),
                                   changes or {}, sources)

    def met(self, text='Use weather', path='app/consumer.js', quote='consume(weather);'):
        return {'text': text, 'met': True, 'evidence': {'path': path, 'quote': quote}}

    def test_missing_source_survives_an_unrelated_successful_followup(self):
        result = self.review([
            {'requirements': [{'text': 'Use weather', 'met': False}], 'problems': [],
             'files_to_inspect': ['app/consumer.js', 'app/missing.js']},
            {'requirements': [self.met()], 'problems': []},
        ])
        self.assertTrue(any('app/missing.js' in p for p in result[1]))

    def test_followup_cannot_drop_an_original_unmet_requirement(self):
        result = self.review([
            {'requirements': [{'text': 'Permission denial', 'met': False}], 'problems': [],
             'files_to_inspect': ['app/consumer.js']},
            {'requirements': [self.met()], 'problems': []},
        ])
        self.assertIn({'text': 'Permission denial', 'met': False}, result[0])
        self.assertTrue(any('disappeared' in p for p in result[1]))

    def test_met_requirement_requires_structured_nonempty_evidence(self):
        for evidence in (None, '', 'looks correct', {}, {'path': 'x', 'quote': '  '}):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                verify.parse_review(json.dumps({'requirements': [{'text': 'x', 'met': True, 'evidence': evidence}]}))

    def test_quote_must_match_candidate_not_old_source_or_unknown_path(self):
        for requirement in (self.met(quote='oldWeather();'), self.met(path='private/missing.js')):
            with self.subTest(requirement=requirement):
                result = self.review([{'requirements': [requirement], 'problems': []}],
                                     changes={'app/consumer.js': 'consume(weather);'})
                self.assertFalse(result[0][0]['met'])
                self.assertTrue(result[1])
        result = self.review([{'requirements': [self.met()], 'problems': []}],
                             sources={'app/consumer.js': 'oldWeather();'},
                             changes={'app/consumer.js': 'consume(weather);'})
        self.assertTrue(result[0][0]['met'])
        self.assertFalse(result[1])

    def binding_findings(self, test, production=None):
        production = production or {'preview/weather.mjs': 'export function location(){return 1;}'}
        return verify.test_binding_problems(lambda p: '', {**production, 'tests/fixture.test.mjs': test}, production)

    @unittest.skipUnless(shutil.which('node'), 'Node is required for executable import fixtures')
    def test_side_effect_import_is_not_a_function_binding_in_checker_or_node(self):
        for imported, passes in [("import './weather.mjs';", False),
                                 ("import {location} from './weather.mjs';", True)]:
            with self.subTest(imported=imported), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'weather.mjs').write_text('export function location(){return 1;}')
                (root / 'test.mjs').write_text(imported + '\nawait location();')
                result = subprocess.run(['node', str(root / 'test.mjs')], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode == 0, passes)
                findings = self.binding_findings(imported.replace('./weather.mjs', '../preview/weather.mjs') + '\nawait location();')
                self.assertEqual(not findings, passes)
                if not passes:
                    self.assertIn('ReferenceError', result.stderr)

    def test_reading_source_as_text_does_not_bind_its_functions(self):
        findings = self.binding_findings("const text=readFileSync('../preview/weather.mjs','utf8'); await location();")
        self.assertTrue(any('does not bind' in p for p in findings))

    def test_unrelated_named_import_cannot_prove_production_binding(self):
        findings = self.binding_findings("import {location} from '../preview/other.mjs'; await location();")
        self.assertTrue(findings)

    def test_reexported_named_binding_and_cjs_destructuring_work(self):
        production = {'preview/weather.mjs': 'export function location(){return 1;}',
                      'preview/bridge.mjs': "export {location} from './weather.mjs';"}
        self.assertFalse(self.binding_findings("import {location} from '../preview/bridge.mjs'; await location();", production))
        self.assertFalse(self.binding_findings("const {location}=require('../preview/weather.cjs'); location();",
                         {'preview/weather.cjs': 'function location(){return 1;} module.exports={location};'}))

    @unittest.skipUnless(shutil.which('node'), 'Node is required for executable VM fixtures')
    def test_valid_vm_fixture_is_not_an_assignment_in_the_host(self):
        fixtures = ["import vm from 'node:vm'; vm.runInNewContext('globalThis.navigator={geolocation:{}}');",
                    'import vm from "node:vm"; vm.runInNewContext(`globalThis.navigator={geolocation:{}}`);']
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                result = subprocess.run(['node', '--input-type=module', '-e', fixture], capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0)
                self.assertFalse(verify.test_binding_problems(lambda p: '', {'tests/vm.test.mjs': fixture}, []))
        direct = verify.test_binding_problems(lambda p: '', {'tests/direct.test.mjs': 'globalThis.navigator={};'}, [])
        self.assertTrue(any('getter-only' in p for p in direct))

    def body_findings(self, source):
        old = 'const raw=await request.text();\ninput=JSON.parse(raw);\n'
        return verify.worker_problems({verify.WORKER: old}, {verify.WORKER: source})

    def test_double_read_is_detected_in_both_orders(self):
        for source in ('const early=await request.json();\nconst raw=await request.text();',
                       'const raw=await request.text();\nconst later=await request.json();'):
            with self.subTest(source=source):
                self.assertTrue(any('read more than once' in p for p in self.body_findings(source)))

    def test_conditional_return_does_not_hide_a_fallthrough_double_read(self):
        source = 'if(route){const early=await request.json();if(ok){return response;}}\nconst raw=await request.text();'
        self.assertTrue(self.body_findings(source))
        unbraced = 'if(route){const early=await request.json();if(ok)return response;}\nconst raw=await request.text();'
        self.assertTrue(self.body_findings(unbraced))

    def test_early_returns_try_catch_exits_and_separate_functions_are_valid(self):
        valid = ['if(route){const early=await request.json();return response;}\nconst raw=await request.text();',
                 'if(route){const early=await request.json();try{return response;}catch(e){return error;}}\nconst raw=await request.text();',
                 'async function first(request){return await request.json();}\nasync function second(request){return await request.text();}']
        for source in valid:
            with self.subTest(source=source):
                self.assertFalse(self.body_findings(source))

    def test_nested_helper_does_not_hide_two_reads_in_outer_function(self):
        source = 'async function outer(request){const a=await request.json();async function helper(request){return await request.json();}const b=await request.text();}'
        self.assertTrue(self.body_findings(source))


if __name__ == '__main__':
    unittest.main()

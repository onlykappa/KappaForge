"""Deep-audit regressions against the real parser and real generation/review flow."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from engine import developer, verify
from engine.js_analysis import analyze


class ParserQualityTests(unittest.TestCase):
    def bindings(self, production, test):
        return verify.test_binding_problems(lambda p: '', {**production, 'tests/helper.test.mjs': test}, production)

    def test_incorrect_cjs_and_renamed_esm_exports_fail_both_parser_and_node(self):
        variants = [('cjs', 'function location(){return 1;} module.exports={other:location};',
                     "const {location}=require('./weather.cjs'); location();"),
                    ('mjs', 'function location(){return 1;} export {location as renamed};',
                     "import {location} from './weather.mjs'; location();")]
        for extension, source, test in variants:
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / ('weather.' + extension)).write_text(source)
                (root / ('test.' + extension)).write_text(test)
                result = subprocess.run(['node', str(root / ('test.' + extension))], capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                findings = self.bindings({'preview/weather.' + extension: source}, test.replace('./weather.', '../preview/weather.'))
                self.assertTrue(any('does not bind' in p for p in findings))

    def test_extensionless_require_and_exact_reexported_name_are_valid(self):
        production = {'preview/weather.cjs': 'function location(){return 1;} exports.location=location;'}
        self.assertFalse(self.bindings(production, "const {location}=require('../preview/weather'); location();"))
        production = {'preview/weather.mjs': 'function location(){return 1;} export {location as renamed};',
                      'preview/bridge.mjs': "export {renamed as location} from './weather.mjs';"}
        self.assertFalse(self.bindings(production, "import {location} from '../preview/bridge.mjs'; location();"))
        production['preview/bridge.mjs'] = "import {renamed as location} from './weather.mjs'; export {location};"
        self.assertFalse(self.bindings(production, "import {location} from '../preview/bridge.mjs'; location();"))

    def test_templates_and_regex_cannot_hide_executable_assignments(self):
        snippets = ['const value=`${globalThis.navigator={}}`;', 'const regex=/"/; globalThis.navigator={};']
        for source in snippets:
            with self.subTest(source=source):
                result = subprocess.run(['node', '--input-type=module', '-e', source], capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(self.bindings({}, source))
        self.assertFalse(self.bindings({}, 'const text="globalThis.navigator={}"; const regex=/globalThis.navigator=/;'))

    def test_mutually_exclusive_reads_and_return_expressions_are_valid(self):
        source = 'async function read(request,mode){if(mode){return await request.json();}else{return await request.text();}}'
        self.assertFalse(verify.repeated_body_read('', source))
        run = source + ';await read(new Request("https://example.test",{method:"POST",body:"{}"}),true);await read(new Request("https://example.test",{method:"POST",body:"{}"}),false);'
        result = subprocess.run(['node', '--input-type=module', '-e', run], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)

    def test_catch_retains_consumption_before_failed_json_parse(self):
        source = 'async function read(request){try{return await request.json();}catch{return await request.text();}}'
        self.assertTrue(verify.repeated_body_read('', source))
        result = subprocess.run(['node', '--input-type=module', '-e', source + ';await read(new Request("https://example.test",{method:"POST",body:"invalid"}));'], capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)

    def test_request_aliases_share_consumption_but_clones_do_not(self):
        self.assertTrue(verify.repeated_body_read('', 'const alias=request;await alias.json();await request.text();'))
        self.assertFalse(verify.repeated_body_read('', 'const clone=request.clone();await clone.json();await request.text();'))
        self.assertTrue(verify.repeated_body_read('', 'const clone=request.clone();await clone.json();await clone.text();'))

    def test_block_shadowing_does_not_leak_to_outer_request(self):
        source = 'async function read(request){{const request=new Request("https://example.test");await request.json();}await request.text();}'
        self.assertFalse(verify.repeated_body_read('', source))

    def test_real_worker_has_no_unavailable_or_new_body_read_finding(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / 'chat-backend/src/index.js').read_text()
        parsed = analyze(source)
        self.assertNotIn('bodyReadError', parsed)
        self.assertFalse(parsed['bodyReads'])

    def test_comment_and_fixture_quotes_are_not_executable_evidence(self):
        for source, quote in [('// TODO: consume(weather)', 'TODO: consume(weather)'),
                              ('const fixture="consume(weather)";', 'consume(weather)'),
                              ('const pattern=/consume(weather)/;', 'consume(weather)')]:
            with self.subTest(source=source):
                self.assertFalse(verify.executable_evidence('app.js', source, quote))
        self.assertTrue(verify.executable_evidence('app.js', 'consume(weather);', 'consume(weather)'))
        self.assertFalse(verify.executable_evidence('app.py', '# TODO: consume(weather)', 'consume(weather)'))

    def test_model_cannot_complete_requirement_using_a_todo_comment(self):
        reply = {'requirements': [{'text': 'Send weather into model', 'met': True,
                 'evidence': {'path': 'app.js', 'quote': 'TODO: consume(weather)'}}], 'problems': []}
        result = verify.model_review(lambda *a, **k: ('model', json.dumps(reply)), 'key', 'task',
                                     lambda p: '// TODO: consume(weather)', {}, ['app.js'])
        self.assertFalse(result[0][0]['met'])
        self.assertTrue(result[1])

    def test_pinned_parser_integrity(self):
        root = Path(__file__).resolve().parents[1] / 'engine/vendor/acorn'
        manifest = json.loads((root / 'manifest.json').read_text())
        self.assertEqual(hashlib.sha256((root / 'acorn.mjs').read_bytes()).hexdigest(), manifest['sha256'])
        self.assertIn('MIT', (root / 'LICENSE').read_text())

    def test_unicode_offsets_match_python_source_slices(self):
        source = 'const label="😀😀";\n// TODO consume(weather)\nglobalThis.navigator={};'
        parsed = analyze(source)
        self.assertEqual(source[parsed['navigatorWrites'][0]:][:10], 'globalThis')
        self.assertFalse(verify.executable_evidence('app.js', source, 'TODO consume(weather)'))
        self.assertTrue(verify.executable_evidence('app.js', source, 'globalThis.navigator={}'))


class RepairLedgerTests(unittest.TestCase):
    class Progress:
        def now(self, *a, **k): pass
        def ok(self, *a, **k): pass

    def test_unmet_requirement_cannot_disappear_between_repair_rounds(self):
        root = 'onlykappa/KappaForge'
        base = 'export const units="F";'
        pending = ([{'text': 'Handle permission denial', 'met': False}], [], [])
        incomplete = ([{'text': 'Use Fahrenheit', 'met': True}], [], [])
        developer.UNFINISHED.clear()
        with patch.object(verify, 'wiring_problems', side_effect=lambda *a: []), \
                patch.object(verify, 'model_review', side_effect=[pending] + [incomplete] * developer.MAX_CHECK_ROUNDS) as review, \
                patch.object(developer, 'generate', return_value=('model', '', {}, '')):
            _, _, problems = developer.check_the_work('key', 'Handle denial and use Fahrenheit', root, 'sha', 'token',
                                                      {'app.js': base}, {'app.js': len(base)},
                                                      {'app.js': base + '\nexport const wind=1;'}, '', None, '', False, self.Progress())
        self.assertTrue(any('Handle permission denial' in p for p in problems))
        self.assertIn('Handle permission denial', review.call_args.args[2])

    def test_protected_path_stops_the_real_generation_loop_after_one_call(self):
        proposal = json.dumps({'files': [{'path': '.git/config', 'content': 'x'}]})
        with patch.object(developer, 'run_model', return_value=('model', proposal)) as model:
            with self.assertRaisesRegex(ValueError, 'Protected path'):
                developer.generate_with('key', 'task', 'onlykappa/KappaForge', {}, {}, '', None, developer.SMALL)
        model.assert_called_once()


if __name__ == '__main__':
    unittest.main()

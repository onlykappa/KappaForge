import json
import unittest
from unittest.mock import patch

from engine import developer, verify

ROOT = "onlykappa/KappaForge"
WORKER = 'const raw = await request.text();\ninput = JSON.parse(raw);\nif (!["/authorize", "/chat", "/plan"].includes(new URL(request.url).pathname)) return;\n'
CORE = "const defaults={routing:'balanced',appearance:'dark',autoStart:true};"


class WiringChecks(unittest.TestCase):
    """The mistakes that made PR #117 pass its tests yet not work are found before a PR opens."""

    def problems(self, changes, sources=None):
        sources = sources or {"chat-backend/src/index.js": WORKER, "preview/core.js": CORE, "preview/app-main.js": "// app\n"}
        return verify.wiring_problems(ROOT, ROOT, lambda p: sources.get(p, ""), sources, changes, list(sources))

    def test_pr_117_problems_are_all_found(self):
        found = self.problems({
            "chat-backend/src/index.js": WORKER + 'if (executionPath === "/weather") { const {lat} = await request.json(); }\n',
            "preview/app-main.js": "// app\nif(ask){await navigator.geolocation.getCurrentPosition(()=>{preferences.locationGranted=true})}\n",
            "tests/weather.test.mjs": "import test from 'node:test';\nconst mock={fetchWeather:async()=>({temperature:72})};\ntest('x',async()=>{await mock.fetchWeather()});\n",
        })
        text = "\n".join(found)
        self.assertIn('"/weather" is not in the allowed path list', text)
        self.assertIn("second request.json()", text)
        self.assertIn("preferences.locationGranted is not in preview/core.js", text)
        self.assertIn('Nothing in the app (preview/) calls the new Worker route "/weather"', text)
        self.assertIn("tests/weather.test.mjs tests only code written inside the test file", text)
        self.assertIn("getCurrentPosition takes callbacks", text)

    def test_a_wired_change_with_a_real_test_passes(self):
        found = self.problems({
            "chat-backend/src/index.js": WORKER.replace('"/plan"]', '"/plan", "/weather"]') + 'if (executionPath === "/weather") { const lat = input.lat; }\n',
            "preview/app-main.js": "// app\nasync function weather(){return fetch(backend+'/weather')}\nweather();\n",
            "preview/core.js": "const defaults={routing:'balanced',appearance:'dark',autoStart:true,weatherUnits:'F'};",
            "preview/settings.js": "x+=ss('weatherUnits','Units',[]);",
            "tests/weather.test.mjs": "import '../preview/app-main.js';\n",
        })
        self.assertEqual(found, [])

    def test_tests_loading_source_from_the_repository_root_count_as_real(self):
        changes = {"tests/a.test.mjs": "const s=readFileSync(resolve(root,'preview/app-main.js'),'utf8');",
                   "tests/b.cjs": "const root=resolve(__dirname,'../preview');",
                   "tests/test_c.py": "from engine import verify\n"}
        self.assertEqual(verify.tests_without_real_code(changes, ["preview/app-main.js", "engine/verify.py"]), [])

    def test_other_repositories_get_only_the_general_checks(self):
        changes = {"chat-backend/src/index.js": 'if (pathname === "/x") {}', "tests/t.test.mjs": "const a=1;"}
        found = verify.wiring_problems("onlykappa/Other", ROOT, lambda p: "", {}, changes, [])
        self.assertEqual(len(found), 1)
        self.assertIn("tests only code written inside the test file", found[0])


class CheckTheWork(unittest.TestCase):
    """Problems go back to the model; what it can't fix is reported, never presented as done."""

    class Progress:
        def __init__(self):
            self.lines = []

        def now(self, text, phase=False):
            self.lines.append(("now", text))

        def ok(self, text, phase=False, status=None, warn=False):
            self.lines.append((status or ("warn" if warn else "ok"), text))

    def run_check(self, reviews, fixes):
        reviews, fixes, prompts = list(reviews), list(fixes), []

        def model(api_key, prompt, max_output_tokens=0, allowed=None, json_mode=False):
            review = reviews.pop(0)
            for requirement in review.get('requirements', []):
                if requirement.get('met'):
                    requirement['evidence'] = {'path': 'preview/app-main.js', 'quote': 'function show(){}'}
            return "gemini", json.dumps(review)

        def generate(api_key, task, repo, sources, existing, guide, allowed, design, require_test):
            prompts.append((task, dict(sources)))
            return "gemini", "", fixes.pop(0), ""

        progress = self.Progress()
        developer.UNFINISHED.clear()
        sources = {"preview/app-main.js": "// app\n"}
        with patch.object(developer, "run_model", model), patch.object(developer, "generate", generate), \
                patch.object(developer, "read_source", lambda repo, path, sha, token: "const defaults={a:1};" if path == "preview/core.js" else ""):
            result = developer.check_the_work("key", "Add weather. Save the units setting.", ROOT, "sha", "tok", sources,
                                              {"preview/app-main.js": 7, "preview/core.js": 20}, {"preview/app-main.js": "// app\nshow();\nfunction show(){}\n"},
                                              "", None, "", False, progress)
        return result, prompts, progress

    def test_a_failed_requirement_is_fixed_then_rechecked(self):
        unmet = {"requirements": [{"text": "Save the units setting", "met": False, "evidence": "not saved"}], "problems": [],
                 "files_needed": ["preview/core.js"]}
        met = {"requirements": [{"text": "Add weather", "met": True}, {"text": "Save the units setting", "met": True}], "problems": []}
        (changes, verdict, problems), prompts, progress = self.run_check([unmet, met], [{"preview/core.js": "const defaults={a:1,units:'F'};"}])
        self.assertEqual(problems, [])
        self.assertIn("preview/core.js", changes)
        self.assertIn("Requirement not met: Save the units setting", prompts[0][0])
        self.assertIn("preview/core.js", prompts[0][1], "the fix sees the file the review said it needs")
        self.assertIn("Checked against the task: 2 of 2 requirements met.", verdict)
        self.assertIn(("ok", "Checked the work against the task: all 2 requirements met"), progress.lines)

    def test_problems_that_stay_are_reported_not_hidden(self):
        unmet = {"requirements": [{"text": "Use real weather in replies", "met": False}], "problems": ["/weather is never called"]}
        rounds = developer.MAX_CHECK_ROUNDS
        (changes, verdict, problems), prompts, progress = self.run_check([unmet] * (rounds + 1), [{}] * rounds)
        self.assertEqual(len(prompts), developer.MAX_CHECK_ROUNDS)
        self.assertTrue(problems)
        self.assertIn("- Not done: Use real weather in replies", verdict)
        self.assertIn("- Problem: /weather is never called", verdict)
        self.assertEqual(progress.lines[-1][0], "blocked")

    def test_a_rejected_repair_does_not_abandon_the_remaining_rounds(self):
        pending = ([{"text": "Use the weather", "met": False}], ["consumer missing"], [])
        complete = ([{"text": "Use the weather", "met": True}], [], [])
        sources = {'app/main.js': 'export function weather(){return 1;}'}
        changes = {'app/main.js': 'export function weather(){return 2;}'}
        repaired = {'app/main.js': 'export function weather(){return 3;}'}
        progress = self.Progress()
        developer.UNFINISHED.clear()
        with patch.object(verify, 'wiring_problems', return_value=[]), \
                patch.object(verify, 'model_review', side_effect=[pending, pending, complete]), \
                patch.object(developer, 'generate', side_effect=[ValueError('Edit text matched 0 times'),
                                                                 ('model', '', repaired, '')]) as generate:
            final, _, problems = developer.check_the_work('k', 'task', ROOT, 'sha', 'token', sources,
                                                           {p: len(t) for p, t in sources.items()}, changes,
                                                           '', None, '', False, progress)
        self.assertEqual(problems, [])
        self.assertEqual(final, repaired)
        self.assertEqual(generate.call_count, 2)
        self.assertIn('Edit text matched 0 times', generate.call_args.args[1])

    def test_repair_reuses_existing_candidate_tests_but_requires_initial_coverage(self):
        for with_tests in (False, True):
            with self.subTest(with_tests=with_tests):
                changes = {'app/main.js': 'export function x(){return 2;}'}
                if with_tests:
                    changes['tests/x.test.mjs'] = "import '../app/main.js';"
                progress = self.Progress()
                developer.UNFINISHED.clear()
                with patch.object(verify, 'wiring_problems', side_effect=lambda *a: []), \
                        patch.object(verify, 'model_review', side_effect=[([], ['fix consumer'], []),
                                                                         ([{'text': 'x', 'met': True}], [], [])]), \
                        patch.object(developer, 'generate', return_value=('model', '',
                                     {} if with_tests else {'tests/x.test.mjs': "import '../app/main.js';"}, '')) as generate:
                    developer.check_the_work('k', 'task', ROOT, 'sha', 'token', {}, {}, changes,
                                             '', None, '', True, progress)
                self.assertEqual(generate.call_args_list[0].args[-1], not with_tests)

    def test_security_rejection_does_not_gain_more_repair_rounds(self):
        developer.UNFINISHED.clear()
        with patch.object(verify, 'wiring_problems', side_effect=lambda *a: []), \
                patch.object(verify, 'model_review', return_value=([{'text': 'x', 'met': False}], [], [])), \
                patch.object(developer, 'generate', side_effect=ValueError('Unsafe path: ../escape')) as generate:
            _, _, problems = developer.check_the_work('k', 'task', ROOT, 'sha', 'token', {}, {}, {},
                                                      '', None, '', False, self.Progress())
        generate.assert_called_once()
        self.assertTrue(problems)


class DeliveryQualityRegressions(unittest.TestCase):
    def test_permission_test_cannot_hide_behind_an_unrelated_worker_import(self):
        old = {'preview/app-main.js': '// app', 'tests/intelligence.test.mjs': "import worker from '../chat-backend/src/index.js';"}
        changes = {'preview/app-main.js': 'async function getWeatherLocation(){return navigator.geolocation;}',
                   'tests/intelligence.test.mjs': old['tests/intelligence.test.mjs']
                   + '\nglobalThis.navigator={};\nawait getWeatherLocation();'}
        found = verify.test_binding_problems(lambda p: old.get(p, ''), changes, set(old) | {'chat-backend/src/index.js'})
        self.assertTrue(any('getter-only' in p for p in found))
        self.assertTrue(any('does not bind it from its production module' in p for p in found))

    def test_real_helper_imports_and_vm_source_fixtures_are_accepted(self):
        production = {'preview/weather.js': 'export async function location(){return 1;}'}
        fixtures = ["import {location} from '../preview/weather.js'; await location();",
                    "const source=readFileSync(resolve(root,'preview/weather.js'),'utf8'); vm.runInContext(source,context); await context.location();"]
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                self.assertEqual(verify.test_binding_problems(lambda p: '',
                                 {**production, 'tests/weather.test.mjs': fixture}, production), [])

    def test_transitive_import_is_loaded_and_rhs_call_is_not_a_definition(self):
        old = {'preview/bridge.js': "export {location} from './weather.js';"}
        production = {'preview/weather.js': 'export function location(){return 1;}'}
        for imported, expected in [("../preview/bridge.js", False), ("../preview/other.js", True)]:
            test = f"import {{location}} from '{imported}';\nconst result=await location();"
            found = verify.test_binding_problems(lambda p: old.get(p, ''),
                                                 {**production, 'tests/x.test.mjs': test}, set(old) | set(production))
            self.assertEqual(bool(found), expected)

    def test_early_route_body_read_is_not_falsely_reported_as_a_second_read(self):
        route = 'if(pathname === "/weather"){const body=await request.json();return response(body);}\n'
        new = route + WORKER.replace('"/plan"]', '"/plan", "/weather"]')
        self.assertFalse(any('second request.json()' in p for p in verify.worker_problems({verify.WORKER: WORKER}, {verify.WORKER: new})))
        self.assertTrue(any('second request.json()' in p for p in verify.worker_problems({verify.WORKER: WORKER},
                                                                                     {verify.WORKER: WORKER + route})))

    def test_review_sees_current_globals_load_order_and_unchanged_dependencies(self):
        sources = {'preview/index.html': '<script src="settings.js"></script><script src="app-main.js"></script>',
                   'preview/settings.js': "let preferences={weatherUnits:'imperial'};",
                   'preview/app-state.js': 'let weatherPermissionState=null;',
                   'KAPPA.md': 'Classic scripts share globals in load order.',
                   'chat-backend/src/index.js': "import {consume} from './consumer.js'; consume(input.weather);",
                   'chat-backend/src/consumer.js': 'export function consume(data){return data;}'}
        changes = {'preview/app-main.js': 'show(preferences.weatherUnits);',
                   'chat-backend/src/index.js': sources['chat-backend/src/index.js']}
        text, _ = verify.review_sources(lambda p: sources.get(p, ''), changes, set(sources) | set(changes))
        for value in sources.values():
            self.assertIn(value, text)
        self.assertIn('CURRENT SOURCE preview/settings.js (COMPLETE)', text)

    def test_review_context_is_bounded_and_labels_missing_evidence(self):
        changes = {'app/a.js': 'x' * 120000, 'app/b.js': 'y' * 120000}
        text, _ = verify.review_sources(lambda p: '', changes, changes, limit=3000)
        self.assertLessEqual(len(text), 3200)
        self.assertIn('PARTIAL:', text)
        self.assertIn('request this file', text)

    def test_reviewer_can_inspect_a_missing_file_before_making_its_verdict(self):
        replies = [json.dumps({'requirements': [{'text': 'weather', 'met': False}], 'problems': [],
                               'files_to_inspect': ['ios/Bridge.swift']}),
                   json.dumps({'requirements': [{'text': 'weather', 'met': True,
                               'evidence': {'path': 'ios/Bridge.swift', 'quote': 'func promptBridge() {}'}}],
                               'problems': [], 'files_to_inspect': []})]
        prompts = []
        def model(key, prompt, **kwargs):
            prompts.append(prompt)
            return 'model', replies.pop(0)
        sources = {'ios/Bridge.swift': 'func promptBridge() {}'}
        result = verify.model_review(model, 'key', 'weather', lambda p: sources.get(p, ''),
                                     {'preview/app-main.js': 'prompt()'}, set(sources) | {'preview/app-main.js'})
        self.assertEqual(result[1], [])
        self.assertEqual(len(prompts), 2)
        self.assertIn('func promptBridge()', prompts[1])

    def test_unresolved_evidence_and_malformed_review_cannot_pass(self):
        def model(key, prompt, **kwargs):
            return 'model', json.dumps({'requirements': [{'text': 'weather', 'met': False}],
                                        'problems': [], 'files_to_inspect': ['app/unknown.js']})
        result = verify.model_review(model, 'key', 'task', lambda p: '', {}, ['app/unknown.js'])
        self.assertTrue(result[1])
        with self.assertRaises(ValueError):
            verify.parse_review('{"requirements":[],"problems":"not a list"}')

    def test_followup_expands_a_partial_new_file_and_uses_the_candidate(self):
        changes = {'app/new.js': 'a' * 95000 + '\nconsumer(weather);'}
        context, _ = verify.review_sources(lambda p: 'obsolete', changes, [], limit=110000)
        self.assertNotIn('consumer(weather)', context)
        expanded, _ = verify.review_sources(lambda p: 'obsolete', changes, [], ['app/new.js'], limit=110000)
        self.assertIn('consumer(weather)', expanded)
        self.assertNotIn('obsolete', expanded)
        self.assertIn('(COMPLETE)', expanded)
        calls = []
        def model(key, prompt, **kwargs):
            calls.append(prompt)
            return 'model', json.dumps({'requirements': [{'text': 'consume', 'met': len(calls) == 2,
                                       'evidence': {'path': 'app/new.js', 'quote': 'consumer(weather);'}}],
                                       'problems': [], 'files_to_inspect': ['app/new.js'] if len(calls) == 1 else []})
        verdict = verify.model_review(model, 'key', 'task', lambda p: '', changes, [])
        self.assertEqual(verdict[1], [])
        self.assertIn('consumer(weather)', calls[1])


class BoundedDocumentRecovery(unittest.TestCase):
    def test_complete_source_rerequest_does_not_consume_another_model_call(self):
        path, source = 'docs/integration/NOTE.md', '# Note\n- Cloud work\n'
        from unittest.mock import Mock
        model = Mock(return_value=('model', json.dumps({
            'requirements': [{'text': 'Add note', 'met': True, 'evidence': {'path': path, 'quote': '- Cloud work'}}],
            'problems': [], 'files_to_inspect': [path]})))
        result = verify.model_review(model, '', 'Add note', lambda p: '', {path: source}, [])
        self.assertEqual(result[1], [])
        model.assert_called_once()
        model.return_value = ('model', json.dumps({'requirements': [{'text': 'Missing bullet', 'met': False}],
                                                  'problems': ['Missing bullet'], 'files_to_inspect': [path]}))
        result = verify.model_review(model, '', 'task', lambda p: '', {path: source}, [])
        self.assertFalse(result[0][0]['met'])
        self.assertEqual(result[1], ['Missing bullet'])

    def test_self_review_can_correct_only_its_new_candidate_document(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from engine import recovery
        path = 'docs/integration/NOTE.md'
        scope = SimpleNamespace(edit_path=path, inference_route='groq:openai/gpt-oss-120b')
        journal = SimpleNamespace(scope=scope, issue={'title': 'Add note', 'body': 'Create only ' + path},
                                  state={'requirements': [], 'events': []}, requirements=Mock(),
                                  avoid_models=lambda key: set(), rejected=lambda signature: False, context='')
        handle = recovery.CURRENT.set(journal)
        developer.UNFINISHED.clear()
        try:
            pending = ([{'text': 'Correct bullet', 'met': False}], [], [])
            done = ([{'text': 'Correct bullet', 'met': True}], [], [])
            answer = json.dumps({'files': [{'path': path, 'content': '# Note\n- Correct bullet\n'}]})
            with patch.object(verify, 'wiring_problems', return_value=[]), \
                    patch.object(verify, 'model_review', side_effect=[pending, done]), \
                    patch.object(developer, 'run_model', return_value=('groq:openai/gpt-oss-120b', answer)) as model:
                final, _, problems = developer.check_the_work('', 'Add note', ROOT, 'sha', 'token', {}, {},
                    {path: '# Note\n'}, '', None, '', False, SimpleNamespace(now=Mock(), ok=Mock()))
            self.assertEqual(problems, [])
            self.assertEqual(final, {path: '# Note\n- Correct bullet\n'})
            model.assert_called_once()
            with patch.object(developer, 'run_model') as model:
                with self.assertRaises(PermissionError):
                    developer.generate('', 'task', ROOT, {path: '# Existing\n'}, {path: 11})
                model.assert_not_called()
        finally:
            recovery.CURRENT.reset(handle)


class AnchorHint(unittest.TestCase):
    """A find copied from a diff's removed line gets the real current text back (PR #121's fixes failed 5 times on it)."""

    def test_the_closest_real_lines_are_shown_exactly(self):
        sources = {"chat-backend/src/index.js": 'const a = 1;\n    if (request.method !== "POST" || !["/chat", "/weather"].includes(path))\n      return json({ error: "Not found" }, 404, cors);\n'}
        message = 'Edit text must match exactly once in chat-backend/src/index.js (matched 0 times):     if (request.method !== "POST" || !["/chat"].includes(path))'
        hint = developer.diagnose_generation_failure(message, sources)
        self.assertIn("never copy a line from a diff that starts with '-'", hint)
        self.assertIn('    if (request.method !== "POST" || !["/chat", "/weather"].includes(path))', hint)

    def test_no_hint_when_nothing_is_close(self):
        self.assertEqual(developer.closest_text("Edit text must match exactly once in a.js (matched 0 times): zzzz qqqq", {"a.js": "const x = 1;"}), "")


def response(data):
    from unittest.mock import MagicMock
    result = MagicMock()
    result.__enter__.return_value = result
    result.__exit__.return_value = False
    result.read.return_value = json.dumps(data).encode()
    return result


class JsonMode(unittest.TestCase):
    def setUp(self):
        from engine import runner
        runner._lists.clear()
        runner.EXHAUSTED.clear()

    def test_gemini_is_asked_for_json_when_the_caller_needs_it(self):
        from engine import runner
        sent = []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]}]})
            sent.append(json.loads(req.data)["generationConfig"])
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "{}"}]}}]})
        with patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            runner.run_model("key", "p", json_mode=True, allowed=set())  # Gemini only; free providers come first otherwise.
            runner.run_model("key", "p", allowed=set())
        self.assertEqual(sent[0].get("responseMimeType"), "application/json")
        self.assertNotIn("responseMimeType", sent[1])


class HonestVerdict(unittest.TestCase):
    """PR #121 said "2 of 2 requirements met" above an open problem; the headline now says Not finished."""

    def test_open_problems_lead_the_verdict(self):
        text = verify.report([{"text": "a", "met": True}, {"text": "b", "met": True}], ["/weather is never called"])
        self.assertTrue(text.startswith("Not finished: 1 problem still open."))
        self.assertNotIn("Checked against the task", text)

    def test_unmet_requirements_count_as_open(self):
        self.assertTrue(verify.report([{"text": "a", "met": False}], []).startswith("Not finished: 1 problem still open."))

    def test_a_clean_check_reads_as_met(self):
        self.assertEqual(verify.report([{"text": "a", "met": True}], []), "Checked against the task: 1 of 1 requirements met.")

    def test_the_review_lists_every_ask_separately(self):
        self.assertIn("one entry per distinct ask", verify.review_prompt("t", "", []))


class RemovedCode(unittest.TestCase):
    """PR #121 deleted the chat box's Enter-to-send listener and nothing noticed."""

    OLD = ('function send(){}\nfunction keep(){}\n'
           'input.addEventListener("keydown",e=>{if(e.key==="Enter")send()});\nbtn.addEventListener("click",send);\n')

    def found(self, new, task="Add weather"):
        return verify.removed_problems(lambda p: self.OLD, {"preview/app-main.js": new}, task)

    def test_a_deleted_listener_and_function_are_found(self):
        text = "\n".join(self.found('function send(){}\nbtn.addEventListener("click",send);\n'))
        self.assertIn('"keydown" event listener was removed', text)
        self.assertIn("existing function keep was removed", text)

    def test_edits_that_keep_everything_pass(self):
        self.assertEqual(self.found(self.OLD + "function weather(){}\n"), [])

    def test_removal_the_task_asks_for_is_allowed(self):
        self.assertEqual(self.found(self.OLD.replace("function keep(){}\n", ""), "Remove keep() now that it is unused"), [])

    def test_python_defs_are_checked_too(self):
        found = verify.removed_problems(lambda p: "def a():\n    pass\ndef b():\n    pass\n", {"engine/x.py": "def a():\n    pass\n"})
        self.assertEqual(len(found), 1)
        self.assertIn("function b was removed", found[0])


class PythonTestImports(unittest.TestCase):
    """A Python test counts as testing real code when it imports any repository module, not only engine/tools/scripts."""

    def accepted(self, statement, paths, test="tests/test_feature.py"):
        source = statement + "\n\n\ndef test_real():\n    assert True\n"
        return not verify.tests_without_real_code({test: source}, paths)

    def test_any_package_and_import_form_counts(self):
        for statement in ("from app.calc import add", "import app.calc", "import app.calc as calc", "from app import calc"):
            self.assertTrue(self.accepted(statement, ["app/calc.py"]), statement)
        self.assertTrue(self.accepted("from widgets import Item", ["widgets/__init__.py"]))
        self.assertTrue(self.accepted("from widgets.calc import add", ["src/widgets/calc.py"]), "src layout")
        self.assertTrue(self.accepted("import widgets", ["src/widgets/__init__.py"]))
        self.assertTrue(self.accepted("from engine import verify", ["engine/verify.py"]))

    def test_relative_imports_resolve_from_the_test_folder(self):
        self.assertTrue(self.accepted("from .calc import add", ["app/calc.py"], "app/test_feature.py"))
        self.assertTrue(self.accepted("from ..calc import add", ["app/calc.py"], "app/tests/test_feature.py"))
        self.assertTrue(self.accepted("from . import calc", ["app/calc.py"], "app/test_feature.py"))
        self.assertFalse(self.accepted("from ...app.calc import add", ["app/calc.py"]), "cannot climb above the repository")

    def test_imports_that_do_not_reach_real_code_are_still_fake(self):
        for source in ("# from app.calc import add", 'text = "from app.calc import add"', "import unittest",
                       "from engine.fake import add", "from app.missing import add", "from app import missing",
                       "import app", "from app.calc import ("):
            self.assertFalse(self.accepted(source, ["app/calc.py"]), source)
        self.assertFalse(self.accepted("from tests.fake_calc import add", ["tests/fake_calc.py"]), "another test file is not real code")

    def test_importlib_and_runpy_loads_of_repository_files_count(self):
        script = ["scripts/dependency-map.py"]
        self.assertTrue(self.accepted('import importlib.util\nfrom pathlib import Path\n'
                                      'spec = importlib.util.spec_from_file_location("m", Path(__file__).parents[1] / "scripts/dependency-map.py")', script))
        self.assertTrue(self.accepted('import runpy\nns = runpy.run_path("./scripts/dependency-map.py")', script))
        self.assertTrue(self.accepted('import importlib\ncalc = importlib.import_module("app.calc")', ["app/calc.py"]))
        for source in ('import importlib\nx = importlib.import_module("app.missing")',
                       'import runpy\nrunpy.run_path("scripts/map.py")', 'import runpy\nrunpy.run_path("tests/fake.py")'):
            self.assertFalse(self.accepted(source, script + ["app/calc.py"]), source)

    def test_reading_a_repository_file_counts_but_documentation_and_docstrings_do_not(self):
        files = [".github/workflows/sandbox-tests.yml", "README.md", "app/calc.py"]
        self.assertTrue(self.accepted("from pathlib import Path\nsource = (Path(__file__).parents[1] / '.github/workflows/sandbox-tests.yml').read_text()", files))
        self.assertFalse(self.accepted("text = open('README.md').read()", files), "documentation is not code under test")
        self.assertFalse(self.accepted('"""Checks app/calc.py."""', files), "a docstring mention loads nothing")
        self.assertFalse(self.accepted("# app/calc.py", files))

    def test_this_repositorys_own_tests_count_as_real(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        # Use the actual tracked-source inventory. A fixed list falsely rejected #221's real workflow reader.
        import subprocess
        paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], cwd=root, text=True).splitlines()
        # test_test_discovery checks test file names only; it has no repository code to load.
        for test in sorted(t for t in (root / "tests").glob("test_*.py") if t.name != "test_test_discovery.py"):
            name = "tests/" + test.name
            self.assertEqual(verify.tests_without_real_code({name: test.read_text(encoding="utf-8")}, paths), [], name)


if __name__ == "__main__":
    unittest.main()

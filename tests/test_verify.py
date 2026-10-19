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

        def ok(self, text, phase=False, status=None):
            self.lines.append((status or "ok", text))

    def run_check(self, reviews, fixes):
        reviews, fixes, prompts = list(reviews), list(fixes), []

        def model(api_key, prompt, max_output_tokens=0, allowed=None, json_mode=False):
            return "gemini", json.dumps(reviews.pop(0))

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
    def test_gemini_is_asked_for_json_when_the_caller_needs_it(self):
        from engine import runner
        sent = []
        def urlopen(req, timeout=None):
            if "/models?" in req.full_url:
                return response({"models": [{"name": "models/gemini-3-flash", "supportedGenerationMethods": ["generateContent"]}]})
            sent.append(json.loads(req.data)["generationConfig"])
            return response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "{}"}]}}]})
        with patch("engine.runner.urllib.request.urlopen", side_effect=urlopen):
            runner.run_model("key", "p", json_mode=True)
            runner.run_model("key", "p")
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


if __name__ == "__main__":
    unittest.main()

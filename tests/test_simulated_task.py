"""A whole development task, end to end, against a simulated GitHub and simulated AI providers.

Only the network is fake: planning, model routing, staged writing, the intent guard, checking the work, the progress
comment (with its live activity feed) and the draft PR all run for real. The providers misbehave the way they did on
tasks #119-#125: rate limits, a retired model, empty answers, answers that don't apply, a step and a test that can't
be written, and more retries in the whole task than one shared budget of 5 allowed.
"""
import base64
import io
import json
import os
import re
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from engine import developer, intent_guard, runner

REPO = "onlykappa/KappaForge"
FILES = {
    "preview/core.js": "const defaults={routing:'balanced',appearance:'dark',autoStart:true};\nfunction settings(){return defaults}\n",
    "preview/app-main.js": "function send(){}\ninput.addEventListener(\"keydown\",e=>{if(e.key===\"Enter\")send()});\n",
    "tests/app.test.mjs": "import '../preview/app-main.js';\n",
    "KAPPA.md": "Test command: npm test\n",
}
TASK = {"number": 777, "title": "Add a weather setting", "state": "open", "user": {"login": "onlykappa"},
        "created_at": "2099-01-01T00:00:00Z",
        "body": "Repository: onlykappa/KappaForge\nMode: develop\n\nAdd a weather units setting and show it in chat."}


def reply(data):
    result = MagicMock()
    result.__enter__.return_value = result
    result.__exit__.return_value = False
    result.read.return_value = json.dumps(data).encode()
    return result


def chat(text):
    return reply({"choices": [{"message": {"content": text}}]})


def setUpModule():
    # These tests fake GitHub's JSON API; the repository map's archive download stays offline (planning from paths).
    global _no_archive
    _no_archive = patch.object(developer.repo_maps, "download_sources", side_effect=OSError("offline in tests"))
    _no_archive.start()


def tearDownModule():
    _no_archive.stop()


class World:
    """Simulated GitHub plus simulated providers, recording what the agent did."""

    def __init__(self):
        self.comments, self.edits, self.prs, self.dispatches, self.writes = [], [], [], [], []
        self.asked = []  # (model, kind of prompt)
        self.stage1_bad = 0

    # ---- GitHub -------------------------------------------------------------------------------------------
    def gh(self, path, token, payload=None, method=None):
        if payload is not None:
            self.writes.append((path, payload))
        if path.endswith("/git/ref/heads/kappa/dev-777"):
            raise urllib.error.HTTPError(path, 404, "missing", {}, None)
        if path == f"repos/{REPO}":
            return {"default_branch": "main", "private": False}
        if path == f"repos/{REPO}/git/ref/heads/main":
            return {"object": {"sha": "a" * 40}}
        if path.startswith(f"repos/{REPO}/git/trees/"):
            return {"tree": [{"path": p, "type": "blob", "size": len(t)} for p, t in FILES.items()]}
        if path.startswith(f"repos/{REPO}/contents/"):
            name = urllib.parse.unquote(path.split("/contents/")[1].split("?")[0])
            if name not in FILES:
                raise urllib.error.HTTPError(path, 404, "missing", {}, None)
            return {"encoding": "base64", "content": base64.b64encode(FILES[name].encode()).decode()}
        if path.startswith(f"repos/{REPO}/issues/777/comments") and payload is None:
            return []
        if path == f"repos/{REPO}/issues/777/comments":
            self.comments.append(payload["body"])
            return {"id": len(self.comments)}
        if "/issues/comments/" in path and method == "PATCH":
            self.edits.append(payload["body"])
            return {}
        if path == f"repos/{REPO}/pulls":
            self.prs.append(payload)
            return {"html_url": f"https://github.com/{REPO}/pull/900", "number": 900}
        if path == f"repos/{REPO}/pulls/900" and method == "PATCH":
            self.prs[-1].update(payload)
            return {"html_url": f"https://github.com/{REPO}/pull/900", "number": 900}
        if path.endswith("/dispatches"):
            self.dispatches.append(path)
            return {}
        if path.startswith(f"repos/{REPO}/git/commits/"):
            return {"tree": {"sha": "t" * 40}}
        return {"sha": "c" * 40}

    # ---- AI providers -------------------------------------------------------------------------------------
    def urlopen(self, req, timeout=None):
        url = req.full_url
        if "generativelanguage" in url and "/models?" in url:
            return reply({"models": [{"name": "models/" + m, "supportedGenerationMethods": ["generateContent"]}
                                     for m in ("gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite")]})
        if "generativelanguage" in url:
            model = url.split("/models/")[1].split(":")[0]
            prompt = json.loads(req.data)["contents"][0]["parts"][0]["text"]
            if model == "gemini-3.8-flash":  # Out of its tiny daily quota.
                raise urllib.error.HTTPError(url, 429, "quota", {}, io.BytesIO(b'{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}'))
            if model == "gemini-2.5-flash":  # Retired.
                raise urllib.error.HTTPError(url, 404, "gone", {}, io.BytesIO(b""))
            text = self.answer(model, prompt)
            return reply({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]})
        if url == "https://ollama.com/v1/models":
            return reply({"data": [{"id": "deepseek-v4-pro"}]})
        if url == "https://ollama.com/v1/chat/completions":
            body = json.loads(req.data)
            return chat(self.answer("ollama:" + body["model"], body["messages"][0]["content"]))
        if url == "https://integrate.api.nvidia.com/v1/models":
            return reply({"data": [{"id": "nvidia/nemotron-3-ultra-550b-a55b"}]})
        if "integrate.api.nvidia.com" in url:  # Rate-limited all day.
            raise urllib.error.HTTPError(url, 429, "busy", {}, io.BytesIO(b""))
        raise urllib.error.HTTPError(url, 503, "down", {}, io.BytesIO(b""))  # Every other provider is down.

    def answer(self, model, prompt):
        """The scripted model: what each kind of request gets back."""
        kind = ("plan" if "You are planning a code change" in prompt else
                "review" if "You are reviewing a change" in prompt else
                "fix" if "SELF-REVIEW" in prompt else
                "test" if "FINAL STAGE" in prompt else
                "stage" + re.search(r"THIS IS STAGE (\d+)", prompt).group(1) if "THIS IS STAGE" in prompt else "other")
        self.asked.append((model, kind))
        if kind == "plan":
            return json.dumps({"read": ["preview/core.js", "preview/app-main.js"], "design": "Settings run in the app.",
                               "stages": ["Add the weather units setting", "Bundle web assets", "Show the units in chat"]})
        if kind == "stage1":
            if model.startswith("ollama") and self.stage1_bad < 2:  # Two answers that don't apply: switch models.
                self.stage1_bad += 1
                return json.dumps({"files": [{"path": "preview/core.js", "edits": [{"find": "no such text " + str(self.stage1_bad), "replace": "x"}]}]})
            return json.dumps({"summary": "Adds weatherUnits", "files": [{"path": "preview/core.js", "reason": "Save the owner requested weather units setting", "edits": [
                {"find": "autoStart:true}", "replace": "autoStart:true,weatherUnits:'F'}"}]}]})
        if kind == "stage2":
            return json.dumps({"summary": "Bundling is automatic", "files": []})
        if kind in ("stage3", "test"):
            # Edits that never apply, each different (as on #125): every retry is counted by the intent guard.
            self.misses = getattr(self, "misses", 0) + 1
            return json.dumps({"files": [{"path": "preview/app-main.js", "edits": [{"find": f"missing text {self.misses}", "replace": "x"}]}]})
        if kind == "review":
            return json.dumps({"file_scope": [{"path": "preview/core.js", "necessary": True,
                                                "reason": "Save the requested weather units setting", "quote": "weatherUnits:'F'"}],
                               "requirements": [{"text": "Add a weather units setting", "met": True,
                                                 "evidence": {"path": "preview/core.js", "quote": "weatherUnits:'F'"}},
                                                {"text": "Show it in chat", "met": False, "evidence": "nothing shows it"}],
                               "problems": [], "files_needed": ["preview/app-main.js"]})
        if kind == "fix":
            return "Still not JSON."
        return "{}"


class SimulatedTask(unittest.TestCase):
    def run_task(self, interrupt=False):
        world = World()
        self.world = world
        answer = world.answer
        def interrupted(model, prompt):
            if 'THIS IS STAGE 2' in prompt:
                raise runner.TaskTimeExpired('task budget reached')
            return answer(model, prompt)
        if interrupt:
            world.answer = interrupted
        for cache in (runner._lists, runner.EXHAUSTED, runner.COOLDOWN):
            cache.clear()
        developer.UNFINISHED.clear()
        env = {k: "" for k in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY",
                               "LLM7_API_KEY", "UNOROUTER_API_KEY", "REQUESTY_API_KEY", "KAPPA_CODE_PROVIDERS",
                               "KAPPA_PRIVATE_CODE_PROVIDERS", "DISCORD_WEBHOOK_URL")}
        env.update({"OLLAMA_API_KEY": "sim-ollama", "NVIDIA_API_KEY": "sim-nvidia"})
        scope = intent_guard.activate(TASK)
        self.addCleanup(intent_guard.ACTIVE.set, None)
        self.addCleanup(setattr, developer.Progress, "latest", None)
        with patch.dict(os.environ, env), patch.object(developer, "gh", side_effect=world.gh), \
                patch("engine.runner.urllib.request.urlopen", side_effect=world.urlopen), patch("engine.runner.time.sleep"), \
                patch("engine.native_build.dispatch"):
            url = developer.produce_development_pr(TASK, "sim-gemini", "sim-token")
        return world, url, scope

    def test_timeout_retains_an_incomplete_draft_with_validated_source(self):
        with self.assertRaises(runner.TaskTimeExpired):
            self.run_task(interrupt=True)
        world = self.world
        self.assertEqual(len(world.prs), 1)
        self.assertTrue(world.prs[0]['draft'])
        self.assertTrue(developer.requirements_open(world.prs[0]))
        tree = next(p for path, p in world.writes if path.endswith('/git/trees'))['tree']
        self.assertIn("weatherUnits:'F'", tree[0]['content'])
        self.assertTrue(any(path.endswith('/git/refs') for path, _ in world.writes))
        self.assertFalse(any('/refs/heads/main' in path for path, _ in world.writes))
        self.assertFalse(world.dispatches)

    def test_the_whole_task_gets_through_every_failure_and_opens_an_honest_draft(self):
        world, url, scope = self.run_task()

        # It finished with a draft PR instead of failing (#123 and #125 failed outright).
        self.assertEqual(url, f"https://github.com/{REPO}/pull/900")
        pr = world.prs[0]
        self.assertTrue(pr["draft"])
        self.assertTrue(pr["title"].startswith("Draft (incomplete):"), "work still missing is said, not hidden")
        committed = json.dumps([p for path, p in world.writes if "/git/" in path])
        self.assertIn("weatherUnits:'F'", committed, "stage 1's change is committed")
        tree = next(p for path, p in world.writes if path.endswith("/git/trees"))["tree"]
        self.assertEqual([t["path"] for t in tree], ["preview/core.js"], "only the file it changed; app-main.js is untouched")

        # Best models first: the strong provider is asked before any Gemini model.
        first_gemini = next(i for i, (m, _) in enumerate(world.asked) if m.startswith("gemini"))
        self.assertTrue(world.asked[0][0].startswith("ollama:"), world.asked[:3])
        self.assertGreater(first_gemini, 0)
        # Mid-task switch: two answers from DeepSeek that don't apply, then the next model writes stage 1.
        stage1 = [m for m, k in world.asked if k == "stage1"]
        self.assertEqual(stage1[:2], ["ollama:deepseek-v4-pro"] * 2)
        self.assertEqual(stage1[2], "gemini-3.5-flash-lite")
        # Rate-limited and retired models were not asked again and again.
        self.assertIn("gemini-3.8-flash", runner.EXHAUSTED)
        self.assertIn("gemini-2.5-flash", runner.EXHAUSTED)

        # The stage with nothing to change was skipped, the step and the test that could not be written were
        # carried into checking the work, and the retries went well past one shared budget of 5.
        self.assertGreater(scope.recoveries, 5)
        self.assertTrue(any("Step 3 of 3 was not done" in p for p in developer.UNFINISHED))
        self.assertTrue(any("No test proves the change works yet" in p for p in developer.UNFINISHED))

        # The progress comment carries the live feed the app shows, and no secrets.
        last = (world.edits or world.comments)[-1]
        snapshot = json.loads(re.search(r"<!-- KAPPA_PROGRESS_V1 (.*?) -->", last).group(1))
        kinds = {a["kind"] for a in snapshot["activity"]}
        self.assertTrue({"read", "plan", "code", "model", "check"} <= kinds, kinds)
        feed = " ".join(a["text"] for a in snapshot["activity"])
        self.assertIn("Asking ollama:deepseek-v4-pro", feed)
        self.assertIn("Switching away from ollama:deepseek-v4-pro", feed)
        self.assertNotIn("sim-", "".join(world.comments + world.edits) + json.dumps(world.prs))

        # Steps that did not do their job never show a green check on the task card.
        flagged = {r["title"].split(";")[0].split(":")[0]: r["status"] for r in snapshot["steps"]}
        self.assertEqual(flagged["Step 3 of 3 could not be written"], "blocked")
        self.assertEqual(flagged["Could not write the test yet"], "blocked")
        self.assertTrue(any(status == "blocked" for title, status in flagged.items() if title.startswith("Found ")), "unfinished work and unmet requirements stay blocked")
        self.assertEqual(flagged["Read 2 files"], "completed")

        # Tests were dispatched for the draft, and the final report says what is not finished.
        self.assertTrue(world.dispatches)
        self.assertTrue(any("**Not finished:**" in c for c in world.comments))


if __name__ == "__main__":
    unittest.main()

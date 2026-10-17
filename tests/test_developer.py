import json
import os
import unittest
import urllib.error
from unittest.mock import patch
from engine import developer
from engine.developer import apply_changes, check_path, syntax_error, produce_development_pr

SOURCES = {"app/main.py": "def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n"}
EXISTING = {"app/main.py": 60, "app/other.py": 10}

class DeveloperValidationTests(unittest.TestCase):
    def test_edits_apply_to_read_files(self):
        changes = apply_changes(SOURCES, EXISTING, {"files": [{"path": "app/main.py", "edits": [
            {"find": "return a + b", "replace": "return int(a) + int(b)"}]}]})
        self.assertIn("int(a) + int(b)", changes["app/main.py"])
        self.assertIn("return a - b", changes["app/main.py"])

    def test_new_files_may_be_created(self):
        changes = apply_changes(SOURCES, EXISTING, {"files": [{"path": "tests/test_main.py", "content": "import unittest\n"}]})
        self.assertEqual(list(changes), ["tests/test_main.py"])

    def test_ambiguous_or_missing_find_is_rejected(self):
        for find in ["return a", "not in the file"]:
            with self.subTest(find=find), self.assertRaises(ValueError):
                apply_changes(SOURCES, EXISTING, {"files": [{"path": "app/main.py", "edits": [{"find": find, "replace": "x"}]}]})

    def test_unread_existing_files_cannot_be_overwritten_or_edited(self):
        with self.assertRaises(ValueError):
            apply_changes(SOURCES, EXISTING, {"files": [{"path": "app/other.py", "content": "wiped"}]})
        with self.assertRaises(ValueError):
            apply_changes(SOURCES, EXISTING, {"files": [{"path": "app/other.py", "edits": [{"find": "a", "replace": "b"}]}]})

    def test_guardrails_ci_secrets_and_unsafe_paths_are_protected(self):
        for path in [".github/workflows/agent.yml", "engine/task_scope.py", "engine/developer.py", "engine/runner.py",
                     "chat-backend/wrangler.toml", "package-lock.json", "web/package-lock.json", ".env", "app/.env.local",
                     "../escape.py", "/abs.py", "a//b.py", "a\\b.py", "dir/"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                check_path(path)
        self.assertEqual(check_path("chat-backend/src/index.js"), "chat-backend/src/index.js")

    def test_unchanged_duplicate_and_oversized_results_are_rejected(self):
        bad = [
            {"files": [{"path": "app/main.py", "content": SOURCES["app/main.py"]}]},
            {"files": [{"path": "n.py", "content": "1"}, {"path": "n.py", "content": "2"}]},
            {"files": [{"path": "n.py", "content": "x" * (developer.MAX_FILE_CHARS + 1)}]},
            {"files": [{"path": f"n{i}.py", "content": "1"} for i in range(developer.MAX_CHANGED_FILES + 1)]},
            {"files": []},
        ]
        for proposal in bad:
            with self.subTest(proposal=str(proposal)[:60]), self.assertRaises(ValueError):
                apply_changes(SOURCES, EXISTING, proposal)

    def test_syntax_checks_parse_without_executing(self):
        self.assertIsNone(syntax_error("a.py", "x = 1\n"))
        self.assertIsNotNone(syntax_error("a.py", "def broken(:\n"))
        self.assertIsNotNone(syntax_error("a.json", "{bad"))
        self.assertIsNone(syntax_error("a.js", "require('fs').writeFileSync('/tmp/kappa-should-not-exist','x')\n"))
        self.assertFalse(os.path.exists("/tmp/kappa-should-not-exist"))
        if developer.shutil.which("node"):
            self.assertIsNotNone(syntax_error("a.js", "function (\n"))

    def test_invalid_output_is_retried_with_the_rejection_reason(self):
        bad = json.dumps({"files": [{"path": "app/main.py", "edits": [{"find": "missing", "replace": "x"}]}]})
        good = json.dumps({"explanation": "Adding now works with text numbers.", "summary": "Cast inputs", "files": [
            {"path": "app/main.py", "edits": [{"find": "return a + b", "replace": "return int(a) + int(b)"}]}]})
        with patch.object(developer, "run_model", side_effect=[("flash", bad), ("flash", good)]) as ai:
            model, summary, changes, explanation = developer.generate("key", "task", "onlykappa/KappaForge", SOURCES, EXISTING)
        self.assertEqual(summary, "Cast inputs")
        self.assertEqual(explanation, "Adding now works with text numbers.")
        self.assertIn("matched 0 times", ai.call_args_list[1][0][1])

    def test_gives_up_after_three_invalid_answers(self):
        bad = json.dumps({"files": [{"path": ".github/workflows/x.yml", "content": "x"}]})
        with patch.object(developer, "run_model", return_value=("flash", bad)) as ai, self.assertRaises(ValueError):
            developer.generate("key", "task", "onlykappa/KappaForge", SOURCES, EXISTING)
        self.assertEqual(ai.call_count, 3)


class DeveloperAuthorizationTests(unittest.TestCase):
    def issue(self, **overrides):
        base = {"number": 9, "title": "Add feature", "user": {"login": "onlykappa"},
                "body": "Repository: onlykappa/KappaForge\nMode: develop\n\nAdd a feature"}
        base.update(overrides)
        return base

    def test_requires_owner_mode_and_allowed_repository(self):
        cases = [self.issue(user={"login": "someone"}),
                 self.issue(body="Repository: onlykappa/KappaForge\nMode: code\n\nx"),
                 self.issue(body="Repository: someone/else\nMode: develop\n\nx")]
        for issue in cases:
            with self.subTest(body=issue["body"][:40]), self.assertRaises(ValueError):
                produce_development_pr(issue, "key", "token")

    def test_other_repositories_need_the_coder_token(self):
        issue = self.issue(body="Repository: onlykappa/OmniPC\nMode: develop\n\nx")
        with patch.dict(os.environ, {"KAPPA_CODER_TOKEN": ""}), self.assertRaisesRegex(ValueError, "KAPPA_CODER_TOKEN"):
            produce_development_pr(issue, "key", "token")

    def test_refuses_to_reuse_an_existing_branch(self):
        with patch.object(developer, "gh", return_value={"object": {"sha": "a" * 40}}), \
                self.assertRaisesRegex(ValueError, "already exists"):
            produce_development_pr(self.issue(), "key", "token")

    def test_commits_one_atomic_change_and_reports_back(self):
        calls = []
        def fake_gh(path, token, payload=None, method=None):
            calls.append((path, payload))
            if path.endswith("/git/ref/heads/kappa/dev-9"):
                raise urllib.error.HTTPError(path, 404, "missing", {}, None)
            responses = {
                "repos/onlykappa/KappaForge": {"default_branch": "main"},
                "repos/onlykappa/KappaForge/git/ref/heads/main": {"object": {"sha": "b" * 40}},
                "repos/onlykappa/KappaForge/git/trees": {"sha": "t" * 40},
                "repos/onlykappa/KappaForge/git/commits": {"sha": "c" * 40},
                "repos/onlykappa/KappaForge/pulls": {"html_url": "https://github.com/onlykappa/KappaForge/pull/50"},
            }
            if path.startswith("repos/onlykappa/KappaForge/git/trees/"):
                return {"tree": [{"path": "app/main.py", "type": "blob", "size": 60, "mode": "100755"}]}
            if path.startswith("repos/onlykappa/KappaForge/git/commits/"):
                return {"tree": {"sha": "r" * 40}}
            if path.startswith("repos/onlykappa/KappaForge/contents/app/main.py"):
                import base64
                return {"encoding": "base64", "content": base64.b64encode(SOURCES["app/main.py"].encode()).decode()}
            return responses.get(path, {})
        answers = [("flash", json.dumps({"read": ["app/main.py"]})),
                   ("flash", json.dumps({"summary": "Cast inputs", "files": [{"path": "app/main.py", "edits": [
                       {"find": "return a + b", "replace": "return int(a) + int(b)"}]}]}))]
        with patch.object(developer, "gh", side_effect=fake_gh), patch.object(developer, "run_model", side_effect=answers):
            url = produce_development_pr(self.issue(), "key", "token")
        self.assertEqual(url, "https://github.com/onlykappa/KappaForge/pull/50")
        paths = [p for p, _ in calls]
        tree = next(payload for p, payload in calls if p == "repos/onlykappa/KappaForge/git/trees")
        self.assertEqual(tree["tree"][0]["path"], "app/main.py")
        self.assertIn("int(a) + int(b)", tree["tree"][0]["content"])
        self.assertEqual(tree["tree"][0]["mode"], "100755")
        ref = next(payload for p, payload in calls if p == "repos/onlykappa/KappaForge/git/refs")
        self.assertEqual(ref, {"ref": "refs/heads/kappa/dev-9", "sha": "c" * 40})
        self.assertNotIn("repos/onlykappa/KappaForge/git/refs/heads/main", paths)
        self.assertIn("repos/onlykappa/KappaForge/actions/workflows/sandbox-tests.yml/dispatches", paths)
        comment = next(payload for p, payload in calls if p.endswith("/issues/9/comments"))
        self.assertTrue(comment["body"].startswith("KappaForge generated a draft PR: "))
        pr = next(payload for p, payload in calls if p == "repos/onlykappa/KappaForge/pulls")
        self.assertTrue(pr["draft"])
        self.assertIn("## What this does\nCast inputs", pr["body"])


class OwnerRequestedFixTests(unittest.TestCase):
    ISSUE = {"number": 9, "title": "Add feature", "user": {"login": "onlykappa"},
             "body": "Repository: onlykappa/KappaForge\nMode: develop\n\nAdd a feature"}
    HEAD = "d" * 40

    def fake(self, run_conclusion="failure", fixes=0, title=None):
        calls = []
        def gh(path, token, payload=None, method=None):
            calls.append((path, payload, method))
            if path.startswith("repos/onlykappa/KappaForge/pulls?state=open"):
                return [{"number": 50, "html_url": "https://github.com/onlykappa/KappaForge/pull/50", "body": "## What this does\nOld",
                         "head": {"ref": "kappa/dev-9", "sha": self.HEAD, "repo": {"full_name": "onlykappa/KappaForge"}}}]
            if "/actions/workflows/sandbox-tests.yml/runs" in path:
                return {"workflow_runs": [{"id": 7, "status": "completed", "conclusion": run_conclusion, "head_branch": "main",
                                           "event": "workflow_dispatch",
                                           "display_title": title or f"Sandbox validation kappa/dev-9 @ {self.HEAD}"}]}
            if path.endswith("/issues/50/comments?per_page=100"):
                return [{"body": developer.FIX_MARKER + "x -->"}] * fixes
            if path.endswith("/runs/7/jobs?per_page=30"):
                return {"jobs": [{"id": 3, "name": "verify", "conclusion": "failure", "steps": []}]}
            if path.endswith("/pulls/50/files?per_page=100"):
                return [{"filename": "app/main.py", "status": "modified"}]
            if path.startswith("repos/onlykappa/KappaForge/git/trees/"):
                return {"tree": [{"path": "app/main.py", "type": "blob", "size": 60}]}
            if path.startswith("repos/onlykappa/KappaForge/contents/app/main.py"):
                import base64
                return {"encoding": "base64", "content": base64.b64encode(SOURCES["app/main.py"].encode()).decode()}
            if path.startswith("repos/onlykappa/KappaForge/git/commits/"):
                return {"tree": {"sha": "r" * 40}}
            return {"sha": "e" * 40}
        return calls, gh

    def answer(self):
        return ("flash", json.dumps({"explanation": "Fixes the adding bug the tests caught.", "summary": "Cast", "files": [
            {"path": "app/main.py", "edits": [{"find": "return a + b", "replace": "return int(a) + int(b)"}]}]}))

    def test_fix_fast_forwards_the_branch_retests_and_explains(self):
        calls, gh = self.fake()
        with patch.object(developer, "gh", side_effect=gh), patch.object(developer, "job_log", return_value="FAIL test_add"), \
                patch.object(developer, "run_model", return_value=self.answer()):
            developer.fix_pull_request(self.ISSUE, "key", "token")
        ref = next(c for c in calls if c[0] == "repos/onlykappa/KappaForge/git/refs/heads/kappa/dev-9")
        self.assertEqual(ref[1:], ({"sha": "e" * 40, "force": False}, "PATCH"))
        dispatch = next(c for c in calls if c[0].endswith("sandbox-tests.yml/dispatches"))
        self.assertEqual(dispatch[1]["inputs"], {"branch": "kappa/dev-9", "candidate_sha": "e" * 40})
        body = next(c for c in calls if c[0] == "repos/onlykappa/KappaForge/pulls/50")[1]["body"]
        self.assertTrue(body.endswith("## Latest fix\nFixes the adding bug the tests caught."))
        self.assertFalse(any(c[0].endswith("/merge") for c in calls))

    def test_fix_refuses_passing_stale_capped_or_other_repository_runs(self):
        cases = [dict(run_conclusion="success"), dict(title="Sandbox validation kappa/dev-9 @ " + "f" * 40),
                 dict(fixes=developer.MAX_FIXES)]
        for case in cases:
            calls, gh = self.fake(**case)
            with self.subTest(case=case), patch.object(developer, "gh", side_effect=gh), self.assertRaises(ValueError):
                developer.fix_pull_request(self.ISSUE, "key", "token")
            self.assertFalse(any(c[2] == "PATCH" for c in calls))
        with self.assertRaises(ValueError):
            developer.fix_pull_request(dict(self.ISSUE, body="Repository: onlykappa/OmniPC\nMode: develop\n\nx"), "key", "token")


if __name__ == "__main__":
    unittest.main()

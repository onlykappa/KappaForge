import unittest
from unittest.mock import patch
from engine import native_build
from engine.developer import failure_excerpt

SHA = "a" * 40
OLD = "b" * 40


def run(id, sha, conclusion, status="completed", branch="kappa/dev-7"):
    return {"id": id, "display_title": f"iOS build {branch} @ {sha}", "head_branch": "main", "event": "workflow_dispatch",
            "status": status, "conclusion": conclusion, "html_url": f"https://github.com/r/{id}", "created_at": f"2026-10-18T1{id}:00:00Z"}


class NativeBuildTests(unittest.TestCase):
    def test_only_kappaforge_app_changes_need_a_native_build(self):
        self.assertTrue(native_build.needed("onlykappa/KappaForge", ["preview/ui.js"]))
        self.assertTrue(native_build.needed("onlykappa/KappaForge", ["ios/KappaForge/KappaWebView.swift"]))
        self.assertFalse(native_build.needed("onlykappa/KappaForge", ["engine/runner.py", "tests/test_runner.py"]))
        self.assertFalse(native_build.needed("onlykappa/OmniPC", ["preview/ui.js"]))

    def test_dispatch_names_the_exact_commit_on_the_branch(self):
        calls = []
        with patch.object(native_build, "gh", lambda path, token, payload=None: calls.append((path, payload))):
            native_build.dispatch("kappa/dev-7", SHA, "t")
        self.assertEqual(calls, [("repos/onlykappa/KappaForge/actions/workflows/ios-build.yml/dispatches",
                                  {"ref": "main", "inputs": {"branch": "kappa/dev-7", "candidate_sha": SHA}})])

    def test_result_and_history_follow_the_branch_and_ignore_other_runs(self):
        runs = [run(3, SHA, None, "in_progress"), run(2, OLD, "failure"), run(1, OLD, "success", branch="kappa/dev-8"),
                {**run(4, SHA, "success"), "event": "push"}]
        jobs = {2: [{"id": 20, "conclusion": "failure", "steps": [{"name": "Build simulator application", "conclusion": "failure"}]}]}

        def gh(path, token, payload=None):
            if "/runs/" in path and path.endswith("/jobs?per_page=30"):
                return {"jobs": jobs.get(int(path.split("/runs/")[1].split("/")[0]), [])}
            return {"workflow_runs": runs}
        with patch.object(native_build, "gh", gh):
            self.assertEqual(native_build.result("kappa/dev-7", SHA, "t")["id"], 3)
            history = native_build.history("kappa/dev-7", "t")
        self.assertEqual([h["sha"] for h in history], [SHA, OLD])
        self.assertEqual(history[1]["failed_steps"], ["Build simulator application"])
        summary = native_build.summary(history)
        self.assertIn("running", summary)
        self.assertIn("failed at Build simulator application", summary)

    def test_xcode_compile_errors_are_found_in_the_log(self):
        log = ("CompileSwift normal arm64 KappaWebView.swift\n" + "noise\n" * 400 +
               "/Users/runner/work/KappaForge/ios/KappaForge/KappaWebView.swift:42:17: error: cannot find 'composer' in scope\n"
               "** BUILD FAILED **\n")
        excerpt = failure_excerpt(log, 400)
        self.assertTrue(excerpt.startswith("/Users/runner/work/KappaForge/ios/KappaForge/KappaWebView.swift:42:17: error:"))
        self.assertIn("** BUILD FAILED **", excerpt)

    def test_the_execution_guard_lets_a_task_build_only_its_own_branch(self):
        from engine.intent_guard import ExecutionScope
        task = {"number": 7, "state": "open", "user": {"login": "onlykappa"}, "created_at": "2099-01-01T00:00:00Z",
                "body": "Repository: onlykappa/KappaForge\nMode: develop\n\nFix"}
        scope = ExecutionScope(task)
        url = "https://api.github.com/repos/onlykappa/KappaForge/actions/workflows/ios-build.yml/dispatches"
        scope.permit(url, {"ref": "main", "inputs": {"branch": "kappa/dev-7", "candidate_sha": SHA}}, "POST")
        with self.assertRaises(PermissionError):
            scope.permit(url, {"ref": "main", "inputs": {"branch": "main", "candidate_sha": SHA}}, "POST")
        with self.assertRaises(PermissionError):
            scope.permit(url, {"ref": "main", "inputs": {"branch": "kappa/dev-8", "candidate_sha": SHA}}, "POST")

    def test_files_named_by_xcode_with_runner_paths_are_read_like_any_other(self):
        from engine.developer import files_named_in
        existing = {"ios/KappaForge/KappaWebView.swift": 1, "ios/KappaForgeUITests/LaunchTests.swift": 1, "preview/ui.js": 1}
        log = ("/Users/runner/work/KappaForge/KappaForge/ios/KappaForge/KappaWebView.swift:42:17: error: cannot find 'x'\n"
               "/Users/runner/work/KappaForge/KappaForge/ios/KappaForgeUITests/LaunchTests.swift:10: error: XCTAssertTrue failed\n"
               "/home/runner/work/KappaForge/KappaForge/preview/ui.js:3 TypeError")
        self.assertEqual(files_named_in(log, existing, ["preview/ui.js"]),
                         ["ios/KappaForge/KappaWebView.swift", "ios/KappaForgeUITests/LaunchTests.swift"])

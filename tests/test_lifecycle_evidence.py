"""PR lifecycle asks are decided by GitHub's record of the task's draft PR, never turned into code work (task #205)."""
import unittest
from unittest.mock import patch

from engine import developer, recovery, verify

REPO, BRANCH = "onlykappa/KappaForge", "kappa/dev-205"
PR = {"html_url": f"https://github.com/{REPO}/pull/206", "state": "open", "draft": True,
      "head": {"ref": BRANCH, "repo": {"full_name": REPO}}}


class Progress:
    def now(self, *a, **k): pass
    def ok(self, *a, **k): pass


class ClassifierTests(unittest.TestCase):
    def test_task_221_referential_change_is_not_a_code_requirement(self):
        for text in ("Open a draft PR for this change and do not merge it.",
                     "Open a draft PR for these changes", "Create a pull request with these changes"):
            self.assertTrue(verify.lifecycle_requirement(text), text)
            requirement = verify.resolve_lifecycle([{'text': text, 'met': False}],
                                                   verify.pr_receipt(PR, REPO, BRANCH))[0]
            self.assertTrue(requirement['met'])
        for text in ("Open a PR for this change and fix the bug", "Open a PR that changes the workflow",
                     "Open a PR with changes to the API", "Create a PR for this change and notify users"):
            self.assertFalse(verify.lifecycle_requirement(text), text)

    def test_only_pure_orchestration_asks_are_lifecycle(self):
        for text in ("Open a fresh draft PR", "Keep it as a draft", "Notify me when it is ready for review",
                     "Let me know when done", "Keep the PR in draft", "Create a pull request", "Keep it a draft until I review",
                     "Ping me when done", "Report back when ready"):
            self.assertTrue(verify.lifecycle_requirement(text), text)
        for text in ("Open a PR that fixes all bugs", "Add a button to open a PR", "Do a full bug audit",
                     "Create a workflow that opens a PR", "Open the settings page", "Tell me the weather", "Fix every bug",
                     "Notify users when a message arrives", "Keep the draft banner visible", "Open the draft editor screen",
                     "Report all bugs you find", "Tell me which bugs you found", "Make the PR button work"):
            self.assertFalse(verify.lifecycle_requirement(text), text)

    def test_only_this_tasks_open_pr_is_a_receipt(self):
        self.assertEqual(verify.pr_receipt(PR, REPO, BRANCH), {"url": PR["html_url"], "open": True, "draft": True})
        self.assertIsNone(verify.pr_receipt(PR, REPO, "kappa/dev-1"), "another task's branch")
        self.assertIsNone(verify.pr_receipt({**PR, "head": {"ref": BRANCH, "repo": {"full_name": "someone/fork"}}}, REPO, BRANCH))
        self.assertIsNone(verify.pr_receipt({**PR, "html_url": "https://github.com/other/repo/pull/1"}, REPO, BRANCH))
        self.assertIsNone(verify.pr_receipt(None, REPO, BRANCH))

    def test_receipt_decides_lifecycle_and_source_quotes_cannot(self):
        def resolved(text, receipt, met=True):
            return verify.resolve_lifecycle([{"text": text, "met": met, "evidence": {"path": "x.js", "quote": "openPr()"}}], receipt)[0]
        receipt = verify.pr_receipt(PR, REPO, BRANCH)
        self.assertTrue(resolved("Keep it as a draft", receipt)["met"])
        self.assertEqual(resolved("Open a fresh draft PR", receipt, met=False)["evidence"], {"receipt": PR["html_url"]})
        self.assertFalse(resolved("Keep it as a draft", {**receipt, "draft": False})["met"], "a non-draft PR is not a draft")
        self.assertFalse(resolved("Open a fresh draft PR", {**receipt, "open": False})["met"], "a closed PR does not count")
        self.assertFalse(resolved("Open a fresh draft PR", None)["met"], "a source quote cannot forge the receipt")
        self.assertFalse(resolved("Notify me when ready for review", receipt)["met"], "a PR is not a notification")
        code = resolved("Fix the chat bug", receipt, met=False)
        self.assertNotIn("kind", code)
        self.assertFalse(code["met"])

    def test_report_lists_lifecycle_separately(self):
        text = verify.report([{"text": "Fix the chat bug", "met": True}, {"text": "Open a fresh draft PR", "met": True,
                              "kind": "lifecycle", "evidence": {"receipt": PR["html_url"]}}], [])
        self.assertIn("1 of 1 requirements met", text)
        self.assertIn("Done by KappaForge: Open a fresh draft PR (" + PR["html_url"] + ")", text)

    def test_stored_lifecycle_entries_never_start_a_repair(self):
        self.assertTrue(verify.lifecycle_problem("Requirement not met: Open a fresh draft PR"))
        self.assertTrue(verify.lifecycle_problem("Requirement not met: Keep it as a draft ({'path': 'x', 'quote': 'y'})"))
        self.assertFalse(verify.lifecycle_problem("Requirement not met: Fix every bug"))
        self.assertFalse(verify.lifecycle_problem("Open a fresh draft PR"))


class Task205ReplayTests(unittest.TestCase):
    def check(self, review, receipt):
        prompts = []

        def generate(_key, task, *_a, **_k):
            prompts.append(task)
            return "m", "s", {"app.js": "fixed\n"}, ""

        handle = recovery.CURRENT.set(None)
        developer.UNFINISHED[:] = []
        try:
            with patch.object(verify, "wiring_problems", return_value=[]), patch.object(verify, "model_review", side_effect=review), \
                    patch.object(developer, "generate", side_effect=generate):
                _, verdict, problems = developer.check_the_work("key", "Open a fresh draft PR, audit and fix every bug",
                                                                REPO, "a" * 40, "token", {"app.js": "x\n"}, {"app.js": 2},
                                                                {"app.js": "y\n"}, "", None, "", False, Progress(), receipt=receipt)
        finally:
            recovery.CURRENT.reset(handle)
        return verdict, problems, prompts

    def test_an_existing_draft_satisfies_the_pr_ask_without_a_repair_round(self):
        def review(*_a, **_k):
            return ([{"text": "Open a fresh draft PR", "met": False}, {"text": "Keep it as a draft", "met": False},
                     {"text": "Fix the chat bug", "met": True, "evidence": {"path": "app.js", "quote": "y"}}], [], [])
        verdict, problems, prompts = self.check(review, verify.pr_receipt(PR, REPO, BRANCH))
        self.assertEqual(problems, [])
        self.assertEqual(prompts, [], "no code is written to open a PR that already exists")
        self.assertIn("Done by KappaForge: Keep it as a draft", verdict)


    def test_fix_replay_prompt_marks_existing_draft_pr_as_orchestration(self):
        prompt = []
        files = [{"filename": "engine/developer.py", "status": "modified", "patch": "@@ -1 +1 @@\n-old\n+new"}]
        draft = {**PR, "number": 206}

        def generate(_key, task, *_a, **_k):
            prompt.append(task)
            return "m", "s", {"engine/developer.py": "new\n"}, "summary"

        with (
            patch.object(developer, "gh", side_effect=lambda path, *_a, **_k: files if path.endswith("/pulls/206/files?per_page=100") else []),
            patch.object(developer, "list_tree", return_value=({"engine/developer.py": 10}, {"engine/developer.py": "100644"})),
            patch.object(developer, "project_guide", return_value=""),
            patch.object(developer, "read_source", return_value="old\n"),
            patch.object(developer, "requirements_open", return_value=[
                "Requirement not met: Open a fresh draft PR",
                "Requirement not met: Fix the audit bug"]),
            patch.object(developer, "is_private", return_value=True),
            patch.object(developer, "code_providers", return_value=["groq"]),
            patch.object(developer, "generate", side_effect=generate),
            patch.object(developer, "check_the_work", return_value=({"engine/developer.py": "new\n"}, "checked", [])),
            patch.object(developer, "has_tests", return_value=True),
        ):
            developer.revise_branch({"number": 205, "title": "Full audit and bug fix draft",
                                     "body": "Open a fresh PR, audit and fix bugs"},
                                    draft, BRANCH, "a" * 40, [], "token", "key",
                                    repo=REPO, repo_token="token")

        self.assertEqual(len(prompt), 1)
        self.assertIn("TASK PR LIFECYCLE ALREADY SATISFIED BY GITHUB", prompt[0])
        self.assertIn(PR["html_url"], prompt[0])
        self.assertIn("- Requirement not met: Fix the audit bug", prompt[0])
        lifecycle = prompt[0].split("TASK PR LIFECYCLE ALREADY SATISFIED BY GITHUB:", 1)
        self.assertEqual(len(lifecycle), 2)
        self.assertNotIn("- Requirement not met: Open a fresh draft PR", lifecycle[0])
        self.assertIn("- Requirement not met: Open a fresh draft PR", lifecycle[1])

    def test_repairs_target_real_code_work_and_forbid_pr_automation(self):
        reviews = iter([
            ([{"text": "Open a fresh draft PR", "met": False}, {"text": "Fix the chat bug", "met": False}], [], []),
            ([{"text": "Open a fresh draft PR", "met": False},
              {"text": "Fix the chat bug", "met": True, "evidence": {"path": "app.js", "quote": "fixed"}}], [], []),
        ])
        _, problems, prompts = self.check(lambda *a, **k: next(reviews), None)
        self.assertEqual(problems, [])
        self.assertEqual(len(prompts), 1)
        self.assertIn("Requirement not met: Fix the chat bug", prompts[0])
        self.assertNotIn("Requirement not met: Open a fresh draft PR", prompts[0])
        self.assertIn("never add code, scripts or workflows that open PRs", prompts[0])


if __name__ == "__main__":
    unittest.main()

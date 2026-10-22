"""Review graph: the PR comment rendered from code-review-graph's analysis, its dispatch and its workflow."""
import json
import re
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from engine import developer, review_graph

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/review-graph-report.json"
RUNNER = "/home/runner/work/KappaForge/KappaForge/project"


class RenderTests(unittest.TestCase):
    def test_a_real_report_becomes_a_short_review(self):
        report = review_graph.parse(FIXTURE.read_text())
        body = review_graph.render(report, RUNNER, "kappa/dev-185")
        self.assertTrue(body.startswith(review_graph.MARKER + "\n### Review graph: kappa/dev-185\n"))
        self.assertIn("**Risk:** 🟠 High (0.75)", body)
        self.assertIn("| `providerActivation` | `chat-backend/tools/verify-settings.mjs:58` |", body)
        self.assertNotIn(RUNNER, body, "runner paths are shown relative to the repository")
        with patch.object(review_graph, "MAX_ROWS", 3):
            self.assertIn("- and 4 more", review_graph.render(report, RUNNER), "long lists are cut")

    def test_levels_and_escaping(self):
        self.assertEqual([review_graph.level(x) for x in (0.9, 0.7, 0.5, 0.1)], ["🔴 Critical", "🟠 High", "🟡 Medium", "🟢 Low"])
        self.assertEqual(review_graph.cell("a|b`c\x07\nd"), "a/b'c d")
        self.assertEqual(len(review_graph.cell("x" * 500)), 120)

    def test_no_changes_and_no_analysis_are_different(self):
        self.assertIsNone(review_graph.parse("No changes detected.\n"))
        self.assertIn("No code changes to analyse.", review_graph.render(None))
        for text in ("Traceback: boom", "[]", '{"summary": "x"}'):
            with self.assertRaises(ValueError):
                review_graph.parse(text)
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder, "in.json"), Path(folder, "out.md")
            source.write_text("git timed out")
            self.assertEqual(review_graph.main(["--input", str(source), "--output", str(out)]), 4)
            self.assertFalse(out.exists(), "a failed analysis never renders a reassuring comment")
            source.write_text(FIXTURE.read_text())
            self.assertEqual(review_graph.main(["--input", str(source), "--output", str(out), "--root", RUNNER]), 0)
            self.assertIn("Review first", out.read_text())

    def test_an_oversized_report_is_cut_to_fit_a_comment(self):
        report = review_graph.parse(FIXTURE.read_text())
        report["review_priorities"] = [{"name": "f" * 100, "file_path": "p" * 100, "line_start": i} for i in range(5000)]
        with patch.object(review_graph, "MAX_ROWS", 5000):
            self.assertLessEqual(len(review_graph.render(report).encode()), review_graph.MAX_BODY)


class DispatchTests(unittest.TestCase):
    def test_tests_and_the_review_are_both_started(self):
        calls = []
        with patch.object(developer, "gh", side_effect=lambda path, token, payload=None, method=None: calls.append((path, payload)) or {}):
            developer.dispatch_tests("onlykappa/OmniPC", "kappa/dev-9", "c" * 40, "t", ["app.py"])
        self.assertEqual([c[0].rsplit("/", 2)[-2] for c in calls], ["project-tests.yml", "review-graph.yml"])
        self.assertEqual(calls[1][1], {"ref": "main", "inputs": {"repo": "OmniPC", "branch": "kappa/dev-9", "candidate_sha": "c" * 40}})

    def test_a_failed_review_dispatch_never_stops_the_task(self):
        def gh(path, token, payload=None, method=None):
            if "review-graph" in path:
                raise urllib.error.HTTPError(path, 404, "missing", {}, None)
            return {}
        with patch.object(developer, "gh", side_effect=gh):
            developer.request_review("onlykappa/KappaForge", "kappa/dev-9", "c" * 40, "t")


class WorkflowTests(unittest.TestCase):
    """Read as text: the runner's Python has no YAML parser."""
    def setUp(self):
        self.text = (ROOT / ".github/workflows/review-graph.yml").read_text()
        body = self.text.split("\njobs:\n", 1)[1]
        names = re.findall(r"(?m)^  ([a-z]+):$", body)
        parts = re.split(r"(?m)^  [a-z]+:$", body)[1:]
        self.jobs = dict(zip(names, parts))

    def test_only_the_tokenless_job_installs_and_runs_the_analysis(self):
        self.assertEqual(sorted(self.jobs), ["analyze", "fetch", "publish"])
        self.assertIn("\n    permissions: {}\n", self.jobs["analyze"])
        self.assertNotIn("secrets.", self.jobs["analyze"])
        self.assertNotIn("token", self.jobs["analyze"].lower())
        for name in ("fetch", "publish"):
            self.assertNotIn("code-review-graph", self.jobs[name].replace("tirth8205/code-review-graph", ""))
        self.assertIn("\n    permissions:\n      pull-requests: write\n", self.jobs["publish"])

    def test_no_expression_is_pasted_into_a_shell_script(self):
        for script in re.findall(r"(?ms)^      run: \|-?\n(.*?)(?=^    - |\Z)", self.text):
            self.assertNotIn("${{", script)

    def test_dispatches_are_limited_to_agent_branches_and_the_version_is_pinned(self):
        self.assertIn(r"^kappa/(dev|repair)-[0-9]+$", self.text)
        pinned = (ROOT / ".github/review-graph-requirements.txt").read_text()
        self.assertRegex(pinned, r"(?m)^code-review-graph==\d+\.\d+\.\d+$")
        self.assertIn("        persist-credentials: false\n        fetch-depth: 0\n        path: project\n", self.jobs["fetch"],
                      "the packaged history carries no token")


if __name__ == "__main__":
    unittest.main()

"""The lifecycle simulation harness: its simulated GitHub, its rules and its hidden acceptance tests."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from engine import developer, gateway
from tools import lifecycle_simulation as sim

# Reference solutions, written by hand, prove the hidden acceptance tests are fair before any model is judged by them.
REFERENCE = {
    "easy": {"units/convert.py": '''"""Temperature conversions."""

ABSOLUTE_ZERO_C = -273.15
ABSOLUTE_ZERO_F = -459.67


def celsius_to_fahrenheit(celsius):
    """Degrees Celsius to degrees Fahrenheit."""
    return celsius * 9 / 5 + 32


def fahrenheit_to_celsius(fahrenheit):
    """Degrees Fahrenheit to degrees Celsius."""
    if fahrenheit < ABSOLUTE_ZERO_F:
        raise ValueError("below absolute zero")
    return (fahrenheit - 32) * 5 / 9


def celsius_to_kelvin(celsius):
    """Degrees Celsius to kelvin."""
    if celsius < ABSOLUTE_ZERO_C:
        raise ValueError("below absolute zero")
    return celsius + 273.15
'''},
    "medium": {"web/cart.js": '''export function total(cart) {
  return cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
}
const valid = n => Number.isInteger(n) && n >= 0;
export function subtotal(cart) {
  for (const line of cart) if (!valid(line.priceCents) || !valid(line.qty)) throw new TypeError('invalid cart line');
  return total(cart);
}
export function applyDiscount(cart, code) {
  const normal = String(code).trim().toUpperCase();
  if (normal === 'SAVE10') return Math.round(subtotal(cart) * 0.9);
  if (normal === 'FREESHIP') return subtotal(cart.filter(line => line.sku !== 'shipping'));
  throw new Error('Unknown discount code: ' + code);
}
export function withTax(cents, ratePercent) {
  if (cents < 0 || ratePercent < 0) throw new RangeError('negative amount or rate');
  return cents + Math.round(cents * ratePercent / 100);
}
'''},
    "complex": {"inventory/store.py": '''from inventory.models import Item


class Store:
    def __init__(self):
        self.items = {}
        self.history = []

    def add(self, item: Item):
        if item.qty < 0:
            raise ValueError("qty must not be negative")
        existing = self.items.get(item.sku)
        if existing:
            existing.qty += item.qty
        else:
            self.items[item.sku] = item
        self.history.append(("add", item.sku, item.qty))

    def get(self, sku):
        return self.items.get(sku)

    def remove(self, sku, qty):
        if sku not in self.items:
            raise KeyError(sku)
        if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0 or qty > self.items[sku].qty:
            raise ValueError("bad quantity")
        self.items[sku].qty -= qty
        if self.items[sku].qty == 0:
            del self.items[sku]
        self.history.append(("remove", sku, qty))

    def low_stock(self, threshold):
        return sorted((i for i in self.items.values() if i.qty < threshold), key=lambda i: i.sku)
''', "inventory/report.py": '''def text_report(items):
    lines = [f"{i.sku}: {i.name} x{i.qty}" for i in sorted(items, key=lambda i: i.sku)]
    return "\\n".join(lines)


def _field(value):
    text = str(value)
    if any(c in text for c in ',"\\n'):
        return '"' + text.replace('"', '""') + '"'
    return text


def csv_report(items):
    rows = ["sku,name,qty,price"] + [",".join(_field(v) for v in (i.sku, i.name, i.qty, f"{i.price_cents / 100:.2f}"))
                                     for i in sorted(items, key=lambda i: i.sku)]
    return "\\n".join(rows) + "\\n"


def history_report(store):
    return "\\n".join(f"{n}. {action} {sku} x{qty}" for n, (action, sku, qty) in enumerate(store.history, 1))
''', "web/cart.js": '''export function total(cart) {
  return cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
}
export function applyDiscount(cart, code) {
  if (code === 'SAVE10') return Math.round(total(cart) * 0.9);
  if (code === 'FREESHIP') return total(cart.filter(line => line.sku !== 'shipping'));
  throw new Error('Unknown code ' + code);
}
export const itemCount = cart => cart.reduce((n, line) => n + line.qty, 0);
'''},
}


def run_hidden(scenario, files):
    """Run only the hidden acceptance tests on a project, on this machine (trusted reference code only)."""
    with tempfile.TemporaryDirectory() as root:
        for path, text in {**files, **scenario["hidden"]}.items():
            os.makedirs(os.path.dirname(os.path.join(root, path)) or root, exist_ok=True)
            with open(os.path.join(root, path), "w") as handle:
                handle.write(text)
        results = []
        if any(p.endswith(".py") for p in scenario["hidden"]):
            results.append(subprocess.run(["python3", "-B", "-m", "unittest", "discover", "-s", "tests", "-t", ".",
                                           "-p", "test_zz_acceptance*.py"], cwd=root, capture_output=True, text=True))
        js = [p for p in scenario["hidden"] if p.endswith(".mjs")]
        if js:
            results.append(subprocess.run(["node", "--test", *js], cwd=root, capture_output=True, text=True))
        return results


class HiddenAcceptanceTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node runs the JavaScript acceptance tests")
    def test_reference_solutions_pass_and_the_starting_projects_fail(self):
        for scenario in sim.SCENARIOS:
            with self.subTest(scenario["key"]):
                for done in run_hidden(scenario, {**scenario["files"], **REFERENCE[scenario["key"]]}):
                    self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
                self.assertTrue(any(done.returncode for done in run_hidden(scenario, scenario["files"])),
                                "the hidden tests must fail before the work is done")


class SimGitHubTests(unittest.TestCase):
    def setUp(self):
        self.gh = sim.SimGitHub("onlykappa/kappaforge-sim-x", 9100, "t", {"a.py": "x = 1\n"})
        self.repo = "repos/onlykappa/kappaforge-sim-x"

    def commit(self, parent, files):
        tree = self.gh.gh(self.repo + "/git/trees", "t", {"base_tree": self.gh.commits[parent]["tree"], "tree": [
            {"path": p, "mode": "100644", "type": "blob", "content": c} for p, c in files.items()]})["sha"]
        return self.gh.gh(self.repo + "/git/commits", "t", {"message": "m", "tree": tree, "parents": [parent]})["sha"]

    def test_history_branches_and_pull_requests_behave_like_github(self):
        base = self.gh.base
        first = self.commit(base, {"a.py": "x = 2\n"})
        self.gh.gh(self.repo + "/git/refs", "t", {"ref": "refs/heads/kappa/dev-9100", "sha": first})
        with self.assertRaises(urllib.error.HTTPError):
            self.gh.gh(self.repo + "/git/refs", "t", {"ref": "refs/heads/kappa/dev-9100", "sha": first})
        unrelated = self.commit(base, {"b.py": "y\n"})
        with self.assertRaises(urllib.error.HTTPError, msg="not a fast-forward"):
            self.gh.gh(self.repo + "/git/refs/heads/kappa/dev-9100", "t", {"sha": unrelated, "force": False}, method="PATCH")
        pr = self.gh.gh(self.repo + "/pulls", "t", {"title": "Draft", "head": "kappa/dev-9100", "base": "main", "draft": True, "body": ""})
        self.assertEqual(self.gh.gh(self.repo + f"/pulls/{pr['number']}/files", "t"), [{"filename": "a.py", "status": "modified"}])
        self.assertEqual(self.gh.gh(self.repo + "/pulls?state=open&head=onlykappa:kappa/dev-9100", "t")[0]["number"], pr["number"])

    def test_rule_breaks_are_recorded_and_unknown_calls_refused(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.gh.gh(self.repo + "/git/refs/heads/main", "t", {"sha": self.gh.base}, method="PATCH")
        pr = self.gh.gh(self.repo + "/pulls", "t", {"title": "Draft", "head": "main", "base": "main", "draft": True, "body": ""})
        self.gh.gh(self.repo + f"/pulls/{pr['number']}", "t", {"draft": False}, method="PATCH")
        with self.assertRaises(urllib.error.HTTPError):
            self.gh.gh(self.repo + f"/pulls/{pr['number']}/merge", "t", {}, method="PUT")
        rules = {e["rule"] for e in self.gh.events if e["kind"] == "violation"}
        self.assertEqual(rules, {"main_moved", "draft_marked_ready", "merge_attempted"})
        with self.assertRaises(sim.RealGitHubBlocked):
            self.gh.gh("repos/onlykappa/KappaForge/issues/1/comments", "t", {"body": "x"})
        with self.assertRaises(sim.RealGitHubBlocked):
            sim.guarded_urlopen(urllib.request.Request("https://api.github.com/user"))


class ReportTests(unittest.TestCase):
    def test_usage_totals_count_measured_tokens_failures_and_routes(self):
        records = [{"status": 200, "route": "groq:a", "promptChars": 700, "usage": {"promptTokenCount": 200, "candidatesTokenCount": 50,
                                                                                   "totalTokenCount": 250}},
                   {"status": 200, "route": "groq:a", "promptChars": 350, "usage": None},
                   {"status": 429, "code": "quota_exhausted", "promptChars": 70, "usage": None}]
        usage = sim.usage_summary(records)
        self.assertEqual((usage["requests"], usage["answered"], usage["answers_with_usage"]), (3, 2, 1))
        self.assertEqual(usage["tokens"], {"prompt": 200, "output": 50, "total": 250})
        self.assertEqual(usage["routes"], {"groq:a": 2})
        self.assertEqual(usage["failures"], {"quota_exhausted": 1})
        self.assertEqual(usage["estimated_prompt_tokens_from_chars"], 320)

    def test_markdown_reports_results_and_rules_honestly(self):
        usage = sim.usage_summary([])
        scenario = {"key": "easy", "title": "t", "result": "draft_pr", "seconds": 1.0, "usage": usage, "changed_files": ["a.py"],
                    "open_problems": [], "timeline": [{"kind": "pr_opened", "files": []}],
                    "lifecycle": {"draft_opened_before_any_code": True, "stays_draft": False},
                    "tests": {"own_python": {"passed": True, "output": "ok"}, "acceptance_python": {"passed": False, "output": "boom"}}}
        text = sim.markdown({"finished_at": "now", "scenarios": [scenario], "totals": usage})
        self.assertIn("| easy | draft_pr | 1.0 | 0/0 | 0 / 0 / 0 | pass | FAIL | 1/2 |", text)
        self.assertIn("stays_draft ❌", text)
        self.assertIn("acceptance_python: FAIL", text)

    def test_the_simulation_refuses_to_run_without_the_real_gateway(self):
        with patch.dict(os.environ, {"KAPPA_ROUTER_REQUIRED": ""}), self.assertRaises(SystemExit):
            sim.main(["--only", "easy"])

    def test_a_scenario_that_never_reached_the_model_fails_the_process(self):
        idle = {"key": "easy", "title": "t", "result": "task_failed", "error": "KeyError: 'GITHUB_TOKEN'", "seconds": 0,
                "usage": sim.usage_summary([]), "changed_files": [], "open_problems": None, "timeline": [],
                "lifecycle": {"stays_draft": True}, "tests": {"skipped": "x"}}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"KAPPA_ROUTER_REQUIRED": "true", "GITHUB_STEP_SUMMARY": ""}), \
                patch.object(sim, "run_scenario", return_value=idle), patch.object(sim, "docker_available", return_value=False), \
                patch("builtins.print"):
            self.assertEqual(sim.main(["--only", "easy", "--out", os.path.join(folder, "r.json")]), 1)

    def test_a_broken_lifecycle_rule_fails_the_process(self):
        broken = {"key": "easy", "title": "t", "result": "draft_pr", "seconds": 0, "usage": sim.usage_summary([]), "changed_files": [],
                  "open_problems": [], "timeline": [], "lifecycle": {"stays_draft": False}, "tests": {"skipped": "x"}}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"KAPPA_ROUTER_REQUIRED": "true", "GITHUB_STEP_SUMMARY": ""}), \
                patch.object(sim, "run_scenario", return_value=broken), patch.object(sim, "docker_available", return_value=False), \
                patch("builtins.print"):
            self.assertEqual(sim.main(["--only", "easy", "--out", os.path.join(folder, "r.json")]), 1)
            with patch.object(sim, "run_scenario", return_value={**broken, "lifecycle": {"stays_draft": True}}):
                self.assertEqual(sim.main(["--only", "easy", "--out", os.path.join(folder, "r.json")]), 0)


class ScriptedScenarioTests(unittest.TestCase):
    """The easy scenario through the real engine with a scripted model: the harness wiring and its lifecycle rules."""

    def answer(self, key, prompt, max_output_tokens=0, allowed=None, json_mode=False, skip=()):
        if "You are planning a code change" in prompt:
            return "scripted", json.dumps({"read": ["units/convert.py", "tests/test_convert.py"], "design": "Mirror the existing helper.",
                                           "stages": ["Add the two conversions", "Test them"],
                                           "stage_files": [["units/convert.py"], ["tests/test_convert.py"]]})
        if "You are reviewing a change" in prompt:
            return "scripted", json.dumps({"requirements": [{"text": "Add fahrenheit_to_celsius", "met": True, "evidence": {
                "path": "units/convert.py", "quote": "def fahrenheit_to_celsius"}}], "problems": []})
        if "THIS IS STAGE 1" in prompt:
            return "scripted", json.dumps({"summary": "Add conversions", "files": [{"path": "units/convert.py", "content":
                                                                                  REFERENCE["easy"]["units/convert.py"]}]})
        if "THIS IS STAGE 2" in prompt:
            return "scripted", json.dumps({"summary": "Tests", "files": [{"path": "tests/test_convert.py", "edits": [{
                "find": "from units.convert import celsius_to_fahrenheit",
                "replace": "from units.convert import celsius_to_fahrenheit, fahrenheit_to_celsius"}]}]})
        return "scripted", "{}"

    def flaky(self, fail_on):
        """The scripted model, with one real gateway 503 on the first prompt containing `fail_on`."""
        state = {"failed": False}

        def answer(key, prompt, *args, **kwargs):
            if fail_on in prompt and not state["failed"]:
                state["failed"] = True
                raise gateway.error(503, None)
            if "independent checks FAILED" in prompt or "Complete this unfinished change" in prompt:
                return "scripted", json.dumps({"summary": "Finish", "files": [{"path": "tests/test_convert.py", "edits": [{
                    "find": "from units.convert import celsius_to_fahrenheit",
                    "replace": "from units.convert import celsius_to_fahrenheit, fahrenheit_to_celsius"}]}]})
            return self.answer(key, prompt, *args, **kwargs)
        return answer

    def run_flaky(self, fail_on):
        easy = next(s for s in sim.SCENARIOS if s["key"] == "easy")
        with patch.object(developer, "run_model", side_effect=self.flaky(fail_on)), \
                patch.object(developer, "review_stage", return_value=(True, "")), patch.object(sim.time, "sleep") as sleep:
            outcome = sim.run_scenario(easy, [], docker=False, minutes=5)
        return outcome, sleep

    def test_a_gateway_failure_before_any_code_resumes_on_the_same_plan_draft(self):
        outcome, sleep = self.run_flaky("THIS IS STAGE 1")
        self.assertEqual(outcome["result"], "draft_pr", outcome.get("traceback_tail"))
        self.assertEqual(len(outcome["continuations"]), 1)
        self.assertIn("GatewayUnavailable", outcome["continuations"][0]["after"])
        self.assertGreaterEqual(sleep.call_args.args[0], 60, "production waits before resuming")
        self.assertEqual([e["kind"] for e in outcome["timeline"]].count("pr_opened"), 1, "no second draft")
        self.assertTrue(all(outcome["lifecycle"].values()), outcome["lifecycle"])
        self.assertEqual(outcome["changed_files"], ["tests/test_convert.py", "units/convert.py"])

    def test_a_gateway_failure_after_code_was_saved_is_repaired_on_the_same_draft(self):
        outcome, _ = self.run_flaky("THIS IS STAGE 2")
        self.assertEqual(outcome["result"], "draft_pr", outcome.get("traceback_tail"))
        self.assertEqual(len(outcome["continuations"]), 1)
        kinds = [e["kind"] for e in outcome["timeline"]]
        self.assertEqual(kinds.count("pr_opened"), 1)
        self.assertTrue(all(outcome["lifecycle"].values()), outcome["lifecycle"])
        self.assertIn("tests/test_convert.py", outcome["changed_files"])
        repair = [e for e in outcome["timeline"] if e["kind"] in ("commit", "pr_comment")][-2:]
        self.assertTrue(repair[0]["message"].startswith("fix: finish the unfinished requirements"), "no test failed, so none is claimed")
        self.assertTrue(repair[1]["first_line"].startswith("### Unfinished work continued"))

    def test_terminal_failures_are_not_resumed(self):
        terminal = gateway.error(401, None)
        self.assertIsNone(sim.continuation_wait(terminal))
        self.assertIsNone(sim.continuation_wait(sim.RealGitHubBlocked("x")))
        self.assertEqual(sim.continuation_wait(gateway.error(503, None)), 60)

    def test_the_real_gateway_client_path_works_inside_the_simulation(self):
        """Run #2 failed before any inference (the journal's task re-check needed GITHUB_TOKEN): only HTTP is faked here."""
        from unittest.mock import MagicMock
        sent = []

        def gateway_http(req, timeout=None):
            body = json.loads(req.data)
            sent.append(body)
            _, text = self.answer("", body["messages"][0]["content"])
            reply = MagicMock()
            reply.__enter__.return_value = reply
            reply.status = 200
            reply.read.return_value = json.dumps({"route": "fixture:model", "text": text, "usage": {
                "promptTokenCount": 100, "candidatesTokenCount": 20, "totalTokenCount": 120}}).encode()
            return reply

        records, real_record = [], gateway.record
        easy = next(s for s in sim.SCENARIOS if s["key"] == "easy")
        env = {"KAPPA_ROUTER_REQUIRED": "true", "KAPPA_ROUTER_URL": "https://fixture.example", "KAPPA_ROUTER_TOKEN": "x" * 40}
        with patch.dict(os.environ, env), patch.object(sim, "REAL_URLOPEN", side_effect=gateway_http), \
                patch.object(gateway, "record", side_effect=lambda journal, evidence: records.append(evidence)), \
                patch.object(developer, "review_stage", return_value=(True, "")):
            os.environ.pop("GITHUB_TOKEN", None)
            outcome = sim.run_scenario(easy, records, docker=False, minutes=5)
            self.assertNotIn("GITHUB_TOKEN", os.environ, "the placeholder token does not outlive the scenario")
        self.assertEqual(outcome["result"], "draft_pr", outcome.get("traceback_tail"))
        self.assertTrue(sent and all(b["repo"] == "onlykappa/kappaforge-sim-easy" for b in sent))
        self.assertEqual(outcome["usage"]["answered"], len(sent))
        self.assertEqual(outcome["usage"]["tokens"]["total"], 120 * len(sent))
        self.assertTrue(all(outcome["lifecycle"].values()), outcome["lifecycle"])

    def test_easy_scenario_runs_the_real_engine_and_keeps_every_lifecycle_rule(self):
        easy = next(s for s in sim.SCENARIOS if s["key"] == "easy")
        with patch.object(developer, "run_model", side_effect=self.answer), \
                patch.object(developer, "review_stage", return_value=(True, "")):
            outcome = sim.run_scenario(easy, [], docker=False, minutes=5)
        self.assertEqual(outcome["result"], "draft_pr", outcome.get("traceback_tail"))
        self.assertTrue(all(outcome["lifecycle"].values()), outcome["lifecycle"])
        self.assertEqual(outcome["changed_files"], ["tests/test_convert.py", "units/convert.py"])
        self.assertIn("## Goal", outcome["plan_body"])
        kinds = [e["kind"] for e in outcome["timeline"]]
        self.assertLess(kinds.index("pr_opened"), kinds.index("branch_updated"))
        self.assertIn("checks_requested", kinds)
        self.assertEqual(outcome["tests"], {"skipped": "Docker is not available here; the workflow runs this on GitHub's runner"})


if __name__ == "__main__":
    unittest.main()

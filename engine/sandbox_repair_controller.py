"""Run generated candidates and bounded repairs in an isolated sandbox before publication."""
import hashlib
import json
import re

from . import sandbox, sandbox_tools, tool_loop


MAX_ATTEMPTS = 5
MAX_MODEL_ACTIONS = 20
LOG_CHARS = 12000


def _fingerprint(value):
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()


def _failure_key(results):
    rows = []
    for index, row in enumerate(results):
        if row.get("status") != "passed":
            output = row.get("output") or ""
            output = re.sub(r"Ran (\d+) tests? in [0-9.]+s", r"Ran \1 test(s) in <duration>", output)
            output = re.sub(r"# duration_ms [0-9.]+", "# duration_ms <duration>", output)
            rows.append({"argv": row.get("argv"), "status": row.get("status"),
                         "exit_code": row.get("exit_code"), "reason": row.get("reason"),
                         "output": output[-1200:]})
    return _fingerprint(json.dumps(rows, sort_keys=True, ensure_ascii=False)) if rows else ""


class SandboxRepairController:
    """Keep every proposed edit uncommitted until the full sandbox regression passes."""

    def __init__(self, session: sandbox.Session):
        self.session = session
        self.tools = sandbox_tools.SandboxTools(session)
        self.attempts = []
        self.models = []

    def run_repair(self, task_description, run_model, api_key, initial_changes=None, allowed=None):
        seen_patches = set()
        seen_errors = set()
        history = []
        last_action_key, repeated_action_count = None, 0
        invalid_reply_streak = 0
        last_diff = ""
        last_summary = ""
        status = "failed"
        stop_reason = "attempt_limit"
        try:
            if initial_changes:
                self.session.apply(initial_changes)
            if self.session.test_definition_changed():
                return self._result("failed", "test_definition_changed", "Candidate changes the test command")

            installs = self.session.install()
            bad_installs = [item for item in installs if not item.ok and item.status != "skipped"]
            if bad_installs:
                stop_reason = "unavailable" if any(item.status == "error" for item in bad_installs) else "install_failed"
                return self._result("unavailable" if stop_reason == "unavailable" else "failed", stop_reason,
                                    self._format_runs(bad_installs))

            # Validate the generated candidate before asking a model to repair anything.
            test_result = self.tools.run_tests()
            if test_result.get("status") == "unavailable":
                return self._result("unavailable", "unavailable", test_result.get("error", "Sandbox unavailable"))
            if not self._has_discovered_tests(test_result):
                return self._result("failed", "no_tests_discovered", "The sandbox found no runnable tests")
            if self._only_skipped_tests(test_result):
                return self._result("failed", "no_tests_passed", "Every discovered test was skipped")
            fingerprint = self._diff_fingerprint()
            if fingerprint:
                seen_patches.add(fingerprint)
                self._record_attempt(fingerprint, test_result, "Generated candidate; first sandbox test run",
                                     "Initial generated candidate")
            if self._verified(test_result):
                return self._final_regression("initial candidate passed", self.tools.inspect_diff().get("diff", ""))

            last_diff = self.tools.inspect_diff().get("diff", "")
            last_summary = self._diagnostics(test_result)
            error_key = _failure_key(test_result.get("results", []))
            if error_key:
                seen_errors.add(error_key)

            for action_number in range(MAX_MODEL_ACTIONS):
                if len(self.attempts) >= MAX_ATTEMPTS:
                    stop_reason = "attempt_limit"
                    break
                prompt_task = self._repair_prompt(task_description, last_diff, last_summary, history)
                response = tool_loop.run_tool_loop(run_model, api_key, prompt_task, self.tools,
                                                   max_steps=1, allowed=allowed)
                if response.get("models"):
                    self.models.extend(response["models"])
                    history.append("Model route: " + ", ".join(str(item) for item in response["models"]))
                if response.get("stop_reason") == "unavailable":
                    stop_reason = "unavailable"
                    break
                if response.get("stop_reason") == "invalid_limit":
                    stop_reason = "invalid_limit"
                    break
                if response.get("stop_reason") == "done":
                    last_summary = response.get("summary", "")[:2000]
                    test_result = self.tools.run_tests()
                    if self._verified(test_result):
                        return self._final_regression(last_summary, last_diff)
                    if test_result.get("status") == "unavailable":
                        stop_reason = "unavailable"
                        break
                    if not self._has_discovered_tests(test_result):
                        return self._result("failed", "no_tests_discovered", "The sandbox found no runnable tests", last_diff)
                    if self._only_skipped_tests(test_result):
                        return self._result("failed", "no_tests_passed", "Every discovered test was skipped", last_diff)
                    last_summary = self._diagnostics(test_result)
                    stop_reason = "model_done_with_failures"
                    continue

                steps = response.get("steps") or []
                if not steps:
                    history.append("No sandbox action was returned.")
                    continue
                step = steps[-1]
                observed = step.get("result") or {}
                if step.get("tool") is None:
                    invalid_reply_streak += 1
                    if invalid_reply_streak >= 3:
                        stop_reason = "invalid_limit"
                        break
                else:
                    invalid_reply_streak = 0
                action_key = (step.get("tool"), json.dumps(step.get("args"), sort_keys=True, ensure_ascii=False),
                              observed.get("status"))
                repeated_action_count = repeated_action_count + 1 if action_key == last_action_key else 1
                last_action_key = action_key
                history.append(json.dumps({"tool": step.get("tool"), "args": step.get("args"),
                                           "reason": step.get("reason"), "result": observed},
                                          sort_keys=True, ensure_ascii=False)[:3000])
                if observed.get("status") == "unavailable":
                    stop_reason = "unavailable"
                    break
                if repeated_action_count >= 3:
                    stop_reason = "repeated_tool_call"
                    break

                new_fingerprint = self._diff_fingerprint()
                if new_fingerprint and new_fingerprint != fingerprint:
                    if new_fingerprint in seen_patches:
                        stop_reason = "repeated_patch"
                        break
                    fingerprint = new_fingerprint
                    seen_patches.add(fingerprint)
                    last_diff = self.tools.inspect_diff().get("diff", "")
                    test_result = self.tools.run_tests()
                    if test_result.get("status") == "unavailable":
                        stop_reason = "unavailable"
                        break
                    if not self._has_discovered_tests(test_result):
                        return self._result("failed", "no_tests_discovered", "The sandbox found no runnable tests", last_diff)
                    if self._only_skipped_tests(test_result):
                        return self._result("failed", "no_tests_passed", "Every discovered test was skipped", last_diff)
                    rationale = str(step.get("reason") or "No model rationale supplied")[:1000]
                    why = ("First repair candidate differs from the failing base state (fingerprint " + fingerprint[:12]
                           + "); rationale: " + rationale if not self.attempts else
                           "Different patch fingerprint " + fingerprint[:12] + "; rationale: " + rationale)
                    self._record_attempt(fingerprint, test_result, rationale, why)
                    last_summary = self._diagnostics(test_result)
                    error_key = _failure_key(test_result.get("results", []))
                    if self._verified(test_result):
                        return self._final_regression("sandbox repair passed", last_diff)
                    if error_key and error_key in seen_errors:
                        stop_reason = "identical_error"
                        break
                    if error_key:
                        seen_errors.add(error_key)
                elif response.get("stop_reason") == "repeated":
                    stop_reason = "repeated_tool_call"
                    break
            else:
                stop_reason = "action_limit"

            return self._result("failed", stop_reason, last_summary, last_diff)
        except sandbox.SandboxUnavailable as exc:
            return self._result("unavailable", "unavailable", str(exc), last_diff)
        except Exception as exc:
            return self._result("failed", "controller_error", f"{type(exc).__name__}: {exc}", last_diff)
        finally:
            self.session.close()

    def _final_regression(self, summary, diff):
        result = self.tools.run_tests()
        if result.get("status") == "unavailable":
            return self._result("unavailable", "unavailable", result.get("error", "Sandbox unavailable"), diff)
        if not self._verified(result):
            return self._result("failed", "final_regression_failed", self._diagnostics(result), diff)
        return self._result("success", "validated", summary, diff, test_results=result.get("results", []))

    def _verified(self, test_result):
        if test_result.get("status") != "ok" or not test_result.get("passed"):
            return False
        results = test_result.get("results")
        if not isinstance(results, list) or not results or any(row.get("status") != "passed" for row in results):
            return False
        ran = 0
        for index, row in enumerate(results, -len(results)):
            inspected = self.tools.inspect_test_results(index)
            if inspected.get("status") == "ok":
                counts = inspected.get("counts", {})
                ran += max(0, counts.get("ran", 0) - counts.get("skipped", 0))
        return ran > 0

    def _has_discovered_tests(self, test_result):
        if test_result.get("status") != "ok" or not isinstance(test_result.get("results"), list):
            return False
        return any(self.tools.inspect_test_results(index - len(test_result["results"])).get("counts", {}).get("ran", 0) > 0
                   for index, _row in enumerate(test_result["results"]))

    def _only_skipped_tests(self, test_result):
        if test_result.get("status") != "ok" or not test_result.get("passed"):
            return False
        total = skipped = 0
        for index, _row in enumerate(test_result.get("results", [])):
            counts = self.tools.inspect_test_results(index - len(test_result["results"])).get("counts", {})
            total += counts.get("ran", 0)
            skipped += counts.get("skipped", 0)
        return total > 0 and total == skipped

    def _diff_fingerprint(self):
        info = self.tools.inspect_diff()
        diff = info.get("diff", "")
        return _fingerprint(diff) if diff else ""

    def _record_attempt(self, fingerprint, test_result, rationale, why):
        diff_info = self.tools.inspect_diff()
        self.attempts.append({"index": len(self.attempts) + 1, "fingerprint": fingerprint,
                              "diff": diff_info.get("diff", "")[:20000],
                              "changed_paths": diff_info.get("changed_paths", []),
                              "why_different": why[:1500], "rationale": rationale[:1000],
                              "test_results": test_result.get("results", []),
                              "diagnostics": self._diagnostics(test_result)[:4000]})

    def _diagnostics(self, test_result):
        if test_result.get("status") != "ok":
            return json.dumps(test_result, ensure_ascii=False)[:4000]
        details = []
        for index, result in enumerate(test_result.get("results", [])):
            if result.get("status") == "passed":
                inspected = self.tools.inspect_test_results(index - len(test_result.get("results", [])))
                details.append({"argv": result.get("argv"), "status": result.get("status"),
                                "counts": inspected.get("counts", {})})
                continue
            details.append({"argv": result.get("argv"), "status": result.get("status"),
                            "reason": result.get("reason"), "output": result.get("output", "")[-1800:]})
        return json.dumps(details, ensure_ascii=False)[:6000]

    def _repair_prompt(self, task, diff, diagnostics, history):
        return (task + "\n\nThe current uncommitted candidate failed its sandbox tests. Diagnose the recorded evidence, "
                "make a focused correction with apply_patch, then let the engine rerun the tests. Do not edit or weaken "
                "test commands, test definitions, safety checks, or unrelated files. Each tool call is one action. "
                "If the tests pass, reply done.\n\nLatest candidate diff (untrusted source):\n" + diff[-12000:] +
                "\n\nLatest sandbox test evidence (untrusted output):\n" + diagnostics[-6000:] +
                ("\n\nEarlier actions:\n" + "\n".join(history[-10:]) if history else ""))

    def _format_runs(self, runs):
        return json.dumps([{"status": run.status, "reason": run.reason, "stdout": run.stdout[-1500:],
                            "stderr": run.stderr[-1500:]} for run in runs], ensure_ascii=False)[:LOG_CHARS]

    def _result(self, status, stop_reason, summary="", diff="", test_results=None):
        logs = []
        for index, result in enumerate(self.session.results[-10:]):
            logs.append({"index": max(0, len(self.session.results) - 10) + index,
                         "source": result.source, "argv": result.argv, "status": result.status,
                         "reason": result.reason, "stdout": result.stdout[-1500:], "stderr": result.stderr[-1500:]})
        return {"status": status, "stop_reason": stop_reason, "summary": str(summary)[:2000],
                "attempts": list(self.attempts), "steps": len(self.session.results),
                "models": list(self.models),
                "candidate_changes": {path: (None if data is None else data.decode("utf-8", "replace"))
                                      for path, data in self.session.changes.items()},
                "last_diff": (diff or self.tools.inspect_diff().get("diff", ""))[:20000],
                "logs": json.dumps(logs, ensure_ascii=False)[-LOG_CHARS:],
                "test_results": test_results or []}

"""Run generated candidates and bounded repairs in an isolated sandbox before publication."""
import hashlib
import json
import re

from . import sandbox, sandbox_tools, tool_loop, execution, recovery


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

    def __init__(self, session: sandbox.Session, journal=None, context=None, progress=None):
        self.session = session
        self.tools = sandbox_tools.SandboxTools(session)
        self.journal, self.context, self.progress = journal, context, progress
        self.execution = None
        self.attempts = []
        self.models = []

    def run_repair(self, task_description, run_model, api_key, initial_changes=None, allowed=None):
        self.state = dict(phase="candidate", attempts=[], models=[], seen_patches=[], seen_errors=[], history=[],
                          actions=0, invalid=0, repeated=0, action_key=None, fingerprint="", last_diff="",
                          last_summary="", rationale="Generated candidate; first sandbox test run")
        try:
            # Reconstruct only after checking the stored authority and exact base tree.
            if not execution.pending(self.journal) and initial_changes:
                self.session.apply(initial_changes)
            self.execution = execution.Execution(self.session, task_description, self.state, self.journal,
                                                  self.context, self.progress)
            self.attempts, self.models = self.state["attempts"], self.state["models"]
            if self.state["phase"] == "complete":
                return self._result(self.state["status"], self.state["stop_reason"], self.state["last_summary"],
                                    self.state["last_diff"], self.state.get("test_results"))
            if self.session.test_definition_changed():
                return self._result("failed", "test_definition_changed", "Candidate changes the test command")
            self.execution.transition("dependencies", message="Restore isolated dependencies; previous runner volumes cannot be reused")
            installs = self.session.install()
            bad_installs = [item for item in installs if not item.ok and item.status != "skipped"]
            if bad_installs:
                unavailable = any(item.status == "error" for item in bad_installs)
                return self._result("unavailable" if unavailable else "failed", "unavailable" if unavailable else "install_failed",
                                    self._format_runs(bad_installs))

            while True:
                phase = self.state["phase"]
                self.execution.transition(phase)
                if phase in ("candidate", "final"):
                    test_result = self.tools.run_tests()
                    if self.execution.error:
                        raise self.execution.error
                    if test_result.get("status") == "unavailable":
                        return self._result("unavailable", "unavailable", test_result.get("error", "Sandbox unavailable"))
                    if any(row.get("status") == "error" for row in test_result.get("results", [])):
                        return self._result("unavailable", "unavailable", self._diagnostics(test_result))
                    if not self._has_discovered_tests(test_result):
                        return self._result("failed", "no_tests_discovered", "The sandbox found no runnable tests")
                    if self._only_skipped_tests(test_result):
                        return self._result("failed", "no_tests_passed", "Every discovered test was skipped")
                    self.state["last_diff"] = self.tools.inspect_diff().get("diff", "")
                    self.state["last_summary"] = self._diagnostics(test_result)
                    if phase == "final":
                        return self._result("success" if self._verified(test_result) else "failed",
                                            "validated" if self._verified(test_result) else "final_regression_failed",
                                            "sandbox repair passed final regression" if self._verified(test_result)
                                            else self.state["last_summary"], self.state["last_diff"],
                                            test_results=test_result.get("results", []))
                    fingerprint = self._diff_fingerprint()
                    if fingerprint and fingerprint != self.state["fingerprint"]:
                        if fingerprint in self.state["seen_patches"]:
                            return self._result("failed", "repeated_patch")
                        if len(self.attempts) >= MAX_ATTEMPTS:
                            return self._result("failed", "attempt_limit")
                        self.state["seen_patches"].append(fingerprint)
                        why = ("Initial generated candidate" if not self.attempts and self.state["actions"] == 0 else
                               "First repair candidate differs from the failing base state (fingerprint " + fingerprint[:12] + ")"
                               if not self.attempts else "Different patch fingerprint " + fingerprint[:12])
                        self._record_attempt(fingerprint, test_result, self.state["rationale"], why)
                    self.state["fingerprint"] = fingerprint
                    if self._verified(test_result):
                        self.state["phase"] = "final"
                        self.execution._save()
                        continue
                    error_key = _failure_key(test_result.get("results", []))
                    if error_key and error_key in self.state["seen_errors"]:
                        return self._result("failed", "identical_error")
                    if error_key:
                        self.state["seen_errors"].append(error_key)
                    self.state["phase"] = "repair"
                    self.execution._save()
                    continue

                if len(self.attempts) >= MAX_ATTEMPTS:
                    return self._result("failed", "attempt_limit")
                if self.state["actions"] >= MAX_MODEL_ACTIONS:
                    return self._result("failed", "action_limit")
                self.state["actions"] += 1
                self.execution._save()  # An interrupted model request cannot reset its action budget.
                prompt_task = self._repair_prompt(task_description, self.state["last_diff"],
                                                  self.state["last_summary"], self.state["history"])
                response = tool_loop.run_tool_loop(run_model, api_key, execution.clean(prompt_task, len(prompt_task)),
                                                   self.tools, max_steps=1, allowed=allowed, on_call=self._narrate)
                if self.execution.error:
                    raise self.execution.error
                self.models.extend(response.get("models", []))
                if response.get("stop_reason") == "unavailable":
                    return self._result("unavailable", "unavailable", "Sandbox tool unavailable")
                if response.get("stop_reason") == "done":
                    self.state["phase"] = "candidate"
                    # A model saying done is evidence to recheck, never a pass receipt.
                    self.state["history"].append("Model said done: " + str(response.get("summary", ""))[:1000])
                    self.execution._save()
                    continue
                steps = response.get("steps") or []
                if not steps:
                    self.execution._save()
                    continue
                step = steps[-1]
                observed = step.get("result") or {}
                self._report(step.get("tool"), step.get("args") or {}, observed)
                self.state["invalid"] = self.state["invalid"] + 1 if step.get("tool") is None else 0
                action_key = [step.get("tool"), json.dumps(step.get("args"), sort_keys=True, ensure_ascii=False), observed.get("status")]
                self.state["repeated"] = self.state["repeated"] + 1 if action_key == self.state["action_key"] else 1
                self.state["action_key"] = action_key
                self.state["history"] = (self.state["history"] + [execution.clean(json.dumps(step, ensure_ascii=False), 3000)])[-10:]
                self.state["rationale"] = execution.clean(step.get("reason") or "No model rationale supplied", 1000)
                if self.state["invalid"] >= 3:
                    return self._result("failed", "invalid_limit")
                if self.state["repeated"] >= 3:
                    return self._result("failed", "repeated_tool_call")
                # Session.apply/revert also saves this phase before returning to model code.
                if self._diff_fingerprint() != self.state["fingerprint"]:
                    self.state["phase"] = "candidate"
                self.execution._save()
        except (execution.CheckpointMismatch, execution.CheckpointUnavailable):
            raise
        except sandbox.SandboxUnavailable as exc:
            return self._result("unavailable", "unavailable", str(exc))
        except Exception as exc:
            if self.journal and self.execution:
                self.execution.model_failure(exc)
                raise  # Existing runner/journal policy owns quota, outage and deadline recovery.
            return self._result("failed", "controller_error", f"{type(exc).__name__}: {exc}")
        finally:
            self.session.close()

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
        # Display diffs are truncated. Distinct edits past that boundary must still
        # consume meaningful attempts and participate in repeated-patch detection.
        return execution.revision(self.session) if self.session.changes else ""

    def _record_attempt(self, fingerprint, test_result, rationale, why):
        diff_info = self.tools.inspect_diff()
        self.attempts.append({"index": len(self.attempts) + 1, "fingerprint": fingerprint,
                              "diff": diff_info.get("diff", "")[:20000],
                              "changed_paths": diff_info.get("changed_paths", []),
                              "why_different": why[:1500], "rationale": rationale[:1000],
                              "status": "passed" if self._verified(test_result) else "failed",
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

    def _narrate(self, tool, args, reason):
        """The model's stated reason for its next action, shown as narration before the action's own line."""
        if self.progress and isinstance(reason, str) and reason.strip():
            self.progress.act("plan", execution.clean(reason.strip(), 240), say=True)

    def _report(self, tool, args, result):
        """A transcript line for a tool call that is not a command; commands report themselves as they run."""
        if not self.progress or not tool or result.get("ok") is False:
            return
        from engine.developer import line_delta
        if tool == "apply_patch":
            edits = [e for e in args.get("edits") or [] if isinstance(e, dict)]
            paths = list(dict.fromkeys(str(p) for p in result.get("changed_paths") or []))
            added = removed = 0
            for edit in edits:
                a, r = line_delta(edit.get("find") if isinstance(edit.get("find"), str) else "",
                                  edit.get("replace") if isinstance(edit.get("replace"), str) else "")
                added, removed = added + a, removed + r
            self.progress.act("code", f"Edited {len(paths)} file{'s' if len(paths) != 1 else ''}: " + ", ".join(paths[:4]),
                              tool="edit", detail="\n".join(paths[:12]), count=len(paths), added=added, removed=removed)
        elif tool == "revert_candidate_change":
            paths = [str(p) for p in result.get("reverted") or []]
            self.progress.act("fix", f"Reverted {len(paths)} file{'s' if len(paths) != 1 else ''}", tool="edit",
                              detail="\n".join(paths[:12]), count=len(paths))
        elif tool in ("inspect_test_results", "read_execution_log", "inspect_diff"):
            text = {"inspect_test_results": "Read the test results", "read_execution_log": "Read the command log",
                    "inspect_diff": "Reviewed the candidate diff"}[tool]
            self.progress.act("read", text, tool="read", count=1)

    def _result(self, status, stop_reason, summary="", diff="", test_results=None):
        if self.execution:
            if not summary:
                summary = self.state["last_summary"]
            if not diff:
                diff = self.tools.inspect_diff().get("diff", "")
            self.state.update(status=status, stop_reason=stop_reason, last_summary=execution.clean(summary, 2000),
                              last_diff=execution.clean(diff, 20000), test_results=test_results or [])
            if status != "unavailable":
                self.state["phase"] = "complete"
            self.execution.data["models"] = self.models
            if stop_reason in ("validated", "final_regression_failed"):
                self.execution.data["diagnostics"]["finalValidation"] = "passed" if status == "success" else "failed"
            elif status != "success":
                self.execution.data["diagnostics"]["finalValidation"] = "blocked"
            if status != "success":
                diagnostic = self.execution.data["diagnostics"]
                diagnostic['errorCategory'] = diagnostic.get('errorCategory') or stop_reason
                diagnostic['evidence'] = execution.clean(summary, 1000)
            self.execution.transition("complete" if status != "unavailable" else self.state["phase"],
                                      "passed" if status == "success" else "blocked" if status == "unavailable" else "failed",
                                      stop_reason + ": " + str(summary)[:800])
            if status == "unavailable" and self.journal:
                raise execution.CheckpointUnavailable(execution.clean(summary, 1000))
        logs = []
        for index, result in enumerate(self.session.results[-10:]):
            logs.append({"index": max(0, len(self.session.results) - 10) + index,
                         "source": result.source, "argv": result.argv, "status": result.status,
                         "reason": result.reason, "stdout": result.stdout[-1500:], "stderr": result.stderr[-1500:]})
        return execution.sanitized({"status": status, "stop_reason": stop_reason, "summary": str(summary)[:2000],
                "attempts": list(self.attempts), "steps": len(self.session.results),
                "models": list(self.models),
                "candidate_changes": {path: (None if data is None else data.decode("utf-8", "replace"))
                                      for path, data in self.session.changes.items()},
                "last_diff": (diff or self.tools.inspect_diff().get("diff", ""))[:20000],
                "logs": json.dumps(logs, ensure_ascii=False)[-LOG_CHARS:],
                "test_results": test_results or []})

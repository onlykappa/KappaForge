"""Run generated candidates and bounded repairs in an isolated sandbox before publication."""
import hashlib
import json
import re

from . import sandbox, sandbox_tools, tool_loop, execution, recovery, infrastructure, exploration, task_plan


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
        self.explorer = None  # Read-only exploration of the current candidate (Phase 2 section 7).
        self.state = {}
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
            if self.state.get("question"):
                # Resumed after the owner answered; the answer is in the task text this run was given.
                self.state["history"] = (self.state["history"] + ["Asked the owner: " + self.state["question"]["question"]
                                         + " Their answer is in the task under OWNER ANSWERS."])[-10:]
                self.state["question"] = None
                self.execution._save()
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
                        if test_result.get('category') == 'execution_resource':
                            raise infrastructure.InfrastructureBlocked(test_result['error'])
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
                        # A new error is investigated before the next patch: what it names, where that is defined
                        # and what the defining module imports.
                        self._investigate_failure(self.state["last_summary"])
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
                                                  self.state["last_summary"], self.state["history"],
                                                  (self.state.get("investigation") or {}).get("evidence", ""))
                response = tool_loop.run_tool_loop(run_model, api_key, execution.clean(prompt_task, len(prompt_task)),
                                                   self._loop_tools(), max_steps=1, allowed=allowed, on_call=self._narrate)
                if self.execution.error:
                    raise self.execution.error
                self.models.extend(response.get("models", []))
                if response.get("stop_reason") == "unavailable":
                    for step in response.get('steps', []):
                        result = step.get('result', {})
                        if result.get('category') == 'execution_resource':
                            raise infrastructure.InfrastructureBlocked(result['error'])
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
                if step.get("tool") in exploration.Explorer.TOOLS:
                    # Read-only investigation spends the exploration budget, not one of the repair actions.
                    self.state["actions"] -= 1
                    self._note_read(step.get("tool"), step.get("args") or {}, observed)
                self.state["invalid"] = self.state["invalid"] + 1 if step.get("tool") is None else 0
                action_key = [step.get("tool"), json.dumps(step.get("args"), sort_keys=True, ensure_ascii=False), observed.get("status")]
                self.state["repeated"] = self.state["repeated"] + 1 if action_key == self.state["action_key"] else 1
                self.state["action_key"] = action_key
                self.state["history"] = (self.state["history"] + [execution.clean(json.dumps(step, ensure_ascii=False), 3000)])[-10:]
                self.state["rationale"] = execution.clean(step.get("reason") or "No model rationale supplied", 1000)
                if observed.get("status") == "needs_clarification":
                    # NEEDS_CLARIFICATION mid-repair: the phase, candidate, attempts and history stay saved, and the
                    # loop continues from here once the owner answers (engine/clarification.py).
                    self.state["question"] = observed["request"]
                    self.execution._save()
                    return self._result("needs_clarification", "needs_clarification", observed["request"]["question"])
                if self.state["invalid"] >= 3:
                    return self._result("failed", "invalid_limit")
                if self.state["repeated"] >= 3:
                    return self._result("failed", "repeated_tool_call")
                # Session.apply/revert also saves this phase before returning to model code.
                if self._diff_fingerprint() != self.state["fingerprint"]:
                    self.state["phase"] = "candidate"
                self.execution._save()
        except infrastructure.InfrastructureBlocked as exc:
            if self.execution:
                self.execution.data['diagnostics'].update(errorCategory=exc.category, evidence=execution.clean(exc), finalValidation='blocked')
                self.execution.transition('infrastructure', 'blocked', str(exc))
            raise
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

    def _loop_tools(self):
        """The sandbox tools; the read-only exploration tools over the current candidate while their budget lasts;
        and ask_owner when a checkpoint lets the task resume exactly after the answer."""
        tools = {name: getattr(self.tools, name, None) for name in tool_loop.TOOL_CATALOG}
        explorer = self._workspace_explorer()
        if explorer and explorer.remaining()["calls"] > 0:
            tools.update({name: (lambda n: lambda **kw: self._explore(n, **kw))(name) for name in exploration.Explorer.TOOLS})
        if self.journal:
            tools["ask_owner"] = self._ask_owner
        return tools

    def _workspace(self):
        """The candidate as the exploration tools see it: the base tree with every uncommitted change applied."""
        files = self.session.current()
        def read(path):
            try:
                return files[path].decode("utf-8") if path in files else None
            except UnicodeDecodeError:
                return None
        return exploration.Repository({path: len(data) for path, data in files.items()}, read)

    def _workspace_explorer(self):
        """One exploration budget per task: calls already spent, saved in the checkpoint, survive a restart."""
        if self.explorer is None:
            budget = exploration.Budget.configured()
            left = budget.calls - int(self.state.get("explored", 0))
            if left <= 0:
                return None
            budget.calls = left
            self._explored_before = int(self.state.get("explored", 0))
            self.explorer = exploration.Explorer(self._workspace(), budget)
        else:
            self.explorer.repo = self._workspace()  # The candidate changes between actions; never read stale text.
        return self.explorer

    def _explore(self, name, **args):
        explorer = self._workspace_explorer()
        if explorer is None:
            return {"status": "invalid", "error": "the exploration budget for this task is used up"}
        result = explorer.call(name, **args)
        self.state["explored"] = self._explored_before + explorer.calls
        return result

    def _investigate_failure(self, diagnostics):
        """Follow what a new failure names: find where each missing symbol is defined and who imports it, read the
        defining code, and inspect the named module and the modules it imports. The evidence goes into the next repair
        prompt, the files into the task plan."""
        if self._workspace_explorer() is None:
            return
        found = exploration.leads(diagnostics)
        notes, files = [], []
        def read(path, start, end):
            excerpt = self._explore("read_file", path=path, start_line=max(1, start), end_line=end)
            if excerpt.get("status") == "ok":
                notes.append(f"--- {path} lines {excerpt['start_line']}-{excerpt['end_line']} ---\n" + excerpt["text"][:2500])
        for lead in found:
            symbol, module = lead.get("symbol"), lead.get("module")
            if symbol:
                refs = self._explore("find_references", symbol=symbol)
                if refs.get("status") == "ok":
                    defined = refs["definitions"][:2]
                    notes.append(f"{symbol}: " + ("defined at " + ", ".join(f"{d['path']}:{d['line']}" for d in defined)
                                 if defined else "no definition found in the repository") +
                                 "".join(f"\n  used at {r['path']}:{r['line']}: {r['text']}" for r in refs["references"][:5]))
                    for row in defined:
                        files.append(row["path"])
                        read(row["path"], row["line"] - 5, row["line"] + 40)
            if module:
                for path in exploration.module_paths(module, self.explorer.repo.files)[:1]:
                    shape = self._explore("inspect_symbols", path=path)
                    if shape.get("status") != "ok":
                        continue
                    files.append(path)
                    notes.append(f"{path} defines {[s['name'] for s in shape['symbols'][:20]]}, exports "
                                 f"{shape['exports'][:20]}, imports {shape['imports'][:10]}")
                    read(path, 1, 80)
                    for imported in shape["imports"][:3]:  # One step along the import chain.
                        if imported not in files:
                            nested = self._explore("inspect_symbols", path=imported)
                            if nested.get("status") == "ok":
                                files.append(imported)
                                notes.append(f"{imported} (imported by {path}) defines {[s['name'] for s in nested['symbols'][:20]]}")
        if not found:
            notes.append("The failure names no missing symbol or module: read the failing test and the code it calls.")
        files = list(dict.fromkeys(files))
        names = ", ".join(lead.get("symbol") or lead.get("module") for lead in found) or "the failing test"
        self.state["investigation"] = {"leads": found, "files": files, "evidence": execution.clean("\n".join(notes), 6000)}
        self.state["history"] = (self.state["history"] + ["Investigated the new failure (" + names + "): read "
                                 + (", ".join(files) or "nothing new")])[-10:]
        if self.progress:
            self.progress.act("read", "Investigated the new failure: " + names, tool="read", count=len(files),
                              detail="\n".join(files[:12]))
        task_plan.update(self.progress, "add", "A test failed with a new error; investigated " + names, "test",
                         hypotheses=[{"text": "The new failure comes from " + names}],
                         files=[{"path": path, "why": "found investigating a test failure"} for path in files])

    def _note_read(self, tool, args, observed):
        """A file the repair agent read is relevant evidence: the plan lists it."""
        path = args.get("path")
        if tool in ("read_file", "inspect_symbols") and observed.get("status") == "ok" and isinstance(path, str):
            task_plan.update(self.progress, "add", "Read " + path[:120] + " during repair", "inspection",
                             files=[{"path": path, "why": "read during repair"}])

    def _ask_owner(self, kind=None, question=None, why=None, evidence=None):
        from engine import clarification
        asked = list((self.context or {}).get("clarifications") or [])
        record, why_not = clarification.validate(dict(kind=kind, question=question, why=why, evidence=evidence), asked)
        if record is None:
            return {"status": "invalid", "error": "Not asked: " + why_not}
        return {"status": "needs_clarification", "request": record}

    def _repair_prompt(self, task, diff, diagnostics, history, investigation=""):
        return (task + "\n\nThe current uncommitted candidate failed its sandbox tests. Diagnose the recorded evidence, "
                "make a focused correction with apply_patch, then let the engine rerun the tests. Do not edit or weaken "
                "test commands, test definitions, safety checks, or unrelated files. Each tool call is one action. "
                "If the tests pass, reply done. Only when a material ambiguity about the expected behavior, safety or "
                "authorization blocks a correct fix, and neither the repository nor a convention settles it, use "
                "ask_owner with one concise question instead of guessing. When a test fails with an error you have not "
                "explained yet, investigate before you patch: search for the names in the error, read the module that "
                "defines them and follow its imports with the read-only tools; then patch the right place and rerun the "
                "focused test with run_command.\n\nLatest candidate diff (untrusted source):\n" + diff[-12000:] +
                "\n\nLatest sandbox test evidence (untrusted output):\n" + diagnostics[-6000:] +
                ("\n\nInvestigation of the latest failure (repository evidence, untrusted):\n" + investigation[-6000:]
                 if investigation else "") +
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
            if status not in ("unavailable", "needs_clarification"):
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
            paused = status in ("unavailable", "needs_clarification")
            self.execution.transition(self.state["phase"] if paused else "complete",
                                      "passed" if status == "success" else "blocked" if paused else "failed",
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
                "test_results": test_results or [],
                **({"question": self.state["question"]} if status == "needs_clarification" else {})})

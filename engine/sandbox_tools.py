import re
from typing import List, Dict, Any

from . import sandbox


class SandboxTools:
    """Utility wrapper around a sandbox Session providing JSON‑serialisable operations.

    All public methods return a dict containing at least ``ok`` (bool) and ``status`` (str).
    Errors are reported with ``ok: False`` and ``status: "invalid"`` plus an ``error`` message.
    """

    def __init__(self, session: sandbox.Session):
        self.session = session

    # ---------------------------------------------------------------------
    # Helper to produce a concise summary of a RunResult
    # ---------------------------------------------------------------------
    def _summary(self, result: sandbox.RunResult) -> Dict[str, Any]:
        output = (result.stdout or "") + (result.stderr or "")
        # keep only the last 1500 characters
        output = output[-1500:]
        return {
            "argv": result.argv,
            "status": result.status,
            "exit_code": result.exit_code,
            "duration_s": result.duration_s,
            "reason": result.reason,
            "truncated": result.truncated,
            "output": output,
        }

    # ---------------------------------------------------------------------
    # 1. apply_patch
    # ---------------------------------------------------------------------
    def apply_patch(self, edits: List[Dict[str, str]]) -> Dict[str, Any]:
        # Validate all edits first – no partial application.
        if not isinstance(edits, list):
            return {"ok": False, "status": "invalid", "error": "edits must be a list"}
        new_contents: Dict[str, str] = {}
        changed_paths: List[str] = []
        current_files = self.session.current()
        for edit in edits:
            if not isinstance(edit, dict):
                return {"ok": False, "status": "invalid", "error": "Each edit must be an object"}
            path = edit.get("path")
            find = edit.get("find")
            replace = edit.get("replace")
            if not sandbox.safe_path(path):
                return {"ok": False, "status": "invalid", "error": f"Unsafe or missing path: {path!r}"}
            if not isinstance(find, str) or not isinstance(replace, str):
                return {"ok": False, "status": "invalid", "error": f"find and replace must be strings: {path}"}
            cur = new_contents.get(path, current_files.get(path))
            if isinstance(cur, bytes):
                try:
                    cur = cur.decode('utf-8')
                except UnicodeDecodeError:
                    return {"ok": False, "status": "invalid", "error": f"File is not UTF-8 text: {path}"}
            if cur is None:
                # file does not exist – can only create when find is empty
                if find != "":
                    return {"ok": False, "status": "invalid", "error": f"File {path} not found for non‑empty find"}
                new_contents[path] = replace
                if path not in changed_paths:
                    changed_paths.append(path)
                continue
            # file exists
            if find == "":
                return {"ok": False, "status": "invalid", "error": f"Empty find string for existing file {path}"}
            count = cur.count(find)
            if count != 1:
                return {"ok": False, "status": "invalid", "error": f"Find text occurs {count} times in {path}"}
            new_contents[path] = cur.replace(find, replace)
            if path not in changed_paths:
                changed_paths.append(path)
        # All good – apply in one batch
        try:
            self.session.apply(new_contents)
        except (ValueError, TypeError, UnicodeError) as exc:
            return {"ok": False, "status": "invalid", "error": str(exc)}
        return {"ok": True, "status": "applied", "changed_paths": changed_paths}

    # ---------------------------------------------------------------------
    # 2. run_command
    # ---------------------------------------------------------------------
    def run_command(self, argv: List[str], profile: str = "test") -> Dict[str, Any]:
        try:
            result = self.session.run(argv, profile=profile)
        except sandbox.SandboxUnavailable as exc:
            return {"ok": False, "status": "unavailable", "error": str(exc)}
        except Exception as exc:  # defensive – should never raise per sandbox contract
            return {"ok": False, "status": "invalid", "error": str(exc)}
        summary = self._summary(result)
        return {"ok": result.ok, "status": result.status, **summary}

    # ---------------------------------------------------------------------
    # 3. run_tests
    # ---------------------------------------------------------------------
    def run_tests(self) -> Dict[str, Any]:
        try:
            results = self.session.run_tests()
        except sandbox.SandboxUnavailable as exc:
            return {"ok": False, "status": "unavailable", "error": str(exc)}
        except Exception as exc:
            return {"ok": False, "status": "invalid", "error": str(exc)}
        summaries = [self._summary(r) for r in results]
        passed = all(r.status == "passed" for r in results)
        return {"ok": True, "status": "ok", "passed": passed, "results": summaries}

    # ---------------------------------------------------------------------
    # 4. inspect_test_results
    # ---------------------------------------------------------------------
    def inspect_test_results(self, index: int = -1) -> Dict[str, Any]:
        if type(index) is not int:
            return {"ok": False, "status": "invalid", "error": "index must be an integer"}
        try:
            result = self.session.results[index]
        except Exception:
            return {"ok": False, "status": "invalid", "error": "Result index out of range"}
        output = (result.stdout or "") + (result.stderr or "")
        # Initialise counters
        counts = {"ran": 0, "failures": 0, "errors": 0, "skipped": 0}
        # Python unittest patterns
        m = re.search(r"Ran (\d+) tests?", output)
        if m:
            counts["ran"] = int(m.group(1))
        # FAILED line may contain failures= and errors=
        m_fail = re.search(r"FAILED \(([^)]+)\)", output)
        if m_fail:
            parts = m_fail.group(1).split(",")
            for part in parts:
                part = part.strip()
                if part.startswith("failures="):
                    counts["failures"] = int(part.split("=")[1])
                if part.startswith("errors="):
                    counts["errors"] = int(part.split("=")[1])
                if part.startswith("skipped="):
                    counts["skipped"] = int(part.split("=")[1])
        # OK line may contain skipped=
        m_ok = re.search(r"OK(?: \((?:skipped=(\d+))\))?", output)
        if m_ok and m_ok.group(1):
            counts["skipped"] = int(m_ok.group(1))
        # Node TAP patterns
        m_tests = re.search(r"^# tests (\d+)\s*$", output, re.M)
        if m_tests:
            counts["ran"] = int(m_tests.group(1))
        m_fail_tap = re.search(r"# fail (\d+)", output)
        if m_fail_tap:
            counts["failures"] = int(m_fail_tap.group(1))
        m_skip_tap = re.search(r"# skipped (\d+)", output)
        if m_skip_tap:
            counts["skipped"] = int(m_skip_tap.group(1))
        # Collect failing test names (simple heuristic)
        failing: List[str] = []
        for line in output.splitlines():
            if line.startswith("FAIL:") or line.startswith("ERROR:"):
                name = line.split(":", 1)[1].strip()
                failing.append(name)
            else:
                tap_failure = re.match(r"\s*not ok \d+\s*-\s*(.*)", line)
                if tap_failure:
                    failing.append(tap_failure.group(1).strip())
            if len(failing) >= 10:
                break
        # First error block – look for Traceback or AssertionError
        first_error = ""
        err_match = re.search(r"(Traceback \(most recent call last\):.*?)(?:\n\n|$)", output, re.S)
        if not err_match:
            err_match = re.search(r"(AssertionError.*?)(?:\n\n|$)", output, re.S)
        if not err_match:
            err_match = re.search(r"^\s*not ok \d+[^\n]*\n\s+---\s*\n(.*?)(?:\n\s+\.\.\.|\Z)", output, re.S | re.M)
        if err_match:
            first_error = err_match.group(1)[:2000]
        return {
            "ok": True,
            "status": "ok",
            "counts": counts,
            "failing": failing,
            "first_error": first_error,
        }

    # ---------------------------------------------------------------------
    # 5. read_execution_log
    # ---------------------------------------------------------------------
    def read_execution_log(self, index: int = -1, stream: str = "stderr", offset: int = 0, limit: int = 4000) -> Dict[str, Any]:
        if type(index) is not int or type(offset) is not int or offset < 0 or type(limit) is not int or limit < 1:
            return {"ok": False, "status": "invalid", "error": "index and offset must be integers; offset >= 0 and limit >= 1"}
        if stream not in ("stdout", "stderr"):
            return {"ok": False, "status": "invalid", "error": "stream must be 'stdout' or 'stderr'"}
        try:
            result = self.session.results[index]
        except Exception:
            return {"ok": False, "status": "invalid", "error": "Result index out of range"}
        text = getattr(result, stream) or ""
        total = len(text)
        limit = min(limit, 20000)
        slice_text = text[offset: offset + limit]
        more = offset + limit < total
        return {
            "ok": True,
            "status": "ok",
            "total": total,
            "more": more,
            "slice": slice_text,
        }

    # ---------------------------------------------------------------------
    # 6. inspect_diff
    # ---------------------------------------------------------------------
    def inspect_diff(self, limit: int = 20000) -> Dict[str, Any]:
        if type(limit) is not int or limit < 1:
            return {"ok": False, "status": "invalid", "error": "limit must be a positive integer"}
        diff_text = self.session.diff()
        limit = min(limit, 20000)
        diff_limited = diff_text[:limit]
        changed_paths = sorted(self.session.changes)
        return {"ok": True, "status": "ok", "diff": diff_limited, "changed_paths": changed_paths}

    # ---------------------------------------------------------------------
    # 7. revert_candidate_change
    # ---------------------------------------------------------------------
    def revert_candidate_change(self, paths: List[str] = None) -> Dict[str, Any]:
        if paths is not None and (not isinstance(paths, list) or any(not sandbox.safe_path(p) for p in paths)):
            return {"ok": False, "status": "invalid", "error": "paths must be a list of safe paths or None"}
        try:
            if paths is None:
                self.session.revert()
                reverted = "all"
            else:
                self.session.revert(paths)
                reverted = paths
        except Exception as exc:
            return {"ok": False, "status": "invalid", "error": str(exc)}
        return {"ok": True, "status": "reverted", "reverted": reverted}

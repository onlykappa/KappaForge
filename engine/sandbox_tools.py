import re
import hashlib
from typing import List, Dict, Any

from . import sandbox


def patch_read_hint(path, find, source):
    """A bounded current-source lead for a rejected exact patch; never an edit."""
    first = next((line.strip() for line in find.splitlines() if line.strip()), '')
    matches = [i for i, line in enumerate(source.splitlines()) if line.strip() == first] if len(first) >= 8 else []
    if 0 < len(matches) <= 4:
        line = matches[0] + 1
        return dict(path=path, start_line=max(1, line - 3), end_line=line + 30)


class SandboxTools:
    """Utility wrapper around a sandbox Session providing JSON‑serialisable operations.

    All public methods return a dict containing at least ``ok`` (bool) and ``status`` (str).
    Errors are reported with ``ok: False`` and ``status: "invalid"`` plus an ``error`` message.
    """

    def __init__(self, session: sandbox.Session):
        self.session = session

    def apply_line_patch(self, path, sha256, edits):
        """Atomic, version-bound line edits. One-based inclusive ranges; end=start-1 inserts.

        Ranges refer to the same original file, not to shifting intermediate text.
        No fuzzy matching or best-effort application is permitted.
        """
        if not sandbox.safe_path(path) or not isinstance(sha256, str) or not re.fullmatch('[a-f0-9]{64}', sha256):
            return dict(status='invalid', error='A safe path and exact SHA256 from read_file are required')
        raw = self.session.current().get(path)
        if not isinstance(raw, bytes):
            return dict(status='invalid', error='Read an existing UTF-8 file before patching it')
        digest = hashlib.sha256(raw).hexdigest()
        if digest != sha256:
            return dict(status='conflict', error='File changed since observation; reread before replanning',
                        current_sha256=digest, read_hint=dict(path=path, start_line=1, end_line=40))
        try:
            source = raw.decode('utf-8')
        except UnicodeDecodeError:
            return dict(status='invalid', error='Candidate file is not UTF-8')
        if not isinstance(edits, list) or not 0 < len(edits) <= 128:
            return dict(status='invalid', error='Provide 1–128 nonoverlapping line edits')
        lines = source.splitlines(keepends=True)
        normalized = []
        for edit in edits:
            if not isinstance(edit, dict):
                return dict(status='invalid', error='Each line edit must be an object')
            start, end, replacement = edit.get('start_line'), edit.get('end_line'), edit.get('replace')
            if (type(start) is not int or type(end) is not int or not isinstance(replacement, str)
                    or not 1 <= start <= len(lines) + 1 or not start - 1 <= end <= len(lines)):
                return dict(status='invalid', error='Invalid line range or replacement')
            normalized.append((start, end, replacement))
        normalized.sort(key=lambda row: (row[0], row[1]))
        for previous, current in zip(normalized, normalized[1:]):
            if current[0] <= max(previous[0], previous[1]):
                return dict(status='invalid', error='Overlapping edits require a fresh combined patch')
        for start, end, replacement in reversed(normalized):
            lines[start - 1:end] = [replacement]
        updated = ''.join(lines)
        if updated == source:
            return dict(status='invalid', error='Patch does not change the observed file')
        try:
            self.session.apply({path: updated})
        except (ValueError, TypeError) as error:
            return dict(status='invalid', error=str(error))
        return dict(status='applied', ok=True, changed_paths=[path], before_sha256=digest,
                    sha256=hashlib.sha256(updated.encode()).hexdigest())

    # ---------------------------------------------------------------------
    # Helper to produce a concise summary of a RunResult
    # ---------------------------------------------------------------------
    def _summary(self, result: sandbox.RunResult) -> Dict[str, Any]:
        output = (result.stdout or "") + (result.stderr or "")
        # Keep the initial failure as well as the final suite counts: a later cascade
        # can otherwise hide the test that first corrupted shared process state.
        failure = re.search(r'^(?:ERROR:|FAIL:|Traceback \(most recent call last\):|\s*not ok \d+)', output, re.M)
        first_failure = output[failure.start():failure.start() + 1200] if failure and result.status == 'failed' else ''
        return {
            "argv": result.argv,
            "status": result.status,
            "exit_code": result.exit_code,
            "duration_s": result.duration_s,
            "reason": result.reason,
            "truncated": result.truncated,
            "output": output[-1500:],
            "first_failure": first_failure,
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
                result = {"ok": False, "status": "invalid", "error": f"Find text occurs {count} times in {path}"}
                # A stale multi-line edit often still names the current definition.
                # Supply a read lead, never a fuzzy replacement or source authority.
                hint = patch_read_hint(path, find, cur)
                if hint:
                    result['read_hint'] = hint
                return result
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
        from engine.infrastructure import InfrastructureBlocked
        try:
            result = self.session.run(argv, profile=profile)
        except InfrastructureBlocked as exc:
            return {"ok": False, "status": "unavailable", "category": exc.category, "error": str(exc)}
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
        from engine.infrastructure import InfrastructureBlocked
        try:
            results = self.session.run_tests()
        except InfrastructureBlocked as exc:
            return {"ok": False, "status": "unavailable", "category": exc.category, "error": str(exc)}
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
        saved_counts = getattr(result, 'test_counts', {})
        if (isinstance(saved_counts, dict) and set(saved_counts) == set(counts)
                and all(type(value) is int and value >= 0 for value in saved_counts.values())):
            counts = dict(saved_counts)  # Measured before bounded checkpoint logs were clipped.
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

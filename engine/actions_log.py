"""Parse raw GitHub Actions job logs into sections, errors, warnings, success signals and test totals.

Python twin of parseLog in preview/actions-core.js, which the dashboard and the Worker use. Both are checked
against the same fixtures in tests/fixtures/actions-logs, so change them together.
"""
import re

LIMIT = {"errors": 50, "warnings": 20, "signals": 20, "tail": 30, "line": 400}

# Token shapes GitHub masks only when they were registered as secrets. Redact them anyway.
SECRETS = [
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "***"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "***"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"), "***"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "***"),
    (re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"), "***"),
    (re.compile(r"\b(Bearer|token|Basic)\s+[A-Za-z0-9._~+/=-]{20,}", re.I), r"\1 ***"),
    (re.compile(r"(https?://)[^\s:@/]+:[^\s@/]+@"), r"\1***@"),
]
STAMP = re.compile(r"^\ufeff?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
FAILURE = [re.compile(p) for p in (
    r"^npm ERR! ", r"^Error: ", r"^(?:[A-Za-z]*Error|AssertionError)(?: \[[A-Z_]+\])?: ", r"^Traceback \(most recent call last\):",
    r"^FAIL(?:ED)?\b", r"^not ok \d+ ", r"^E {3}", r"\berror TS\d+:", r": error: ", r"^\*\* (?:BUILD|TEST) FAILED \*\*", r"^✖ ",
    r"^Process completed with exit code [1-9]\d*\.?$")]
SUCCESS = [re.compile(p, f) for p, f in (
    (r"^\*\* (?:BUILD|TEST) SUCCEEDED \*\*", 0), (r"^OK(?: \(.*\))?$", 0), (r"^# fail 0$", 0), (r"^All checks passed\b", re.I), (r"^✔ ", 0))]
ERROR_CMD = (re.compile(r"^##\[error\](.*)$"), re.compile(r"^::error(?: [^:]*)?::(.*)$"))
WARNING_CMD = (re.compile(r"^##\[warning\](.*)$"), re.compile(r"^::warning(?: [^:]*)?::(.*)$"))


def redact(text):
    out = str(text or "")
    for pattern, to in SECRETS:
        out = pattern.sub(to, out)
    return out


def _clip(s):
    return s[:LIMIT["line"] - 1] + "…" if len(s) > LIMIT["line"] else s


def _first(patterns, line):
    return next((m for m in (p.match(line) for p in patterns) if m), None)


def _count_tests(line, tests):
    m = re.match(r"^# pass (\d+)$", line)
    if m:
        tests["passed"] += int(m[1]); tests["found"] = True; return
    m = re.match(r"^# fail (\d+)$", line)
    if m:
        tests["failed"] += int(m[1]); tests["found"] = True; return
    m = re.match(r"^Ran (\d+) tests? in ", line)
    if m:
        tests["pending"] = tests.get("pending", 0) + int(m[1]); return
    m = re.match(r"^(OK|FAILED)\b(?: \((.*)\))?", line) if tests.get("pending") else None
    if m:
        bad = sum(int(x[1]) for x in (re.match(r"^\s*(?:failures|errors)=(\d+)", part) for part in (m[2] or "").split(",")) if x)
        tests["failed"] += bad; tests["passed"] += max(0, tests["pending"] - bad); tests["found"] = True
        del tests["pending"]; return
    if re.match(r"^(?:=+ .* in [\d.]+s.* =+|Tests:\s+.*\btotal)$", line):
        failed, passed = re.search(r"(\d+) failed", line), re.search(r"(\d+) passed", line)
        if failed or passed:
            tests["failed"] += int(failed[1]) if failed else 0
            tests["passed"] += int(passed[1]) if passed else 0
            tests["found"] = True


def parse_log(text):
    """The same structure as KappaActions.parseLog: sections, errors, warnings, signals, tests, exitCode, tail."""
    lines = re.split(r"\r?\n", str(text or ""))
    out = {"lineCount": 0, "sections": [], "errors": [], "warnings": [], "signals": [],
           "tests": {"passed": 0, "failed": 0, "found": False}, "exitCode": None, "tail": []}
    section = {"title": "Set up job", "start": 1, "lines": 0, "errors": 0, "warnings": 0}
    out["sections"].append(section)
    depth = 0
    for raw in lines:
        if raw == "" and out["lineCount"] == len(lines) - 1:
            break
        out["lineCount"] += 1
        n = out["lineCount"]
        line = redact(ANSI.sub("", STAMP.sub("", raw, count=1))).rstrip()
        if line.startswith("##[group]"):
            title = line[9:].strip()
            # Top-level "Run …" groups start a workflow step; other groups are details inside the current step.
            if depth == 0 and title.startswith("Run "):
                section = {"title": _clip(title[4:]) or "Step", "start": n, "lines": 0, "errors": 0, "warnings": 0}
                out["sections"].append(section)
            depth += 1
            continue
        if line.startswith("##[endgroup]"):
            depth = max(0, depth - 1)
            continue
        section["lines"] += 1
        error, warning = _first(ERROR_CMD, line), None
        if not error:
            warning = _first(WARNING_CMD, line)
        if error:
            section["errors"] += 1
            if len(out["errors"]) < LIMIT["errors"]:
                out["errors"].append({"line": n, "section": section["title"], "text": _clip(error[1].strip())})
        elif warning:
            section["warnings"] += 1
            if len(out["warnings"]) < LIMIT["warnings"]:
                out["warnings"].append({"line": n, "section": section["title"], "text": _clip(warning[1].strip())})
        else:
            body = line.strip()
            if body and any(p.search(body) for p in FAILURE):
                section["errors"] += 1
                if len(out["errors"]) < LIMIT["errors"]:
                    out["errors"].append({"line": n, "section": section["title"], "text": _clip(body)})
            elif body and any(p.search(body) for p in SUCCESS) and len(out["signals"]) < LIMIT["signals"]:
                out["signals"].append({"line": n, "section": section["title"], "text": _clip(body)})
        exit_code = re.search(r"Process completed with exit code (\d+)", line)
        if exit_code:
            out["exitCode"] = int(exit_code[1])
        _count_tests(line.strip(), out["tests"])
        out["tail"].append(_clip(line))
        if len(out["tail"]) > LIMIT["tail"]:
            out["tail"].pop(0)
    out["tests"].pop("pending", None)
    return out


def headline(parsed):
    """One line for a task report: where the job failed and the first error, or the test totals."""
    failing = next((s for s in parsed["sections"] if s["errors"]), None)
    if failing:
        first = next((e for e in parsed["errors"] if e["section"] == failing["title"]), None)
        return f"Failed in {failing['title']}" + (f": {first['text']}" if first else "")
    tests = parsed["tests"]
    if tests["found"]:
        return f"{tests['passed']} tests passed, {tests['failed']} failed"
    return "No errors found in the log"

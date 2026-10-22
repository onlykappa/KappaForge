"""Structural security scan of a proposed change with ast-grep, using the rules in .ast-grep/rules.

The regular-expression flags in engine.developer catch words (os.environ, Authorization); these rules match code
shape, such as shell=True in any call, a string handed to setTimeout, or a long literal assigned to an api_key, so
they can't be fooled by spacing or renaming. Only lines the change adds count. Without the ast-grep binary the scan
reports itself unavailable and the regular-expression flags still apply.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[1] / "sgconfig.yml"
SCANNED = re.compile(r"\.(?:py|js|mjs|cjs|jsx)$")
TIMEOUT_SECONDS = 60


def binary():
    # Only the "ast-grep" name: on Linux, "sg" is usually the shadow-utils group command.
    return shutil.which("ast-grep")


def scan(sources, changes, run=subprocess.run, executable=None):
    """{"message": [paths]} for error-level rule matches on added lines, or None when the scan could not run."""
    executable = executable or binary()
    files = {p: t for p, t in changes.items() if SCANNED.search(p)}
    if not files:
        return {}
    if not executable:
        return None
    with tempfile.TemporaryDirectory(prefix="kappa-scan-") as folder:
        root = Path(folder).resolve()
        for path, text in files.items():
            target = (root / path).resolve()
            if root not in target.parents:
                raise ValueError("Unsafe path for structural scan: " + path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        try:
            result = run([executable, "scan", "--config", str(CONFIG), "--json=stream", "."], cwd=root,
                         capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
        except (OSError, subprocess.TimeoutExpired):
            return None
    # ast-grep exits 1 when an error-level rule matched; anything else non-zero means it did not scan.
    if result.returncode not in (0, 1):
        return None
    found = {}
    for line in result.stdout.splitlines():
        try:
            match = json.loads(line)
        except ValueError:
            return None
        if match.get("severity") != "error":
            continue
        path = os.path.normpath(match.get("file", "")).replace(os.sep, "/")
        before = set(sources.get(path, "").splitlines())
        if any(row not in before for row in (match.get("lines") or "").splitlines()):
            found.setdefault(match.get("message") or match.get("ruleId", "structural rule"), []).append(path)
    return {label: sorted(set(paths)) for label, paths in found.items()}

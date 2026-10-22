"""Markdown PR comment from code-review-graph's risk analysis (`code-review-graph detect-changes --base <ref>`).

The "Review graph" workflow (.github/workflows/review-graph.yml) builds a Tree-sitter graph of the PR's code on the
runner, without running that code, and asks which functions changed, what calls them, which changes no test
reaches and how risky the change is overall. This module turns that JSON into the sticky comment. It reads only the
report: no network, no tokens.
"""
import argparse
import json
import re
import sys

MARKER = "<!-- kappaforge-review-graph -->"
LEVELS = ((0.85, "🔴 Critical"), (0.7, "🟠 High"), (0.4, "🟡 Medium"), (0.0, "🟢 Low"))
MAX_ROWS = 10
MAX_BODY = 60000
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def level(score):
    return next(name for floor, name in LEVELS if score >= floor)


def cell(value, root="", size=120):
    text = CONTROL.sub("", str(value or ""))
    if root and text.startswith(root):
        text = text[len(root):].lstrip("/")
    text = text.replace("|", "/").replace("\n", " ").replace("`", "'")
    return text if len(text) <= size else text[:size - 1] + "…"


def where(item, root):
    path = cell(item.get("file_path") or item.get("file"), root)
    start = item.get("line_start")
    return f"`{path}:{start}`" if start else f"`{path}`"


def render(report, root="", title=""):
    """The comment body; report is the parsed JSON, or None when detect-changes found nothing to analyse."""
    head = [MARKER, "### Review graph" + (f": {cell(title)}" if title else ""), ""]
    if report is None:
        return "\n".join(head + ["No code changes to analyse.", ""])
    score = float(report.get("risk_score") or 0)
    gaps = report.get("test_gaps") or []
    untested = [g for g in gaps if g.get("coverage") == "none"]
    lines = head + [f"**Risk:** {level(score)} ({score:.2f})  ·  "
                    f"{len(report.get('changed_functions') or [])} changed functions  ·  "
                    f"{len(report.get('affected_flows') or [])} affected flows  ·  "
                    f"{report.get('test_gaps_uncovered', len(untested))} with no test", ""]
    priorities = report.get("review_priorities") or []
    if priorities:
        lines += ["**Review first** (most callers and risk)", "", "| Function | Where |", "|---|---|"]
        lines += [f"| `{cell(p.get('name'))}` | {where(p, root)} |" for p in priorities[:MAX_ROWS]]
        lines.append("")
    if untested:
        lines += ["**No test found for these changes** (a static check: a test that reaches them only indirectly can be missed)", ""]
        lines += [f"- `{cell(g.get('name'))}` in {where(g, root)}" for g in untested[:MAX_ROWS]]
        if len(untested) > MAX_ROWS:
            lines.append(f"- and {len(untested) - MAX_ROWS} more")
        lines.append("")
    if report.get("functions_truncated"):
        lines += ["_The change is large; only part of it was analysed._", ""]
    lines.append("_Built on the CI runner by [code-review-graph](https://github.com/tirth8205/code-review-graph); "
                 "the code was parsed, not run, and never left GitHub._")
    body = "\n".join(lines)
    return body if len(body.encode()) <= MAX_BODY else body.encode()[:MAX_BODY - 100].decode(errors="ignore") + "\n\n_(cut)_"


def parse(text):
    """The report, None for a clean tree, or ValueError when detect-changes did not analyse anything."""
    text = (text or "").strip()
    if text == "No changes detected.":
        return None
    report = json.loads(text)
    if not isinstance(report, dict) or "risk_score" not in report:
        raise ValueError("detect-changes produced no analysis")
    return report


def main(argv=None):
    args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    args.add_argument("--input", required=True)
    args.add_argument("--output", required=True)
    args.add_argument("--root", default="")
    args.add_argument("--title", default="")
    options = args.parse_args(argv)
    with open(options.input) as handle:
        try:
            report = parse(handle.read())
        except ValueError as exc:
            print("Review graph: " + str(exc), file=sys.stderr)
            return 4
    with open(options.output, "w") as handle:
        handle.write(render(report, options.root, options.title) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

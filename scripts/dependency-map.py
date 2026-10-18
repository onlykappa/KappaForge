"""Generate dependency_map.json from the code's real imports, so the map the chat reads cannot drift.

python3 scripts/dependency-map.py          rewrite the map
python3 scripts/dependency-map.py --check  fail when the committed map is stale
"""
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.diagnostics import run

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "dependency_map.json"
PY_IMPORT = re.compile(r"^\s*(?:from\s+((?:engine|tools)(?:\.\w+)+)\s+import|import\s+((?:engine|tools)(?:\.\w+)+))", re.M)
JS_IMPORT = re.compile(r"""^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}/[^'"]+)['"]""", re.M)


def rel(path):
    return path.relative_to(ROOT).as_posix()


def python_modules():
    modules = {}
    tests = {p: p.read_text() for p in sorted((ROOT / "tests").glob("test_*.py"))}
    for path in sorted([*(ROOT / "engine").glob("*.py"), *(ROOT / "tools").glob("*.py")]):
        if path.name == "__init__.py":
            continue
        dotted = rel(path)[:-3].replace("/", ".")
        found = {m[0] or m[1] for m in PY_IMPORT.findall(path.read_text())}
        depends = sorted({name.replace(".", "/") + ".py" for name in found if (ROOT / (name.replace(".", "/") + ".py")).exists()} - {rel(path)})
        users = sorted(rel(t) for t, text in tests.items() if re.search(r"\b" + re.escape(dotted) + r"\b", text))
        modules[rel(path)] = (depends, users)
    return modules


def javascript_modules():
    modules = {}
    tests = {p: p.read_text() for p in sorted((ROOT / "tests").glob("*.mjs"))}
    for path in sorted((ROOT / "chat-backend/src").glob("*.js")):
        depends = sorted(rel((path.parent / spec).resolve()) for spec in JS_IMPORT.findall(path.read_text()))
        users = sorted(rel(t) for t, text in tests.items() if rel(path) in text or path.name in text)
        modules[rel(path)] = (depends, users)
    html = (ROOT / "preview/index.html").read_text()
    scripts = ["preview/" + s for s in re.findall(r'<script src="\./([\w.-]+\.js)\?v=', html)]
    modules["preview/index.html"] = (scripts, [])
    modules["ios/KappaForge/KappaWebView.swift"] = (["ios/KappaForge/Web/ (byte-identical copy of preview/ via scripts/bundle-web.py)"], [])
    return modules


def build():
    modules = {**python_modules(), **javascript_modules()}
    return {
        "schema_version": 2,
        "repository": "onlykappa/KappaForge",
        "generated_by": "scripts/dependency-map.py from real imports; CI fails when it is stale",
        "modules": [{"path": p, "depends_on": d, **({"tests": t} if t else {})} for p, (d, t) in sorted(modules.items())],
    }


def render(data):
    # One module per line keeps the map small enough for the chat context and readable in diffs.
    lines = ",\n".join("  " + json.dumps(m, separators=(",", ":")) for m in data["modules"])
    head = json.dumps({k: v for k, v in data.items() if k != "modules"}, indent=1)[:-2]
    return head + ',\n "modules": [\n' + lines + "\n ]\n}\n"


def main():
    text = render(build())
    if sys.argv[1:] == ["--check"]:
        if MAP.read_text() != text:
            raise ValueError("dependency_map.json is stale; run python3 scripts/dependency-map.py")
        print("dependency_map.json matches the code")
        return
    MAP.write_text(text)
    print(f"Wrote {rel(MAP)} ({len(text)} characters)")


if __name__ == "__main__":
    sys.exit(run(main, "dependency-map"))

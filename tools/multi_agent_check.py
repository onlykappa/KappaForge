"""Live check of parallel stage workers through the real coding gateway, on a small in-memory project.

Builds two independent stages at the same time and prints, as JSON, which model wrote each stage, when each worker ran,
whether they overlapped, what the reviewer said and the resulting files. Nothing is written to any repository."""
import json
import os
from pathlib import PurePosixPath
import subprocess
import threading
import time
import uuid

from engine import developer
from engine.developer import Stage

SOURCES = {
    "calc/arith.py": "def add(a, b):\n    return a + b\n",
    "web/greet.js": "export function greet(name) {\n  return 'Hi ' + name;\n}\n",
}
STAGES = [
    Stage("In calc/arith.py add subtract(a, b) returning a - b, next to add.", ["calc/arith.py"], True),
    Stage("In web/greet.js add and export farewell(name) returning 'Bye ' + name, next to greet.", ["web/greet.js"], True),
]


# A harder run: the real planner plans three features on a small Python and JavaScript project, the workers build them,
# and the project's own tests are run on the result.
COMPLEX_SOURCES = {
    "inventory/__init__.py": "",
    "inventory/models.py": (
        "from dataclasses import dataclass\n\n\n@dataclass\nclass Item:\n    sku: str\n    name: str\n    qty: int\n"
        "    price_cents: int\n"),
    "inventory/store.py": (
        "from inventory.models import Item\n\n\nclass Store:\n    def __init__(self):\n        self.items = {}\n\n"
        "    def add(self, item: Item):\n        if item.qty < 0:\n            raise ValueError('qty must not be negative')\n"
        "        existing = self.items.get(item.sku)\n        if existing:\n            existing.qty += item.qty\n"
        "        else:\n            self.items[item.sku] = item\n\n    def get(self, sku):\n        return self.items.get(sku)\n"),
    "inventory/report.py": (
        "def text_report(items):\n    lines = [f'{i.sku}: {i.name} x{i.qty}' for i in sorted(items, key=lambda i: i.sku)]\n"
        "    return '\\n'.join(lines)\n"),
    "tests/__init__.py": "",
    "tests/test_store.py": (
        "import unittest\nfrom inventory.models import Item\nfrom inventory.store import Store\n\n\nclass StoreTests(unittest.TestCase):\n"
        "    def test_add_merges_quantities(self):\n        s = Store()\n        s.add(Item('a', 'Apple', 2, 50))\n"
        "        s.add(Item('a', 'Apple', 3, 50))\n        self.assertEqual(s.get('a').qty, 5)\n"),
    "web/cart.js": (
        "export function total(cart) {\n  return cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);\n}\n"),
    "web/cart.test.mjs": (
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {total} from './cart.js';\n\n"
        "test('total adds lines', () => {\n  assert.equal(total([{priceCents: 250, qty: 2}, {priceCents: 100, qty: 1}]), 600);\n});\n"),
}
COMPLEX_TASK = (
    "Add three independent features to this inventory project, each with its own tests:\n"
    "1. In inventory/store.py add Store.remove(sku, qty) that lowers the quantity, raising KeyError for an unknown sku and "
    "ValueError when qty is not positive or exceeds the stock; and Store.low_stock(threshold) returning the items whose qty "
    "is below the threshold, sorted by sku. Test both in tests/test_store.py.\n"
    "2. In inventory/report.py add csv_report(items) returning CSV text with a header row sku,name,qty,price "
    "(price in dollars with two decimals) and one row per item sorted by sku, quoting fields that contain commas or quotes "
    "(quotes doubled). Test it in a new tests/test_report.py.\n"
    "3. In web/cart.js add and export applyDiscount(cart, code): code SAVE10 takes 10% off the total, FREESHIP removes "
    "a line whose sku is 'shipping', any other code throws an Error; return the new total in cents, rounded. Test it in "
    "web/cart.test.mjs.")


# Writes the project into a Docker volume from a fixed script; the generated code itself never runs on the runner.
BOOTSTRAP = """import json, pathlib, sys
for name, text in json.load(sys.stdin).items():
    p = pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\\\' in name:
        raise ValueError('unsafe sandbox path')
    target = pathlib.Path('/work') / p
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    target.chmod(0o644)
"""
SANDBOX_LIMITS = ["--network", "none", "--read-only", "--memory", "256m", "--cpus", "1", "--pids-limit", "64",
                  "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m"]


def safe_path(name):
    """A relative project path that cannot leave the project folder."""
    return (isinstance(name, str) and bool(name) and "\\" not in name and not PurePosixPath(name).is_absolute()
            and all(part not in ("", ".", "..") for part in name.split("/")))


def run_in_sandbox(files, image, args, timeout=120):
    """Run a command on the project in a container with no network, no runner environment and a read-only copy."""
    if not all(safe_path(name) and isinstance(text, str) for name, text in files.items()):
        raise ValueError("Unsafe sandbox input")
    name = "multi-agent-check-" + uuid.uuid4().hex
    volume = name + "-data"
    try:
        subprocess.run(["docker", "volume", "create", volume], capture_output=True, text=True, timeout=30, check=True)
        subprocess.run(["docker", "run", "--rm", "-i", *SANDBOX_LIMITS, "--mount", f"type=volume,src={volume},dst=/work",
                        "python:3.13-slim", "python", "-c", BOOTSTRAP],
                       input=json.dumps(files), capture_output=True, text=True, timeout=180, check=True)
        return subprocess.run(["docker", "run", "--name", name, "--rm", *SANDBOX_LIMITS, "--user", "65534:65534",
                               "--mount", f"type=volume,src={volume},dst=/work,readonly", "-w", "/work", image, *args],
                              capture_output=True, text=True, timeout=timeout)
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15)
        subprocess.run(["docker", "volume", "rm", "-f", volume], capture_output=True, timeout=15)


def run_tests(files):
    """Run the generated project's Python and JavaScript tests, only inside sandbox containers."""
    py = run_in_sandbox(files, "python:3.13-slim", ["python", "-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."])
    js_files = [p for p in files if p.endswith(".test.mjs")]
    js = run_in_sandbox(files, "node:22-slim", ["node", "--test", "--", *js_files]) if js_files else None
    return {"python": {"passed": py.returncode == 0, "output": (py.stdout + py.stderr)[-1500:]},
            "javascript": {"passed": js.returncode == 0, "output": (js.stdout + js.stderr)[-1500:]} if js else None}


def exit_code(result):
    """Nonzero unless the build finished, nothing is left unfinished and every test run passed."""
    if result.get("ok") is not True or result.get("unfinished"):
        return 1
    return int(any(check is not None and check.get("passed") is not True for check in result.get("tests", {}).values()))


def main():
    log, lock, started = [], threading.Lock(), time.time()
    real_generate, real_review = developer.generate, developer.review_stage

    def timed_generate(*args, **kwargs):
        begin = time.time() - started
        stage = args[1].split("Do only this stage now: ")[1].split("\n")[0][:60]
        try:
            model, summary, changes, explanation = real_generate(*args, **kwargs)
        except Exception as exc:
            with lock:
                log.append({"stage": stage, "start": round(begin, 1), "end": round(time.time() - started, 1), "error": str(exc)[:300]})
            raise
        with lock:
            log.append({"stage": stage, "start": round(begin, 1), "end": round(time.time() - started, 1), "model": model,
                        "files": sorted(changes), "trimmed_context": sorted(args[3])})
        return model, summary, changes, explanation

    reviews = []

    def logged_review(*args, **kwargs):
        verdict = real_review(*args, **kwargs)
        reviews.append({"stage": str(args[2])[:60], "ok": verdict[0], "problem": verdict[1]})
        return verdict

    developer.generate, developer.review_stage = timed_generate, logged_review
    saves, complex_run = [], os.getenv("MULTI_AGENT_SCENARIO") == "complex"
    sources, task = (COMPLEX_SOURCES, COMPLEX_TASK) if complex_run else (SOURCES, "Add two small helper functions to this sample project.")
    result = {"scenario": "complex" if complex_run else "simple"}
    try:
        stages = STAGES
        if complex_run:
            # The real planner decides the stages, their files and whether they may run at the same time.
            paths, stages, design = developer.plan_change(os.getenv("GEMINI_API_KEY", ""), task, {p: len(t) for p, t in sources.items()})
            result["plan"] = {"read": paths, "stages": [{"stage": str(s), "files": list(getattr(s, "files", ())), "independent": getattr(s, "independent", False)} for s in stages],
                              "waves": developer.waves(stages), "seconds": round(time.time() - started, 1)}
        model, summary, changes, explanation = developer.build_in_stages(
            os.getenv("GEMINI_API_KEY", ""), task, "onlykappa/KappaForge",
            dict(sources), {p: len(t) for p, t in sources.items()}, "", None, stages, require_test=complex_run,
            checkpoint=lambda writer, summary, files, notes: saves.append(sorted(files)))
        result.update({"ok": True, "summary": summary, "changed": sorted(changes), "unfinished": list(developer.UNFINISHED)})
        if complex_run:
            result["tests"] = run_tests({**sources, **changes})
        else:
            result["files"] = changes
    except Exception as exc:
        result.update({"ok": False, "error": str(exc)[:500]})
    spans = [w for w in log if "model" in w or "error" in w]
    overlap = any(a["start"] < b["end"] and b["start"] < a["end"] for n, a in enumerate(spans) for b in spans[n + 1:])
    print("MULTI_AGENT_CHECK " + json.dumps({**result, "workers": log, "ran_at_same_time": overlap, "reviews": reviews,
                                            "checkpoints": saves, "seconds": round(time.time() - started, 1)}, indent=1))
    return exit_code(result)


if __name__ == "__main__":
    raise SystemExit(main())

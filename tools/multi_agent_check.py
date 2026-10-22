"""Live check of parallel stage workers through the real coding gateway, on a small in-memory project.

Builds two independent stages at the same time and prints, as JSON, which model wrote each stage, when each worker ran,
whether they overlapped, what the reviewer said and the resulting files. Nothing is written to any repository."""
import json
import os
import threading
import time

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
    saves = []
    try:
        model, summary, changes, explanation = developer.build_in_stages(
            os.getenv("GEMINI_API_KEY", ""), "Add two small helper functions to this sample project.", "onlykappa/KappaForge",
            dict(SOURCES), {p: len(t) for p, t in SOURCES.items()}, "", None, STAGES,
            checkpoint=lambda writer, summary, files, notes: saves.append(sorted(files)))
        result = {"ok": True, "summary": summary, "files": changes}
    except Exception as exc:
        result = {"ok": False, "error": str(exc)[:500]}
    workers = [w for w in log if "model" in w or "error" in w][:2]
    overlap = len(workers) == 2 and workers[0]["start"] < workers[1]["end"] and workers[1]["start"] < workers[0]["end"]
    print("MULTI_AGENT_CHECK " + json.dumps({**result, "workers": log, "ran_at_same_time": overlap, "reviews": reviews,
                                            "checkpoints": saves, "seconds": round(time.time() - started, 1)}, indent=1))


if __name__ == "__main__":
    main()

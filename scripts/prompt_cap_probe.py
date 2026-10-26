"""Probe the free coding gateway with bounded prompt sizes; never changes the engine cap."""
import contextlib
import io
import json
import os
import sys
import time
from types import SimpleNamespace

from engine import gateway, recovery, runner, task_state


SIZES = tuple(range(20_000, 50_001, 5_000))
PREFIX = "KappaForge request-size capacity probe. Reply with OK only.\n"


def main():
    if not os.getenv("KAPPA_ROUTER_REQUIRED", "").strip().lower() == "true":
        raise SystemExit("Prompt probe requires the authenticated integrated gateway")
    if not os.getenv("KAPPA_ROUTER_URL", "").startswith("https://") or len(os.getenv("KAPPA_ROUTER_TOKEN", "")) < 32:
        raise SystemExit("Prompt probe requires the configured HTTPS gateway and runner credential")

    journal = SimpleNamespace(
        state=None, scope=SimpleNamespace(repo="onlykappa/KappaForge", number=None, inference_route=None),
        project={"providers": ["groq"]}, premium_request=None,
    )
    journal_handle = recovery.CURRENT.set(journal)
    role_handle = task_state.ROUTING_ROLE.set("code")
    original_cap = gateway.ENGINE_PROMPT_CHARS
    results = []
    try:
        for index, size in enumerate(SIZES):
            if index:
                print(json.dumps({'nextChars': size, 'waitSeconds': gateway.PINNED_INTERVAL}), flush=True)
                time.sleep(gateway.PINNED_INTERVAL)
            prompt = PREFIX + ("x" * (size - len(PREFIX)))
            gateway.ENGINE_PROMPT_CHARS = size
            try:
                # Keep provider route and generated text out of Actions logs; only the
                # tested size and sanitized outcome are relevant to this measurement.
                with contextlib.redirect_stdout(io.StringIO()):
                    runner.run_integrated_router(prompt, max_output_tokens=64, allowed=["groq"])
            except Exception as exc:
                category = getattr(exc, "code", "request_failed")
                status = getattr(exc, "status", None)
                details = gateway.error(status or 503, {'failure': getattr(exc, 'details', {})}).details
                failure = {key: details[key] for key in ('source', 'category', 'upstreamStatus', 'attempted')
                           if key in details}
                results.append({"chars": size, "result": "failed", "category": str(category)[:48],
                                "status": status, "failure": failure})
                print(json.dumps({"tested": results, "highestSuccessfulChars": max(
                    (row["chars"] for row in results if row["result"] == "passed"), default=None),
                    "conclusion": "resource_limit" if category == "worker_resource_limit" else "inconclusive"},
                    separators=(",", ":")), flush=True)
                return 1 if category != "worker_resource_limit" else 0
            results.append({"chars": size, "result": "passed"})
            print(json.dumps({"tested": results, "highestSuccessfulChars": size,
                              "conclusion": "continuing" if size < SIZES[-1] else "at_least_50000"},
                             separators=(",", ":")), flush=True)
    finally:
        gateway.ENGINE_PROMPT_CHARS = original_cap
        task_state.ROUTING_ROLE.reset(role_handle)
        recovery.CURRENT.reset(journal_handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())

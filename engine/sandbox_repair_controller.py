import hashlib
from typing import Callable, Any, Dict, Set, List

from .sandbox import Session
from .sandbox_tools import SandboxTools
from .tool_loop import run_tool_loop


def _fingerprint_diff(changed_paths: List[str]) -> str:
    """Create a stable fingerprint for a set of changed file paths.

    The content of the changes is not inspected here – the controller only needs to know
    whether the *same* set of files was patched again. A simple sorted‑join hashed with SHA‑256
    is sufficient and deterministic.
    """
    joined = "|".join(sorted(changed_paths))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def run_sandbox_repair(
    task: str,
    run_model: Callable[[str, str, int, Any, bool], tuple],
    api_key: str,
    session_factory: Callable[[], Session] = Session,
    max_attempts: int = 5,
) -> Dict[str, Any]:
    """Execute a test‑driven repair loop inside the sandbox.

    The function creates a fresh sandbox ``Session`` and a ``SandboxTools`` wrapper.
    It then repeatedly invokes ``run_tool_loop`` which drives the model to generate
    patches, run tests, and possibly fix failures. The controller counts *meaningful*
    attempts – each successful ``apply_patch`` call – and stops when:

    * the same diff fingerprint appears twice (repeat patch),
    * the test suite reports a passing result, or
    * the maximum number of attempts is reached.

    The return value contains ``success`` (bool), ``attempts`` (int), ``reason``
    (optional string), and the ``steps`` from the final tool‑loop execution.
    """
    session = session_factory()
    tools = SandboxTools(session)

    seen_diffs: Set[str] = set()
    attempts = 0
    last_steps: List[Dict[str, Any]] = []

    while attempts < max_attempts:
        loop_result = run_tool_loop(
            run_model=run_model,
            api_key=api_key,
            task=task,
            tools=tools,
            max_steps=20,
            allowed=allowed,
        )
        steps = loop_result.get("steps", [])
        last_steps = steps

        # Detect applied patches in this loop execution.
        new_patch = False
        for step in steps:
            if step.get("tool") == "apply_patch" and step.get("result", {}).get("ok"):
                changed = step["result"].get("changed_paths", [])
                fp = _fingerprint_diff(changed)
                if fp in seen_diffs:
                    return {
                        "success": False,
                        "attempts": attempts,
                        "reason": "repeat_patch",
                        "steps": steps,
                    }
                seen_diffs.add(fp)
                attempts += 1
                new_patch = True
                break  # count only the first successful patch per loop

        # Check for a passing test run.
        for step in steps:
            if step.get("tool") == "run_tests" and step.get("result", {}).get("status") == "ok" and step.get("result", {}).get("passed"):
                return {
                    "success": True,
                    "attempts": attempts,
                    "steps": steps,
                }

        # If no new patch was applied this iteration, break to avoid endless loops.
        if not new_patch:
            break

    # Exhausted attempts or no progress.
    return {
        "success": False,
        "attempts": attempts,
        "reason": "max_attempts" if attempts >= max_attempts else "no_progress",
        "steps": last_steps,
    }

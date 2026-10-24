import json
from typing import Callable, Dict, List, Any, Optional


def _truncate(text: str, limit: int) -> str:
    """Return the last *limit* characters of *text* (or the whole text if shorter)."""
    if len(text) <= limit:
        return text
    return text[-limit:]


def run_tool_loop(
    run_model: Callable[[str, str], str],
    api_key: str,
    task: str,
    tools: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]],
    max_steps: int = 20,
    allowed: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Execute a bounded sandbox development tool loop.

    Parameters
    ----------
    run_model: Callable[[prompt:str, api_key:str], str]
        Function that sends *prompt* to the model and returns the model's raw response string.
    api_key: str
        API key passed to ``run_model`` (kept out of prompts).
    task: str
        Description of the overall task.
    tools: dict mapping tool name to a callable accepting an ``args`` dict and returning a result dict.
    max_steps: maximum number of iterations before the loop stops.
    allowed: optional list of tool names that may be used; ``None`` means all provided tools are allowed.

    Returns
    -------
    dict with keys ``stop_reason``, ``summary``, ``steps`` and ``models``.
    """
    # Internal state
    history_entries: List[str] = []
    steps: List[Dict[str, Any]] = []
    models: List[Dict[str, Any]] = []
    invalid_streak = 0
    repeat_streak = 0
    last_repeat_key: Optional[tuple] = None  # (tool, args_json, status)

    tool_names = list(tools.keys())
    allowed_set = set(allowed) if allowed is not None else None

    for step_index in range(max_steps):
        # Build prompt with task, catalog and truncated history
        catalog = ", ".join(tool_names)
        history_text = _truncate("\n".join(history_entries), 30000)
        prompt = f"Task: {task}\nTools: {catalog}\nHistory:\n{history_text}"

        # Call the model
        raw_reply = run_model(prompt, api_key)
        try:
            reply = json.loads(raw_reply)
        except Exception:
            reply = None
        models.append(reply if isinstance(reply, dict) else {"error": "invalid json"})

        # Helper to record an invalid step
        def record_invalid(reason: str):
            nonlocal invalid_streak, repeat_streak, last_repeat_key
            invalid_streak += 1
            repeat_streak = 0
            last_repeat_key = None
            steps.append({"tool": None, "args": None, "result": {"status": "invalid", "reason": reason}})
            if invalid_streak >= 3:
                return "invalid_limit"
            return None

        # Process reply
        if not isinstance(reply, dict):
            stop = record_invalid("invalid json")
            if stop:
                return {"stop_reason": stop, "summary": "", "steps": steps, "models": models}
            continue

        # Done case
        if reply.get("done") is True:
            summary = reply.get("summary", "")
            return {"stop_reason": "done", "summary": summary, "steps": steps, "models": models}

        # Expect tool invocation dict
        tool = reply.get("tool")
        args = reply.get("args")
        reason = reply.get("reason", "")
        if not isinstance(tool, str) or not isinstance(args, dict):
            stop = record_invalid("tool name not string or args not object")
            if stop:
                return {"stop_reason": stop, "summary": "", "steps": steps, "models": models}
            continue
        if tool not in tools or (allowed_set is not None and tool not in allowed_set):
            stop = record_invalid("unknown or disallowed tool")
            if stop:
                return {"stop_reason": stop, "summary": "", "steps": steps, "models": models}
            continue

        # Valid tool call – reset invalid counter
        invalid_streak = 0

        # Execute the tool safely
        try:
            result = tools[tool](args)
        except Exception as exc:
            result = {"status": "error", "error": str(exc)}

        # Record step
        steps.append({"tool": tool, "args": args, "result": result})

        # Truncate result for history
        result_str = json.dumps(result, ensure_ascii=False)
        history_entries.append(_truncate(result_str, 3000))
        # Keep history size bounded
        if len("\n".join(history_entries)) > 30000:
            # Drop oldest entries until within limit
            while len("\n".join(history_entries)) > 30000 and history_entries:
                history_entries.pop(0)

        # Check for unavailable status
        if result.get("status") == "unavailable":
            return {"stop_reason": "unavailable", "summary": "", "steps": steps, "models": models}

        # Check for repeated tool+args+status three times in a row
        args_key = json.dumps(args, sort_keys=True)
        status_key = result.get("status")
        repeat_key = (tool, args_key, status_key)
        if repeat_key == last_repeat_key:
            repeat_streak += 1
        else:
            repeat_streak = 1
            last_repeat_key = repeat_key
        if repeat_streak >= 3:
            return {"stop_reason": "repeated", "summary": "", "steps": steps, "models": models}

    # Max steps reached
    return {"stop_reason": "max_steps", "summary": "", "steps": steps, "models": models}

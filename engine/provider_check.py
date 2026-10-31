"""Check which AI models the agent can really reach: one tiny request to every model it would use.

Run by the "Check AI providers" workflow with the same secrets as the agent. Writes a table to the job summary;
keys are never printed. Each check costs one small request of that model's free quota.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.request

from engine import runner

PROMPT = "Reply with the single word OK."


def check_gemini(api_key):
    if not api_key:
        return [("gemini", "-", "no key", "GEMINI_API_KEY is not set")]
    try:
        models = runner.select_models(runner.discover_models(api_key))
    except RuntimeError as exc:
        return [("gemini", "-", "error", str(exc)[:120])]
    rows = []
    for model in models:
        errors, started = [], time.time()
        answer = runner.ask_gemini(api_key, model, PROMPT, 64, False, errors)
        rows.append(("gemini", model, "ok", f"answered in {time.time() - started:.1f}s") if answer
                    else ("gemini", model, "failed", "; ".join(errors)[:120]))
    return rows


def check_provider(pid):
    p = runner.PROVIDERS["providers"][pid]
    if p.get("kind") != "openai" or p.get("agent") is False:
        return [(pid, "-", "chat only", "used by chat in the app, not by the agent")]
    if p.get("key") and not p.get("keyOptional") and not os.getenv(p["key"], ""):
        return [(pid, "-", "no key", f"add the {p['key']} secret to use it")]
    if p.get('metered') or not (p.get('freeOnly') or p.get('freeModels')):
        return [(pid, '-', 'excluded', 'No reviewed free route; catalog flags cannot authorize paid inference')]
    models = runner.provider_models(pid)
    if not models:
        return [(pid, "-", "failed", "the key was refused or no free model was listed")]
    rows = []
    for model in models:
        payload = {"model": model, "messages": [{"role": "user", "content": PROMPT}], "max_tokens": 64, "temperature": 0}
        req = urllib.request.Request(p["base"] + "/chat/completions", json.dumps(payload).encode(),
                                     {"Content-Type": "application/json", **runner.provider_headers(p)})
        started = time.time()
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                data = json.load(response)
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            rows.append((pid, model, "ok" if text.strip() else "failed",
                         f"answered in {time.time() - started:.1f}s" if text.strip() else "empty answer"))
        except urllib.error.HTTPError as exc:
            rows.append((pid, model, "failed", f"HTTP {exc.code}" + (" (rate-limited)" if exc.code == 429 else "")))
        except (urllib.error.URLError, TimeoutError, ValueError, http.client.HTTPException, ConnectionError) as exc:
            rows.append((pid, model, "failed", type(exc).__name__))
    return rows


def report(rows):
    """Markdown for the job summary, strong providers marked; the order matches the agent's routing."""
    strong = {pid for pid, p in runner.PROVIDERS["providers"].items() if p.get("strong")}
    ok = sum(1 for r in rows if r[2] == "ok")
    lines = [f"## AI providers the agent can use: {ok} model{'s' if ok != 1 else ''} answered", "",
             "| Provider | Model | Status | Detail |", "|---|---|---|---|"]
    for pid, model, status, detail in rows:
        mark = {"ok": "✅", "failed": "❌", "no key": "➖", "chat only": "➖", 'excluded':'➖', "error": "❌"}.get(status, "")
        lines.append(f"| {pid}{' (strong)' if pid in strong else ''} | `{model}` | {mark} {status} | {detail} |")
    return "\n".join(lines) + "\n"


def main():
    order = runner.PROVIDERS["order"]
    strong = [pid for pid in order if runner.PROVIDERS["providers"][pid].get("strong")]
    rows = []
    for pid in strong:
        rows += check_provider(pid)
    rows += check_gemini(os.getenv("GEMINI_API_KEY", ""))
    for pid in order:
        if pid not in strong:
            rows += check_provider(pid)
    text = report(rows)
    print(text)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write(text)


if __name__ == "__main__":
    main()

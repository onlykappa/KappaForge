"""One-off: ask every UnoRouter model whose ID says "free" for one word, one request per model, sequentially.

Temporary branch only (not merged). Uses the UNOROUTER_API_KEY secret; the key is never printed.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.request

BASE = "https://api.unorouter.com/v1"
PROMPT = "Reply with the single word OK."


def headers():
    key = os.getenv("UNOROUTER_API_KEY", "")
    return {"Content-Type": "application/json", "User-Agent": "KappaForge", **({"Authorization": "Bearer " + key} if key else {})}


def free_models():
    with urllib.request.urlopen(urllib.request.Request(BASE + "/models", headers=headers()), timeout=60) as response:
        data = json.load(response)
    rows = data.get("data") if isinstance(data, dict) else data
    return sorted({row["id"] for row in rows or [] if isinstance(row, dict) and isinstance(row.get("id"), str) and "free" in row["id"].lower()})


def ask(model):
    payload = {"model": model, "messages": [{"role": "user", "content": PROMPT}], "max_tokens": 64, "temperature": 0}
    started = time.time()
    try:
        req = urllib.request.Request(BASE + "/chat/completions", json.dumps(payload).encode(), headers())
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.load(response)
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return ("ok", f"answered in {time.time() - started:.1f}s") if str(text).strip() else ("failed", "empty answer")
    except urllib.error.HTTPError as exc:
        reason = ""
        try:
            body = json.loads(exc.read(2000) or b"{}")
            message = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error")
            reason = " - " + "".join(c for c in str(message or "") if c.isprintable())[:90] if message else ""
        except (ValueError, AttributeError):
            pass
        return "failed", f"HTTP {exc.code}" + reason
    except (urllib.error.URLError, TimeoutError, ValueError, http.client.HTTPException, ConnectionError) as exc:
        return "failed", type(exc).__name__


def main():
    if not os.getenv("UNOROUTER_API_KEY"):
        print("UNOROUTER_API_KEY is not set")
        return
    models = free_models()
    rows = [(model, *ask(model)) for model in models]
    ok = sum(1 for row in rows if row[1] == "ok")
    lines = [f"## UnoRouter free models: {ok} of {len(rows)} answered", "", "| Model | Status | Detail |", "|---|---|---|"]
    lines += [f"| `{m}` | {'✅' if s == 'ok' else '❌'} {s} | {d} |" for m, s, d in rows]
    text = "\n".join(lines) + "\n"
    print(text)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(text)


if __name__ == "__main__":
    main()

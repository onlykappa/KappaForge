"""One-off: ask every UnoRouter chat model whose ID says "free" for one word, one request per model, strictly one at a time after a 10-minute cooldown.

Temporary branch only (not merged). Uses the UNOROUTER_API_KEY secret; the key is never printed.
"""
import http.client
import re
from concurrent.futures import ThreadPoolExecutor
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


# Image, embedding, audio, speech and decision-only models: never chat routes for KappaForge.
NOT_CHAT = re.compile(r"embed|bge-|jina|whisper|aura-|nova-3|mercury-decide|riva-translate|pony|sdxl|-xl|xl-|amponyxl|"
                      r"absolutereality|anything-v|cyberrealistic|deliberate|dreamshaper|fustercluck|animerge|icbinp|"
                      r"juggernaut|rev-animated|wai-|quiet-goodnight|ntr-mix|albedobase", re.I)


def free_models():
    with urllib.request.urlopen(urllib.request.Request(BASE + "/models", headers=headers()), timeout=60) as response:
        data = json.load(response)
    rows = data.get("data") if isinstance(data, dict) else data
    ids = sorted({row["id"] for row in rows or [] if isinstance(row, dict) and isinstance(row.get("id"), str) and "free" in row["id"].lower()})
    return [m for m in ids if not NOT_CHAT.search(m)], [m for m in ids if NOT_CHAT.search(m)]


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
    models, skipped = free_models()
    # Let the per-model one-minute windows from earlier runs expire, then go a few at a time: UnoRouter also limits
    # concurrent requests per account, which made the all-at-once run report rate limits instead of real results.
    time.sleep(600)
    with ThreadPoolExecutor(max_workers=1) as pool:
        rows = [(model, *result) for model, result in zip(models, pool.map(ask, models))]
    ok = sum(1 for row in rows if row[1] == "ok")
    lines = [f"## UnoRouter free chat models: {ok} of {len(rows)} answered", "",
             f"Skipped {len(skipped)} non-chat free models (image, embedding, audio, decision-only).", "",
             "| Model | Status | Detail |", "|---|---|---|"]
    lines += [f"| `{m}` | {'✅' if s == 'ok' else '❌'} {s} | {d} |" for m, s, d in rows]
    text = "\n".join(lines) + "\n"
    print(text)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(text)


if __name__ == "__main__":
    main()

"""Compare config/providers.json with the community list of free LLM APIs (mnfst/awesome-free-llm-apis).

Run weekly by the "Free LLM list drift" workflow. It reports providers on the list that KappaForge does not use yet,
and pinned free models that the list no longer shows. No provider keys are involved: it reads one public JSON file.
With --out FILE it also writes the report there; the workflow then opens or updates one free-llm-drift issue.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

from engine import runner

SOURCE = "https://raw.githubusercontent.com/mnfst/awesome-free-llm-apis/main/data.json"
# Reviewed and left out on purpose: roleplay-only models, and a non-OpenAI API that is non-commercial only.
IGNORED = {"Aion Labs": "built for roleplay and storytelling, not coding",
           "Cohere": "different API format; trial key is non-commercial and 1,000 calls a month",
           "ModelScope": "the owner keeps to English-language providers",
           "SiliconFlow": "the owner keeps to English-language providers"}
# Configured without a base URL of their own.
KNOWN_HOSTS = {"generativelanguage.googleapis.com": "gemini", "api.cloudflare.com": "workers-ai",
               "open.bigmodel.cn": "zai"}  # Z AI's China endpoint; KappaForge uses the international api.z.ai.


def host(url):
    return urllib.parse.urlparse(url or "").hostname or ""


def configured_hosts(config):
    hosts = dict(KNOWN_HOSTS)
    for pid, p in config["providers"].items():
        if p.get("base"):
            hosts[host(p["base"])] = pid
    return hosts


def listed(pinned, ids):
    base = pinned.lower().removesuffix("-latest")
    return any(i == base or i.startswith(base + "-") or base.startswith(i + "-") for i in ids)


def compare(data, config):
    """Findings as (kind, provider, detail) rows; an empty list means KappaForge matches the list."""
    hosts, rows, seen = configured_hosts(config), [], set()
    for entry in data.get("providers", []):
        pid = hosts.get(host(entry.get("baseUrl")))
        if not pid and entry.get("name") == "Ollama Cloud":
            pid = hosts.get("ollama.com")
        if not pid:
            if entry.get("name") not in IGNORED:
                rows.append(("new", entry.get("name", "?"), f"{entry.get('description', '')[:200]} Base URL: {entry.get('baseUrl', '')}"))
            continue
        seen.add(pid)
        models = entry.get("models") or []
        if any(m.get("id") is None for m in models):
            continue  # The list shows only some of this provider's models, so a missing one proves nothing.
        ids = {str(m.get("id")).lower() for m in models}
        p = config["routing"]["primary"] if pid == "gemini" else config["providers"].get(pid, {})
        for model in dict.fromkeys(p.get("freeModels", []) + p.get("models", [])):
            if not listed(model, ids):
                rows.append(("pinned", pid, f"`{model}` is pinned as free but is no longer on the list"))
    return rows


def report(rows, updated):
    if not rows:
        return ""
    names = {"new": "Not used by KappaForge yet", "pinned": "Pinned free model missing from the list"}
    lines = [f"The [free LLM API list](https://github.com/mnfst/awesome-free-llm-apis) (updated {updated}) differs "
             "from `config/providers.json`. Review each row; nothing changes until you edit the config.", "",
             "| Change | Provider | Detail |", "|---|---|---|"]
    lines += [f"| {names[kind]} | {name.replace('|', '/')} | {detail.replace('|', '/')} |" for kind, name, detail in rows]
    return "\n".join(lines) + "\n"


def fetch(url=SOURCE):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def main(argv=sys.argv[1:]):
    data = fetch()
    text = report(compare(data, runner.PROVIDERS), data.get("lastUpdated", "unknown"))
    print(text or "KappaForge matches the free LLM list.")
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write(text or "KappaForge matches the free LLM list.\n")
    if "--out" in argv:
        with open(argv[argv.index("--out") + 1], "w") as handle:
            handle.write(text)


if __name__ == "__main__":
    main()

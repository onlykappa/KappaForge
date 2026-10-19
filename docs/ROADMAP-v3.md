# KappaForge v3 roadmap: more models, fewer limits

Version 3 builds on 2.2.8, which already ships the new routing below together with the live task activity feed.

**Goal:** a task never stops because one provider hit its limit, and code is written by the strongest free model available at that moment.

## Why

- Task #123 ran entirely on Gemini Flash-Lite, because the full-size Flash models answered HTTP 429.
- Free daily limits on the newest Flash models are now small. One user on Google's forum reports 20 requests a day for gemini-3.8-flash.
- Seven other providers were configured, but code writing only reached them after **every** Gemini model, Flash-Lite included, had failed.

## What the research found (October 2026)

The best free coding models are no longer Gemini Flash. These are SWE-bench Verified scores, compared within one leaderboard:

| Model | Free route | Notes |
|---|---|---|
| DeepSeek V4 Pro | Ollama Cloud, UnoRouter | top open-weight model on two leaderboards |
| Kimi K3 | Ollama Cloud | |
| Nemotron 3 Ultra 550B | NVIDIA NIM, Kilo free pool | 1M-token context, 262K output: fits very large prompts |
| Gemini 3.8 Flash | Gemini API | strong, but free quota is tiny |
| Qwen 3.5 397B, gpt-oss-120b | Ollama, OVH, Groq | good fallbacks |

**Gemini is still the easiest large-context option, but no longer the best one.** v3 uses a chain of providers instead of relying on Gemini.

**OmniRoute** was considered and deferred. It routes between the same free tiers KappaForge already reaches, at the cost of about 550 MB installed on every run. It stays an option for a self-hosted server with subscription accounts (3.3).

## Shipped early in 2.2.8: strong models before Flash-Lite

- **Routing order:**
  1. Strong providers, the best free coding models: Ollama Cloud (DeepSeek V4 Pro, Kimi K3), NVIDIA NIM (Nemotron 3 Ultra), Kilo's free pool (Nemotron, Laguna, North Code), UnoRouter.
  2. Full-size Gemini Flash.
  3. Gemini Flash-Lite.
  4. The rest: Mistral, Groq, OpenRouter, Requesty, Z AI, Cerebras, LLM7, OVH.
- **Large prompts can leave Gemini.** Large code-writing prompts may go to any allowed provider whose context window fits them, not to Gemini alone.
- **Per-provider limits.** Each provider declares its `context` window and `maxOutput` in `config/providers.json`. It only gets prompts that fit, and its answer is capped at its limit.
- **Resting rate-limited models.** A model that hits a daily quota is skipped for the rest of the run; a per-minute limit rests it for 60 s. This now applies on every provider.
- **Two new optional providers:** UnoRouter (`UNOROUTER_API_KEY`) and Requesty (`REQUESTY_API_KEY`).
- **Named models.** The PR summary names the model that wrote each stage.

## 3.1: see and plan capacity

- A daily usage ledger (calls, tokens and 429s per provider), kept between runs with the Actions cache.
- The router skips a provider close to its daily cap before it fails.
- The app gets an "AI capacity today" view: which providers are healthy, resting or out.
- The research found claims it could not confirm, about Cerebras (now needs a card?) and GitHub Models (retired?). Check them with live keys and update the config.

## 3.2: fewer tokens per task

- Send only relevant excerpts of large files, and reuse file reads across stages.
- Plan small steps so each fits more providers' context windows.
- Never send automatic work, like bundling or syncing, to a model.

## 3.3 (optional): self-hosted gateway

- `OMNIROUTE_URL` and `OMNIROUTE_API_KEY` point to an OmniRoute server the owner runs, where subscription accounts can be added. It is tried first when reachable.

## Privacy

Most free tiers may log prompts or train on them. The NVIDIA trial, Kilo's pool, Requesty's NVIDIA and Poolside models, and Mistral's free mode unless you opt out are among them.

`KAPPA_PRIVATE_CODE_PROVIDERS` (a GitHub Actions variable) limits which providers see private repositories' code. Secrets are never sent in prompts.

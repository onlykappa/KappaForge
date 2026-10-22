# Roadmap: OpenRouter audit, shared-limit Usage rows, premium mode

The work for this PR, written so that any developer or coding agent can pick it up from here. Do the steps in order and
tick them off in this file. Each step lists what to change, where, and how to prove it works. The owner's decisions are
final: do not re-ask them.

## Ground rules

- **Base:** this branch starts from `main` after #190. #193 (Mistral findings, OpenRouter at 1,000 a day, the test
  budget, the audit that asks unlisted and zero-quota models) must be merged into this branch before step 2
  (`git merge origin/main`), because steps 2 and 4 build on it.
- **Checks to run before every push:** `npm test` (all JS tests), `python3 -m unittest discover -s tests -p "test_*.py"`,
  `python3 scripts/check-web.py`. Run `python3 scripts/bundle-web.py` after any change under `preview/`, which copies
  the web app into `ios/KappaForge/Web/`. Commit both copies.
- **Deploying the backend from a branch:** run the `deploy-chat.yml` workflow (workflow_dispatch, `operation: deploy`)
  on the branch. Deploys queue one at a time. Merging to `main` deploys `main`.
- **Live checks** (they need the `KAPPA_APP_TOKEN` secret, which is already set). Push the branch to:
  - `live-usage-check`: a full model test
  - `live-usage-check-quick`: pages only, plus `/capabilities` data
  - `live-usage-check-audit`: one-by-one audit of the labels in `tools/model-audit.txt`
  - `live-usage-check-provider-<id>`: every model of one provider

  Results land on the `live-usage-check-results` branch in `summary.json`, with keys `probe`, `audit`, `gauges`,
  `liveCounters`, `ollamaPlan`, `openrouterAccount`.
- **The owner never pays or upgrades** a plan, except the OpenRouter premium spending below, inside its caps. Keys and
  secrets live only in Cloudflare and GitHub. Never print them.
- **Merges happen only when the owner says so.**

## Step 1. Usage: model rows on a shared daily limit show the model's own share

**Problem** (owner's screenshot, OpenRouter on 2026-10-22): every OpenRouter model row reads "3.5% used today", which is
the whole account's use of its shared 1,000 a day. The row's own text says "3 of 1,000 requests" (0.3%), so the two
numbers disagree, and every row looks the same.

**Change:**
- `preview/limits-core.js` `gauge()`: when a `shared` limit applies to a **model** row, measure that model's own requests
  against the shared cap. Label it "of today's shared requests", so the percent matches "3 of 1,000".
  - Keep the provider-wide figure for the **provider** row only.
  - Pass a flag from `gaugeFor()` in `preview/settings.js` (for example `sharedScope:'model'`) so the provider row keeps
    using `sharedUsed`.
- Keep "Maxed" for model rows when the shared cap is used up. A model cannot go on once the account's 1,000 are gone,
  so test `sharedUsed.requests >= shared.rpd` and return maxed.
- Apply the same rule to NVIDIA's shared 40 a minute: a model row shows its own busiest minute against the shared cap.

**Prove it:**
- Unit test in `tests/provider-limits.test.mjs`. A provider with a shared rpd of 1,000, 35 used in total, and one model
  with 3 used gives a model row of 0.3% and a provider row of 3.5%. With 1,000 used, the model row is maxed.
- Re-render with the harness pattern in the PR history (Playwright, capabilities stubbed), then the quick live check.

## Step 2. OpenRouter audit (the same audit Mistral got in #193)

**Problem:** on 2026-10-22, OpenRouter rows showed "none answered" for:
- `nvidia/nemotron-3.5-lightning:free`
- `nvidia/nemotron-3.5-super-vl:free`
- `google/gemma-4-26b-a4b-it:free`
- `google/gemma-4-31b-it:free`
- `poolside/laguna-xs-2.1:free`

`minimax/minimax-m3.1-flash:free` shows "not offered now". Earlier audits saw OpenRouter answer 429 "Provider returned
error", which is the upstream free provider's own rate limit, not OpenRouter's.

**Do:**
1. Run the full OpenRouter check: push to `live-usage-check-provider-openrouter`. The test budget (#193) caps a test at
   half of the 1,000 a day, which is ample.
2. Put every OpenRouter model that did not answer into `tools/model-audit.txt` as `openrouter:<model>`. Also add any
   `:free` model OpenRouter now lists that KappaForge does not route. The audit asks unlisted names directly (#193).
   Push to `live-usage-check-audit`.
3. Classify each model with the same rules as the Mistral audit (see `docs/model-master-list.md`):
   - **Permanent errors** go in `config/providers.json` → `providers.openrouter.removedModels`, with a `removedWhy`
     reason in the provider's words. That means 404 no longer served, 403 limited to agentic harnesses, 402, invalid
     model, or empty replies even with a 1,024-token allowance.
   - **429 "Provider returned error" or "rate-limited upstream"** is temporary: **keep**. If a model answers 429 on the
     first request in every check over two days, do what was done for Mistral Medium: report it to the owner and remove
     it only on their go-ahead.
   - **A model that answered** stays.
4. Look into the "not offered now" label for `minimax/minimax-m3.1-flash:free`. If OpenRouter no longer lists it, nothing
   is needed: Usage labels it correctly. If OpenRouter still lists it but `providerModels()` drops it, find out why
   (`chat-backend/src/providers.js`, `freeModels()` / `ROUTABLE`) and fix it.
5. Find what spent **$0.00076** of the OpenRouter credits. `/capabilities` → `openrouterAccount.usedUsd` showed it on
   2026-10-22, while only `:free` models should be routed. Suspects:
   - `openrouter/free`, the auto-router meta model, if it can pick a paid model. Check its pricing in OpenRouter's
     catalog.
   - Any model id without `:free`.

   If a route can charge, remove it (or require `:free`) in `providerModels()` for providers with `freeOnly`.
6. Update `docs/model-master-list.md`, and tell the owner the findings in plain words.

## Step 3. Premium mode: OpenRouter credits for demanding tasks, rarely, within caps

**Owner's decisions (2026-10-22, final):**
- **When:** both.
  1. A **"Use premium"** switch when starting a task.
  2. **Automatic rescue** after the free models have already failed the task.
- **Caps:** **$1 per task** and **$5 per calendar month (UTC)**, enforced before every premium request.
- **Model:** **strong but affordable.** The strongest coding model in the preferred families under a price ceiling, chosen
  live from OpenRouter's catalog. Not the most expensive frontier models.

**Design:**
1. **Config** (`config/providers.json` → `routing.premium`):
   ```json
   {"provider": "openrouter", "families": ["deepseek", "qwen3.8-coder", "qwen3-coder", "kimi", "glm-5"],
    "maxOutputPricePerMillion": 3, "taskCapUsd": 1, "monthCapUsd": 5, "maxTokensPerCall": 8000}
   ```
   Families are preference order. Fill in real ids by reading OpenRouter's catalog (`GET https://openrouter.ai/api/v1/models`,
   which needs no key and is reachable from the Worker and from GitHub Actions). The model must not end in `:free`, must
   have a tool-free chat capability, and must have `pricing.completion * 1e6 <= maxOutputPricePerMillion`.
2. **Worker: `chat-backend/src/premium.js`** (new):
   - `premiumModel(env)`: read the catalog (cache 1 h), pick the first family match under the ceiling, and return
     `{model, inputPrice, outputPrice}` per token.
   - `premiumBudget(env, {task, estimateUsd})` and `recordPremium(env, {task, usd})`: keep the spend in the
     `KappaMemory` Durable Object (`router-state.js` style, one transaction), keyed by month (`premium:2026-10`) and
     task (`premium-task:<issue number>`). Refuse when `spent + estimate` passes either cap.
   - **Estimate before sending:** prompt tokens (`estimateTokens`) × input price + `maxTokensPerCall` × output price.
   - **After the answer:** use OpenRouter's reported cost. Send `"usage": {"include": true}` in the request body and read
     `usage.cost`, or use `GET /api/v1/generation?id=...`. Fall back to tokens × price.
3. **Gateway** (`chat-backend/src/inference-router.js`):
   - Accept `premium: {task: <number>}` in a coding request.
   - Do the free routes **first**, unchanged. Only when the request says `premium.mode === "now"` (the owner's switch)
     or `"rescue"` does it add the premium route, as **one** attempt after free routes fail (rescue) or first (switch).
   - It must still pass the budget check. When the budget refuses, carry on with free routes and return
     `premium: {refused: "task cap" | "month cap"}`.
   - The premium call **must not** go through the `freeOnly` filter, so build its route directly:
     `{provider: "openrouter", model, premium: true}`.
   - Record it in Usage with `kind: "premium"` and the cost.
4. **Engine (Python, `engine/`):**
   - The task brief carries `premium: true` when the owner switched it on. The app adds it to the authorization payload
     the same way `mode` is carried (`chat-backend/src/agent-work.js` `taskBody`). The engine reads it in
     `engine/developer.py` where the brief is parsed.
   - `engine/gateway.py` / `engine/runner.py`: pass `premium: {task, mode}` on gateway calls.
     - `mode: "now"` for every call of a task with the switch on.
     - `mode: "rescue"` only in `check_the_work()` after `MAX_CHECK_ROUNDS` failed, and in `build_in_stages()` when a
       stage has "No validated proposal" after the compact retry.
   - Progress feed line: `Using premium: <model> · $0.08 so far (cap $1.00)`. Use `Progress.act("model", ...)` in
     `engine/developer.py`.
5. **App (`preview/`):**
   - **Task start** (`preview/app-tasks.js` or wherever "Start task" is built): a "Use premium" switch, off by default,
     with a hint like "Up to $1 of your OpenRouter credit if free models can't do it".
   - **Usage** (`preview/settings.js`): a card "Premium: $0.43 of $5 this month", from `/capabilities` →
     `premium: {monthUsd, monthCapUsd, model}`.
   - **Settings → AI Models:** show the chosen premium model and the caps, read-only.
6. **Safety:**
   - Premium is never used for chat, only for tasks.
   - The caps are enforced in the Durable Object, so a crash or retry cannot double-spend.
   - Recommend the owner set a $5 credit limit on the OpenRouter key in OpenRouter's settings as a backstop.

**Prove it:**
- **Unit tests:**
  - The budget refuses at the task cap and at the month cap, and the month rolls over.
  - The estimate covers the worst case.
  - The gateway adds the premium route only for `rescue` after free failures or for `now`, and never for chat.
  - The catalog pick respects the ceiling and the family order.
  - The engine passes the premium mode.
- **Live:** run `tools/multi_agent_check.py`'s complex scenario (push to `multi-agent-check-complex`) with a forced
  rescue, then confirm on `live-usage-check-quick` that `openrouterAccount.usedUsd` rose by about the reported cost and
  stayed under $1.

## Step 4. Finish

- Update this file's checkboxes, `docs/model-master-list.md` and the PR description.
- Deploy the branch, run the quick live check, and send the owner the results and a short summary.
- Wait for the owner's "merge".

## Status

- [x] 1. Usage shared-limit model rows
- [ ] 2. OpenRouter audit (+ $0.00076 spend source)
- [ ] 3. Premium mode
- [ ] 4. Finish

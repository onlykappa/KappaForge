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

### Step 2 findings (22 Oct 2026, done)

- Full OpenRouter check (13 routed models): 9 answered. `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free` and
  `xingchen-agi/xing4.0-29b-a4b:free` answered 429 "Provider returned error" (the free host's own limit): **kept**.
  `nvidia/nemotron-3.5-lightning:free` and `poolside/laguna-xs-2.1:free` replied empty to the 64-token quick check.
- One-by-one audit (1,024 tokens): both empty models answered "OK". They are thinking models that spend a short
  allowance on reasoning, so they are **kept** (working). The three 429 models were still 429 upstream.
- `minimax/minimax-m3.1-flash:free` returned 404: "The free launch period for MiniMax M3.1 Flash ended on Oct 22, 2026.
  The `:free` variant has been retired." It is now in `removedModels`, so Usage no longer shows it.
- The $0.00076 spend did not move across two checks that asked every routed model, including `openrouter/free`. No
  current route charges: `freeModels()` already keeps only ids that end in `:free` or `/free` for `freeOnly` providers. The
  spend predates this audit.

## Step 3. Premium rescue: free first, owner-authorized, capped (built; supersedes the first design)

The owner's upgrade spec of 22 Oct 2026 replaced the first design. The "Use premium" task switch and automatic escalation
are gone. Free models are the default for every task. Premium is a last-resort rescue for one blocked task step, never a
preferred route.

**Flow:** free first → bounded free recovery → verified blocker → authorized rescue of that one step → free re-check →
back to free.

### Enforcement (backend, `chat-backend/src/premium-store.js`, `premium.js`, `inference-router.js`)
- **Premium Mode** is stored in the KappaMemory Durable Object (`premium:v1`) and is **off** unless the owner turns it on.
  - Only the owner's app token can change it (`POST /premium`, action `set`).
  - The engine's runner token cannot reach that endpoint.
  - Nothing in an inference request (body, model name, key) can authorize a paid request.
- **Single checks at dispatch.** Every paid request needs a `reserve` that passes all of these in **one transaction**,
  immediately before sending:
  - Premium Mode is on, or a single-use approval exists for this task and step.
  - The task has free evidence: at least 3 free answers from at least 2 different free models, recorded by the gateway
    itself from real free answers on that task.
  - The step has not had a rescue (one paid dispatch per task step, ever).
  - The conservative maximum charge fits both caps.
- **Fail closed.** Missing or unreadable state, an unverifiable catalog or price, or a provider policy that does not allow
  OpenRouter for private code: no dispatch.
- **Disabling.** Turning Premium Mode off blocks every rescue not yet reserved and withdraws unused approvals. A request
  already sent cannot be recalled across Worker invocations and may be charged. The app says so.
- **Scope.** Coding tasks only. Chat (`/chat`), audits and model tests (`/providers/probe`), diagnostics and background
  checks never call premium code.
- A rescue request is **premium only**: the gateway does not fall back to free routes inside it. The engine's next call is
  free.

### Single-use approval
- With Premium Mode off, the gateway's quote records one **offer** per task step: what failed, the step, the proposed
  model, the maximum charge, the budgets left, and whether free capacity may recover.
- The owner chooses in Settings → Usage:
  - **Allow one rescue:** an approval for that task and step only. It expires in 24 hours, is used once at reserve, and
    is withdrawn if Premium Mode is turned off.
  - **Enable Premium Mode.**
  - **Keep using free:** dismisses the offer; it is not offered again.
- After allowing or enabling, the app retries the task. The retry runs free first again and reaches the same step.

### Money
- **Caps:** $1 a task and $5 a UTC calendar month, counting every hold:
  - **reserved:** the maximum, before sending;
  - **confirmed:** OpenRouter's `usage.cost`, or `GET /api/v1/generation` by id;
  - **unresolved:** a timeout or lost answer, kept at its maximum and never assumed free.
- Reconciliation replaces an unresolved maximum with the reported charge.
- A 4xx refusal from OpenRouter (400, 401, 402, 403, 404, 413, 422, 429) is recorded as $0, because those are refused
  before inference.
- **Maximum charge:**
  - prompt tokens counted at 2 characters a token;
  - output counted at **twice** `max_tokens` (room for reasoning tokens), at the dearer of the completion and reasoning
    prices;
  - plus any per-request fee;
  - times a 1.25 margin.
  - `max_tokens` ≤ 8,000.
- The dispatch sends `provider.max_price` with the same prices, so OpenRouter refuses rather than routing to a dearer
  provider.
- Concurrency: every operation is one Durable Object transaction. The test with 12 concurrent $0.90 rescues admits
  exactly 5.

### Model selection (`pickPremium`)

Updated by [Premium model selection](../premium-model-selection.md): exact reviewed open-weight IDs now use
quality preference before price, with DeepSeek V4.1 Flash 1017 first. Live eligibility and hard spending caps still
apply. The notes below describe the original implementation and are superseded by that policy.
- Candidates: owner-reviewed families (`routing.premium.families`), never a `:free` or `openrouter/` router model.
- Catalog requirements:
  - Prompt, completion, request and reasoning prices all verified (missing, malformed or "-1" excludes the model).
  - Completion ≤ $3/M and prompt ≤ $1.5/M.
  - Text output, `max_tokens` support, and room for the prompt plus twice the output.
- The pick is the candidate with the **lowest maximum charge** that fits the remaining budget.
- A family name is a candidate, not proof of quality. The catalog proves availability and price only.

### Engine (`engine/runner.py`, `engine/developer.py`)
- Every gateway call carries `task`, so the gateway can record the free evidence.
- **Rescue points.** Each fires once per task step, through the gateway only:
  - `check`: after `MAX_CHECK_ROUNDS` free fix rounds still leave problems, and only if that round's free review ran. A
    review that was unavailable is a capacity problem, not proof.
  - `proposal`: after "No validated proposal" from the large, compact and split attempts. Not when the free routes are
    only resting (an outage with a retry time).
- The step's first model call asks for a **quote**; the feed shows the reason and maximum charge before dispatch, or the
  recommendation when Premium Mode is off. Only an eligible quote is followed by the dispatch. Every later call,
  including the re-check, is free.
- **Outcome:** after a `check` rescue, the free re-check decides `solved` (no problems left) or `not_solved`. For
  `proposal`, `solved` means a validated proposal came back. Recorded with `POST /router/premium-outcome`.

### App
- **Settings → AI Models → Premium Mode:** the switch with the owner's wording and the caps.
- **Settings → Usage → Premium rescue:**
  - mode, month spend (confirmed, reserved, unresolved), budget left, next reset;
  - last rescue and outcome;
  - open recommendations with the three actions;
  - history: task, step, model, reason, maximum, charge, outcome.
- No prompts or keys are shown.

### Free-route safety (audit)
- **OpenRouter discovery** keeps a model only if every price in its catalog entry is zero, whatever its name.
  `openrouter/free` is kept only if its catalog prices are zero; a variable price ("-1") drops it.
- **The model audit** never asks an unlisted model on a free gateway unless it is a `:free` id, nor a metered provider
  without the owner's paid opt-in. Previously an audit list naming a paid id would have been sent.
- **Unchanged:** chat and coding routes (`fallbackRoutes`), including manual model picks, come only from that list. The
  existing explicit paid opt-in (`KAPPA_ALL_MODEL_PROVIDERS` naming a provider) still works.

### Free routing record
- Every gateway response carries `routing.skipped`: routes not asked, by reason (`provider_resting_or_rejected`,
  `attempt_limit`, `time_budget`), next to the attempt history.
- The existing reservations skip rested, full and rejected models without asking them.

### The $0.00076
- **No source found.**
  - KappaForge's usage history has no OpenRouter call with a cost and no non-free OpenRouter model id.
  - No audit list ever named a paid OpenRouter id.
  - Two full checks that asked every routed model, including `openrouter/free`, left the spend at $0.000759.
- KappaForge cannot see OpenRouter's per-request activity. The owner can check it at openrouter.ai → Activity.
- **Safeguards now in place:** price-verified discovery, the audit guard, and premium only through the gated path.

### Live paid test (owner-approved, $0.10 cap, 22 Oct 2026)
- **How it ran:** `.github/workflows/premium-smoke.yml` (a push to `premium-smoke-test`) ran `tools/premium-smoke.mjs`. That is
  this checkout's premium code, with a throwaway in-memory budget capped at $0.10.
- **Rescue:**
  - The quote picked `deepseek/deepseek-v4-flash-0731`, at most $0.000346.
  - One rescue was sent and answered "OK" (HTTP 200, 1.0 s).
  - It was **confirmed at $0.000006** from OpenRouter's reported cost.
  - A second rescue of the same step was refused (`step_already_rescued`) and nothing was sent.
- **OpenRouter's own total:** $0.000758995 before and after. A charge this small had not shown yet, or rounds away.
- **Catalog facts:**
  - 468 models, of which 18 have names ending in `:free`, and every one of those is priced at zero.
  - `openrouter/free` is priced at zero, so price-verified discovery keeps it.
- **Still to see live:** a rescue inside a real task, through the deployed gateway and Settings → Usage. That needs the
  merge and deploy.

## Step 4. Finish

- Update this file's checkboxes, `docs/model-master-list.md` and the PR description.
- Deploy the branch, run the quick live check, and send the owner the results and a short summary.
- Wait for the owner's "merge".

## Status

- [x] 1. Usage shared-limit model rows
- [x] 2. OpenRouter audit (+ $0.00076 spend source)
- [x] 3. Premium rescue (owner-authorized, free first; mocked-billing tests; no live paid test by design)
- [ ] 4. Finish

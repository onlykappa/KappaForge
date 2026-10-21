# Provider Token Bank and Usage Analytics

Status: specification checkpoint only. Runtime implementation has not started.
Owner request: detailed provider usage, total available allowance, remaining balances, automatic reset tracking, and continuously updated cost analytics. Keep the pull request draft; do not merge or release.

## Inspected baseline

Base commit: b531ceef39ef41bf83144cbf29b93cbd900b758b.
Read KAPPA.md. Root AGENTS.md was not present in the GitHub contents API.
- preview/settings.js loads authenticated, paginated /usage events, shows measured tokens, attempts, latency, historical model usage, advisory budgets and JSON/CSV exports.
- chat-backend/src/index.js exposes /usage through existing durable storage and /capabilities with optional MODEL_PRICING_JSON. Provider remaining quota is explicitly unknown.
- chat-backend/src/providers.js normalizes provider usage and requests streaming usage metadata. Provider summaries currently report remaining:null and source:unknown.
- Application source is preview/; regenerate ios/KappaForge/Web with python scripts/bundle-web.py.
These are source findings, not verification of deployed state or account balances. The current UI defaults to This month; its All option is labeled 90 days because the backend returns only rolling 90-day raw usage. Historical usage older than the tracking/retention window cannot currently be reconstructed from KappaForge. The supplied Usage screenshots show 659,210 measured tokens for This month; the displayed Workers AI models contribute 44,649 + 6,815 = 51,464 of that total, confirming those model tokens are counted. Several listed attempts have 0 tokens, which must be distinguished from verified zero usage because response usage may be absent.

## Product outcome

Extend the existing Usage & Billing screen with two primary banks, plus provider-specific units when a limit is neither tokens nor requests:
1. **Token bank:** show verified token allowance as used / total / remaining, scoped by provider account/project, pool, model, and reset window. Sum only disjoint compatible token pools. Show daily and monthly windows separately and a coverage count such as "1 of 7 providers reports a token allowance." Never turn context length, token-per-minute throughput, request caps, neurons, or credits into a token allowance. If no verified token allowances exist, display Unavailable, never zero.
2. **Request bank:** show actual provider inference requests used / verified limit for request-based quotas. Count an inference request only when an attempt is actually sent to that provider endpoint. Link it to a unique provider-attempt ID, provider/account, model, timestamp, HTTP outcome, and parent chat/task. Do not count a user message, route selection, model discovery call, or unsent fallback as an inference request. A retry/fallback sent to another provider is a separate attempt linked to the same parent task. Count against the provider's allowance only according to that provider's documented metering semantics; otherwise label it "observed requests" and keep quota remaining unknown. Do not duplicate a shared account/project request pool across models or keys.
3. **Provider-specific quota units:** expose separate cards for verified native limits such as Cloudflare Workers AI Neurons, account credits, concurrency, and per-minute throughput. Never fold these into token or request totals. These cards prevent a valid provider limit from disappearing just because it cannot be converted safely.
4. Provider cards: provider, account/pool, model scope, quota unit, limit, used, remaining, reset schedule, next reset/countdown, last synchronization, source and confidence.
5. Usage analytics: input, output, cached and reasoning tokens when reported; per provider/model/task, chat versus development, retries/fallbacks, errors, daily/monthly trends and exports. Unknown metadata remains visible. Show both the selected period and a persistent lifetime tracked total, with a "tracked since" date and coverage. Lifetime totals must survive raw-event retention and quota resets. Clearly label current reporting windows; do not call a 90-day view "all time."
6. Reconciliation of prior usage: allow a user to import or enter an OmniRoute/provider historical total with provider, model/account scope, period or as-of date, unit, source, and whether it overlaps KappaForge records. Keep imported history visibly separate from KappaForge-measured usage unless overlap is verified; never silently add overlapping totals. A user-supplied legacy baseline must be labeled Imported/Unverified until reconciled.
7. Cost analytics: actual provider-reported spend where available, calculated billable estimates otherwise, and a separate optional estimated retail value for free usage. Always show pricing coverage.
8. Refresh: update following settled requests, on opening/foregrounding the screen and manual refresh, plus bounded server reconciliation where supported. Reopening after a reset must work without the app having stayed open.

## Provider quota research baseline

Public provider policies checked October 21, 2026. These are documented starting values, not the owner's live remaining balances; account-specific dashboards/API snapshots remain authoritative.

| Provider | Published free limit or account source | Bank treatment |
|---|---|---|
| Cloudflare Workers AI | Free allocation: 10,000 Neurons per day, shared across Workers AI and reset at 00:00 UTC. See https://developers.cloudflare.com/workers-ai/platform/pricing/ | Track as Neurons/day, not tokens. Workers AI token usage can be measured separately from response usage. |
| Groq, `openai/gpt-oss-120b` | Published free limits: 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD. Exact organization limits/remaining counters are in the Groq Limits page and response headers. See https://console.groq.com/docs/rate-limits | Track TPD in token bank; keep TPM, RPM, RPD as separate throughput/request limits. Verify the configured account's current values. |
| OpenRouter free model variants | Default free tier: 50 free-model requests/day; the higher tier requires at least $10 in all-time purchased credits and is not the user's $0 baseline. `GET /api/v1/key` returns the live free-model daily used/limit/remaining fields. See https://openrouter.ai/docs/api_reference/limits | Track as account-level free-model requests/day only. Do not infer tokens from this cap. |
| Gemini API | Limits are per project and model, typically RPM, input TPM, RPD, and sometimes TPD; Google says active limits are shown in AI Studio and vary by tier/account. See https://ai.google.dev/gemini-api/docs/rate-limits | Track actual tokens used; show each live quota dimension if available from the project/account. No universal public token bank. |
| NVIDIA NIM | Free developer access is for prototyping, but NVIDIA publishes no universal request or token quota. Account/model-specific restrictions apply. See https://docs.api.nvidia.com/nim/docs/product | Track actual usage and any verified response/dashboard limits. Do not adopt forum-reported 40 RPM as a guaranteed quota. |
| Mistral API | Free mode includes monthly usage; model limits include TPM and requests/second and are shown in Admin Panel → API → Limits. See https://docs.mistral.ai/admin/billing-usage/usage-limits | Track account-reported monthly usage, token throughput, and request throughput as separate units. No universal public free allowance number. |
| DeepSeek direct API | No general public free token allowance is documented for model inference. Usage pricing and any granted/topped-up balances are account-specific; `/user/balance` reports current balance. Concurrency limits are not a token bank. See https://api-docs.deepseek.com/quick_start/pricing/ and https://api-docs.deepseek.com/api/get-user-balance/ | Track tokens actually used; show an account credit/granted balance only if the API reports one. Do not label it as a free token quota. |
| Ollama Cloud | Free accounts include a monthly starter amount of credits for starter models; the amount is not public. Free allows one concurrent request, and the account Usage page shows actual included usage. Local Ollama is hardware-limited, not provider-quota-limited. See https://ollama.com/pricing | Track usage and one concurrent request as distinct metrics. A hidden credit amount is not a public token total. |

Only add a row to a bank when the quota source establishes its unit, scope, and reset window. A user may optionally enter a manually verified account limit; show it as owner-entered and timestamped until reconciled.

## Accuracy rules

A single universal exact bank cannot be promised before investigating each account's available quota APIs and response headers. The useful deliverable is two honest aggregate banks plus provider cards for native non-token/non-request units.
- Discover supported balance sources from official provider documentation and authenticated metadata using existing server credentials. Build a capability matrix for the configured provider registry, including unsupported providers.
- Prefer provider-reported authoritative balance, then documented quota headers with explicit scope, then owner-configured allowances with local accounting clearly marked Estimated.
- Separate tokens, requests, monetary credits, Neurons, concurrency and throughput limits. Never convert a request allowance into exact tokens or count a context-window size as a spendable allowance. Aggregate only within the same unit, provider scope, and reset semantics.
- Group shared allowances by provider account/project and stable pool identity, not API-key count or number of models. Aliases, multiple credentials and gateway routes must not multiply balances. Keep actual provider request-attempt records distinct from chat-message counts, and deduplicate retransmission of the same upstream attempt with a stable attempt ID.
- Sum only disjoint compatible pools for the same reset window, unit and quota semantics. Daily and monthly overlapping constraints must not be added. Show short-term throughput separately from renewable allowance.
- Account for disabled/unreachable routes: quota may exist but usable capacity may differ. Unknown provider balances stay unknown, even when usage is measured.
- External usage cannot be inferred from KappaForge logs. Reconcile with provider data when possible; otherwise label "KappaForge-tracked estimate" with tracking start date and incomplete history.
- Period totals and lifetime totals are distinct. Preserve an all-time aggregate before deleting raw events. Existing history is bounded by the earliest retained event; display that coverage boundary rather than implying historical completeness.
- OmniRoute's reported millions and KappaForge's total are comparable only after matching provider/account, model scope, token definition (input + output vs output only), and dates. Imported OmniRoute totals must be stored as a separate source with an explicit overlap policy.
- Do not issue inference calls just to discover quota. Do not create accounts, purchase credits, enable paid fallback or introduce recurring costs.

## Suggested implementation contract

Add a backward-compatible quota snapshot keyed by owner and pool, with provider, account reference (nonsecret), model scope, unit, limit, used, remaining, reset kind, window start/end, timezone, resetAt, observedAt, source, confidence, freshness and coverage. Validate finite nonnegative values and reject contradictory snapshots. Preserve raw provider semantics without storing secrets.
Keep request telemetry and provider snapshots distinct. Use stable attempt IDs across Worker, gateway and engine reporting so one upstream call is counted once. Distinct retries/fallback attempts count individually when usage exists.
Reconcile balances and events transactionally using existing durable coordination. Record reservation state separately from settled usage. A newer authoritative snapshot replaces an older baseline; do not subtract already included events twice. Late events belong to their actual windows.
Capture streaming usage-only frames and terminal usage without duplicate increments. Failed/aborted requests can have billable usage; missing usage is unknown, never assumed free.
Never reset lifetime usage or cost when a renewable quota resets. Persist cumulative rollups beyond raw-event retention, with coverage and migration metadata. Preserve the original event timestamp, provider-reported token fields and source. If legacy history is unavailable, start a new measured baseline and allow a separately marked historical import; do not backfill invented usage.

## Reset behavior

Implement documented provider reset semantics: fixed daily/monthly windows, rolling windows, relative reset durations or explicit timestamps. Honor provider timezone and daylight saving where applicable.
At a fixed boundary, roll to the next allowance window only when the documented rule establishes it, mark any inferred replenishment Estimated until reconciled, and retain prior-window history.
For rolling windows, expire only the relevant usage. A retry-after/cooldown timer is not proof of full replenishment.
After outages or stale snapshots, show the last known observation and stale status; never present a stale balance as live. Apply bounded timeout/backoff and avoid repeated rejected balance requests.

## Pricing

Calculate per model and effective pricing date:
cost = (uncachedInput * inputRate + cachedInput * cachedRate + output * outputRate + otherBillableUnits) / rateUnit.
Rates must carry currency, source, verification date and effective date. Avoid double counting reasoning/cached tokens already included in totals. Keep historical rates attached to historical usage.
For confirmed free-tier calls, actual spend can be zero while optional retail-equivalent value is nonzero. Unverified tier or pricing yields Unknown.
An average cost per token can be derived as covered estimated cost / covered tokens, then displayed as a weighted average. Do not use an arbitrary universal average as the bill.
Partially priced history must display a known subtotal and explicit unpriced coverage. Free retail value must never appear as money owed or verified savings.

## Delivery sequence

- [ ] Verify configured provider matrix, official quota/balance endpoints, headers, pricing and reset semantics. Document what cannot be measured. Seed provider adapters with the published baseline table above, while displaying account-specific live limits when retrievable.
- [ ] Implement separate token and actual provider-inference-request banks with stable attempt IDs, provider scope, reset window and evidence source; keep Cloudflare Neurons, credits and concurrency in native-unit provider cards.
- [ ] Implement durable quota schema, event deduplication, reset/reconciliation helpers and capability adapters.
- [ ] Cover all inference paths, including development engine and gateway, with single-count reporting and no prompt/credential collection.
- [ ] Extend authenticated usage API with bank summaries, provider detail, confidence/coverage and dated costs; preserve existing clients.
- [ ] Implement accessible mobile provider cards, separate daily/monthly summaries, countdowns, cost breakdown, filters and exports in existing settings. Add a persistent lifetime tracked total and tracking-start/coverage label; rename the current 90-day "All" option to "90 days."
- [ ] Add safe import/manual entry for prior OmniRoute or provider usage totals, visibly separating imported history from KappaForge-measured totals and preventing double counting.
- [ ] Regenerate native web bundle and record whether an IPA update is required. Backend-only changes cannot install new bundled UI.
- [ ] Validate, inspect diff, capture UI evidence when tooling permits and update draft PR with actual remaining limitations.

## Required behavioral validation

Tests must exercise real production helpers and integration boundaries:
- Duplicate events across engine/gateway/Worker, distinct retries, concurrent calls, reservations and late completion. A user message with no provider call must add no provider request; a fallback adds a request only when its upstream call is sent; model discovery/health checks must not enter the inference request bank.
- Multiple models/keys sharing one provider account pool count against one bank ceiling; independent account quotas are shown separately before any aggregate is presented.
- Tokens, requests, Neurons, credits, concurrency, TPM and RPM remain separate units; no conversion or cross-unit summation.
- Shared model/key pools, incompatible units, overlapping daily/monthly limits, disabled providers and missing balances.
- Fixed-window timezone/DST boundaries, rolling expiry, offline reopen, stale observations and delayed provider reconciliation.
- Streaming terminal/usage-only frames, aborted and failed requests, partial usage metadata and external usage adjustments.
- Free versus paid tier, cache/reasoning overlap, price changes, unknown rates, partial cost coverage and export accuracy.
- Existing storage/client compatibility, authentication, redaction and no paid inference caused by refresh.

Run applicable baseline checks:
python -m unittest discover -s tests
node --test tests/intelligence.test.mjs chat-backend/vector-index.test.mjs
python scripts/check-web.py

This checkpoint changes documentation only. No runtime tests, live provider calls, deployments, or UI builds have been performed for this draft.

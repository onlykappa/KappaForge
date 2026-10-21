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
These are source findings, not verification of deployed state or account balances.

## Product outcome

Extend the existing Usage & Billing screen:
1. Token bank: used / total / remaining for verified compatible token allowances, with a visible coverage count such as "3 of 7 providers report token balances". Show daily and monthly banks separately. If no compatible verified allowances exist, display Unavailable, never zero.
2. Provider cards: provider, account/pool, model scope, quota unit, limit, used, remaining, reset schedule, next reset/countdown, last synchronization, source and confidence.
3. Usage analytics: input, output, cached and reasoning tokens when reported; per provider/model/task, chat versus development, retries/fallbacks, errors, daily/monthly trends and exports. Unknown metadata remains visible.
4. Cost analytics: actual provider-reported spend where available, calculated billable estimates otherwise, and a separate optional estimated retail value for free usage. Always show pricing coverage.
5. Refresh: update following settled requests, on opening/foregrounding the screen and manual refresh, plus bounded server reconciliation where supported. Reopening after a reset must work without the app having stayed open.

## Accuracy rules

A single universal exact bank cannot be promised before investigating each account's available quota APIs and response headers.
- Discover supported balance sources from official provider documentation and authenticated metadata using existing server credentials. Build a capability matrix for the configured provider registry, including unsupported providers.
- Prefer provider-reported authoritative balance, then documented quota headers with explicit scope, then owner-configured allowances with local accounting clearly marked Estimated.
- Separate tokens, requests, monetary credits, concurrency and rate limits. Never convert a request allowance into exact tokens or count a context-window size as a spendable allowance.
- Group shared allowances by provider account/project and stable pool identity, not API-key count or number of models. Aliases, multiple credentials and gateway routes must not multiply balances.
- Sum only disjoint compatible pools for the same reset window, unit and quota semantics. Daily and monthly overlapping constraints must not be added. Show short-term throughput separately from renewable allowance.
- Account for disabled/unreachable routes: quota may exist but usable capacity may differ. Unknown provider balances stay unknown, even when usage is measured.
- External usage cannot be inferred from KappaForge logs. Reconcile with provider data when possible; otherwise label "KappaForge-tracked estimate" with tracking start date and incomplete history.
- Do not issue inference calls just to discover quota. Do not create accounts, purchase credits, enable paid fallback or introduce recurring costs.

## Suggested implementation contract

Add a backward-compatible quota snapshot keyed by owner and pool, with provider, account reference (nonsecret), model scope, unit, limit, used, remaining, reset kind, window start/end, timezone, resetAt, observedAt, source, confidence, freshness and coverage. Validate finite nonnegative values and reject contradictory snapshots. Preserve raw provider semantics without storing secrets.
Keep request telemetry and provider snapshots distinct. Use stable attempt IDs across Worker, gateway and engine reporting so one upstream call is counted once. Distinct retries/fallback attempts count individually when usage exists.
Reconcile balances and events transactionally using existing durable coordination. Record reservation state separately from settled usage. A newer authoritative snapshot replaces an older baseline; do not subtract already included events twice. Late events belong to their actual windows.
Capture streaming usage-only frames and terminal usage without duplicate increments. Failed/aborted requests can have billable usage; missing usage is unknown, never assumed free.
Never reset lifetime usage or cost when a renewable quota resets. Preserve summaries beyond raw-event retention when required, with coverage and migration metadata.

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

- [ ] Verify configured provider matrix, official quota/balance endpoints, headers, pricing and reset semantics. Document what cannot be measured.
- [ ] Implement durable quota schema, event deduplication, reset/reconciliation helpers and capability adapters.
- [ ] Cover all inference paths, including development engine and gateway, with single-count reporting and no prompt/credential collection.
- [ ] Extend authenticated usage API with bank summaries, provider detail, confidence/coverage and dated costs; preserve existing clients.
- [ ] Implement accessible mobile provider cards, separate daily/monthly summaries, countdowns, cost breakdown, filters and exports in existing settings.
- [ ] Regenerate native web bundle and record whether an IPA update is required. Backend-only changes cannot install new bundled UI.
- [ ] Validate, inspect diff, capture UI evidence when tooling permits and update draft PR with actual remaining limitations.

## Required behavioral validation

Tests must exercise real production helpers and integration boundaries:
- Duplicate events across engine/gateway/Worker, distinct retries, concurrent calls, reservations and late completion.
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

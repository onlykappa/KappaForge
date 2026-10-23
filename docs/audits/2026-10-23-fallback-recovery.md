# AI fallback and quota recovery audit

Reviewed baseline: `9d210aeab64bdf6987cc47f95c7af52fbbc2beb3` (main).

## Result

Quota fallback is coordinated across chat and coding through the owner's Durable Object. It skips unavailable routes, persists cooldowns, releases leases, and can resume saved development tasks. Six gaps were corrected in this PR. Recovery remains bounded by the owner's task authorization and recovery budget; daily exhaustion cannot always recover automatically within those bounds.

This is a source audit with deterministic fault injection and browser regression checks. No production credentials, provider quota, paid inference, deployments, or live task dispatches were used to validate it. Discovery is not proof of inference capacity.

## Corrected findings

1. **Incomplete coding output could be returned as success.** The coding stream collector fabricated `STOP` at EOF and accepted an explicit output-limit finish. It now requires `STOP`, except for Workers AI's existing implicit-finish contract. Explicit non-success finish reasons on buffered coding responses also trigger fallback. Partial code is never returned as the completed gateway result. Tests inject clean premature EOF, output-limit truncation, malformed SSE, and buffered truncation, followed by a successful alternative.
2. **A final route's permanent failure could stop recovery for other routes.** `engine/gateway.py` inferred terminal exhaustion from the final route's category alone. A quota-throttled model followed by a rejected credential could therefore prevent checkpoint continuation. A future retry deadline or transient attempt history now preserves bounded recovery. Gateway-level authentication errors and explicitly pinned execution retain their terminal behavior.
3. **Retry timing depended on route order.** Coding could erase an earlier cooldown when a later outcome had no deadline; both callers could replace an early reset with a later one. Both now preserve the earliest future route deadline. One recovering eligible route is enough to retry; a successful reservation still rechecks its actual quota and account health.
4. **Anonymous login refusals skipped an entire provider in the current request.** Durable state correctly scoped an anonymous HTTP 401 to one model, but chat and coding still excluded every remaining model from that provider. Both callers now distinguish rejection of a configured key from a model requiring login. A real rejected key still blocks the account; another anonymous model can answer immediately.

5. **Repair targets disappeared between model prompts.** Required source paths are now prioritized deterministically and reloaded from the current candidate after compaction or a checkpoint restore. Changed files and dependencies named by review precede unrelated source. Each required file receives a budgeted excerpt including its header; repairs split into smaller stages if the required excerpts cannot fit. The read-before-edit and exact-anchor guards remain enforced. The status card explains that a file is missing from the current model context instead of implying it was never read.
6. **Output-limit cutoffs put healthy models into outage backoff.** Explicit `MAX_TOKENS` / OpenAI `length` finishes now record `206/output_limit` for streamed and buffered coding/chat answers. This releases the reservation without creating an outage cooldown or granting credit for a complete coding answer. Partial chat text and provider usage are retained, including stream usage trailers. Actual exhausted quota headers still rest their real bucket. New tests repeat cutoff/short-request cycles immediately and verify that late partial results cannot clear newer quota failures. Premature EOF, malformed data, and transport errors retain normal failure handling.

## Protocol trace and verification

| Stage | Behavior inspected | Evidence |
| --- | --- | --- |
| Route eligibility | Server provider/channel/private-code permissions, reviewed models, device exclusions, context, tool/media support and explicit model pins constrain fallback. No alternate endpoint bypasses the coding gateway. | `routing-policy.test.mjs`, `free-route-policy.test.mjs`, `test_integrated_router.py`, `test_gateway.py` |
| Request admission | Shared daily/minute request caps and single-use coding request IDs apply before provider dispatch. New legitimate retries use new IDs. | `routing-policy.test.mjs`, `fallback-recovery.test.mjs` |
| Provider admission | Atomic leases prevent concurrent callers exceeding configured account/model slots. Local request/day/minute-token counters and persisted cooldowns skip unavailable routes before inference. | `provider-limits.test.mjs`, `routing-policy.test.mjs` |
| Upstream limits | HTTP 429 records Retry-After and exhausted header resets. Gemini daily quota details select the configured quota-day end; per-minute retry details avoid an unnecessary daily wait. | `provider-limits.test.mjs`, `routing-policy.test.mjs` |
| Scope | Authentication blocks keyed account pools; model access/billing/not-found and deployment/server failures rest individual routes. Keyless login requirements rest a model. | `all-model-opt-in.test.mjs`, `fallback-recovery.test.mjs` |
| Recovery | An all-throttled request makes no new inference calls during cooldown; a fresh request after reset succeeds, clears the recovered route, and leaves no active lease. Reusing its request ID is rejected. | `fallback-recovery.test.mjs` |
| Completion | Explicit output caps release leases without outage backoff; actual quota still applies. Malformed/empty coding output and interrupted or truncated streams fail over; chat preserves already-delivered partial text and emits a controlled error instead of replaying it. | `fallback-recovery.test.mjs`, `provider-reliability.test.mjs` |
| Concurrency and late results | Outcome writes are idempotent. Expired leases retain attribution. Older success and cancellation cannot erase newer account failures. | `routing-policy.test.mjs`, `recovery-wake.test.mjs` |
| Repair context | Required source survives compact retries and restored checkpoints, using current candidate content; the read-before-edit guard is preserved. | `test_recovery_journal.py`, `test_gateway_request_budget.py`, `chat-activity-ui.test.mjs` |
| Task continuation | The journal saves candidate/work state and retry time. Trusted recovery checks scope, expiry, owner cancellation, continuation claims and budgets. Event wakeups have a scheduled five-minute fallback. | `test_recovery_journal.py`, `test_generation_recovery.py`, `recovery-wake.test.mjs` |

Tests in the table are under `tests/`.

## Remaining boundaries and operational implications

- **Daily reset beyond the recovery window:** `RecoveryJournal.defer` defaults to a six-hour wait ceiling, also bounded by authorization expiry minus 20 minutes. A reset tomorrow can exceed that ceiling. The checkpoint is preserved and the task pauses; the owner must renew/retry it after capacity returns. This PR preserves those safety bounds rather than extending task authority implicitly.
- **Quota accounting is local evidence:** reservations enforce configured RPM/RPD/TPM. Published daily-token limits are displayed but are not an atomic TPD admission counter in `routeQuota`. Provider usage outside KappaForge is unknown; the upstream can still return 429. Cooldown and fallback handle that refusal. A strict account-wide TPD guarantee needs a separate accounting design.
- **Credential rotation:** account blocks use a key fingerprint, but local quota counters use provider/model keys. Replacing a rejected key avoids its account block; it does not automatically reset already-used local daily counters. Route cooldowns also remain model-scoped across credential changes.
- **Chat and attachments:** already-streamed chat text is preserved, with a manual retry after interruption. It is not silently replayed to another provider. Attachments stay on media-capable routes; text-only fallback cannot rescue a file request when Gemini capacity is unavailable.
- **Fail-closed coordination:** unavailable Durable Object storage stops inference rather than dispatching uncoordinated calls. Successful output whose outcome cannot be persisted is not guaranteed to reach the client as success. Leases expire, and retries remain bounded.
- **Timing is best effort:** a recorded reset is a retry opportunity, not a capacity promise. GitHub scheduling can delay continuation, provider limits may change, and attempt/deadline budgets may prevent trying a very large catalog in one request. Private-code permissions, pins, disabled providers and fallback-off choices can intentionally leave no alternative.
- **Premium remains explicit:** the existing opt-in/rescue authorization and spending caps remain authoritative. No paid route or full-catalog permission is added by this PR.

The repository policy mentions `engine/validate_change.py`, but that file is absent at the reviewed baseline. Validation uses the existing independently executed regression suites, web checks and Worker build; no validator was invented or weakened.

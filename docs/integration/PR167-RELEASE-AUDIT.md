# PR #167: task submission repair, release and audit

## Reviewed baseline and scope

Owner authorized merge, Worker deployment, native publication and an audit before
device testing. Reviewed PR head `ef8a1cfe9d369bcd2fb57a4dad5033f5beac4dc6`
against main `d798ac6c4e7025fe007d86eeece1a0f5b6427f21` in an isolated checkout.
Existing Linux/browser CI 39535430365 and native CI 39535430339 passed at that head.
Acceptance-task PRs and the unfinished weather feature remain separate and unmerged.
No provider inference, weather dispatch or policy/billing change is authorized here.

## Findings and fixes

- The frontend and Worker preserve a task brief through 20,000 characters. The
  reviewed follow-up removes silent brief slicing in file selection, development
  generation, independent review, saved-branch repair and sandbox coding. Boundary
  fixtures check the final requirement reaches each actual model consumer; a valid
  edit must still pass the existing edit/path checks. Context and output limits
  are unchanged: an oversized complete model prompt can fail explicitly rather
  than quietly omit requirements. This does not guarantee provider capacity.
- Task submissions await the task action and return before ordinary `/chat`.
  Fixtures cover start, approval and retry paths and preserved saved message text.
  Ordinary conversation context limits remain separate from task brief limits.
- Exact payload fingerprints, one-use claims, cancellation, expiry and private-code
  permissions retain their existing enforcement. Exactly 20,000 characters are
  accepted; over-limit text fails before authorization is issued. A changed tail
  and a repeated claim are rejected.
- Cooldowns prefer explicit Retry-After. Without it, parse compound reset
  durations and honor the latest exhausted pool, ignoring pools with remaining
  capacity. Groq documents request headers as daily and token headers as per-minute;
  a non-exhausted daily reset is not evidence of a daily-quota failure.
  See [official header semantics](https://console.groq.com/docs/rate-limits).
- Chat transport errors now return their durable cooldown instead of a generic
  502 that loses the deadline. Normalization errors retain the actual upstream
  status (for example HTTP 200 with malformed JSON), not an invented upstream 502.
  Fixtures verify error sanitization and suppress subsequent inference in cooldown.

## Verification and release gate

Focused fixture tests passed locally. Full Windows runs expose existing CRLF
source-extraction/parser-hash differences and two NamedTemporaryFile sharing errors.
These must be distinguished from Linux CI results; no assertions were weakened.
Fresh exact-head Linux/browser/native CI is required before merge. Deployment and
publication evidence will be added after those operations actually succeed.

Deployment uses the established protected workflow with keep_vars, pre/post binding
fingerprints, health and no-inference authentication checks. No migration, Durable
Object deletion, secret replacement or provider enablement is part of this release.
The iOS workflow must publish the unsigned IPA from the merged source, after simulator
tests, device compilation and byte-for-byte shared frontend packaging checks.

## Operational limits and rollback

The submission fix does not implement weather, restore expired task authority,
establish remaining provider quota, or prove a live model has inference capacity.
No provider calls are part of this audit. Physical-device installation/behavior
remains an owner check after publication.

For rollback, revert the scoped PR through review and the same deployment process;
preserve dashboard settings, secrets and existing Durable Object storage. Do not
restore direct-key fallback or broaden provider permissions. Retain the prior
published IPA if a native rollback is needed; sign with the existing identity and
install over the same bundle identifier to retain app data. Do not uninstall first.

The old weather task #130 has expired authorization and prior failed attempts.
A retry must be a new explicit owner operation; this release must not dispatch it.

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
  Numeric Retry-After now uses the same existing seven-day safety bound as date
  values, so an explicit daily cooldown is not silently shortened to one hour.
- Chat transport errors now return their durable cooldown instead of a generic
  502 that loses the deadline. Normalization errors retain the actual upstream
  status (for example HTTP 200 with malformed JSON), not an invented upstream 502.
  Fixtures verify error sanitization and suppress subsequent inference in cooldown.

## Verification and merged source

Focused fixture tests passed locally. Full Windows runs expose existing CRLF
source-extraction/parser-hash differences and two NamedTemporaryFile sharing errors.
These must be distinguished from Linux CI results; no assertions were weakened.
Final reviewed head `9dbb97081cf6e56c8692a1acb98c3d47d6686b17` passed
[Linux/browser CI 39538864482](https://github.com/onlykappa/KappaForge/actions/runs/39538864482):
357 Python tests, 359 JavaScript tests, Chromium and mobile WebKit flows. Streaming,
stop/interruption, persistence, task progress, reload deduplication, authorization,
recovery, provider permissions, quotas and malformed responses use deterministic
fixtures. [Native CI 39538864475](https://github.com/onlykappa/KappaForge/actions/runs/39538864475)
passed simulator compilation, launch/UI tests, device compilation and IPA packaging.

[PR #167](https://github.com/onlykappa/KappaForge/pull/167) was squash-merged as
`682201d3f49fcbfaccb80676066307dc58607778`. Its Git tree equals the reviewed head;
no untested source was substituted. Acceptance drafts #153, #156, #158, #164 and
the unfinished weather draft #133 remain unmerged.

The additional broad local sweep passed 428 JavaScript tests; the only failing
extra entry point is unchanged `tests/ui-chat.test.mjs`, which imports undeclared
`jsdom` and tests a hand-built rendering stub. It is outside the required npm
suite. Both that file and package.json are byte-equivalent in content to pre-PR
main d798ac6. The advisory dependency map is stale on that baseline as well as the
release; its check is a warning by established CI policy. Neither baseline issue
was hidden by weakening tests or adding unrelated dependencies. Both locked npm
dependency audits reported zero known advisories on 2026-10-21 UTC. Source versions,
23-file bundle synchronization, JavaScript syntax and Worker dry-run passed.

The broad audit traced the changed path and adjacent boundaries against production
source rather than treating successful configuration as functional acceptance:

| Area | Evidence and result |
| --- | --- |
| Task text and duplicate calls | Real frontend VM/planner/Worker fixtures plus five coding-consumer tests; full brief and tail retained; task action skips competing chat. Native composer bridge forwards full text without a substring cap. |
| Authorization | Real fingerprint/DO transactions reject altered payloads, duplicate/concurrent claims, cancelled and expired authority. Existing Python guard rechecks current issue before mutation. |
| Recovery | Existing journal/runner fixtures cover crashes, cooldown waits without debiting continuations, replay, concurrent branch updates, saved candidates and duplicate PR avoidance. |
| Routing and failures | Shared JS/Python registry, server permissions, fixed upstreams, free-model filters and runner-only gateway remain enforced. Fixtures cover quota pools, leases, idempotency, cooldowns, authentication and malformed responses. |
| Streaming and app state | Chromium/WebKit fixtures cover incremental output, stop, partial failure, task progress, multiple chats, reload and persistence. Native simulator tests cover launch, navigation, keyboard and progress fixtures. |
| Release and data | Protected deployment preserves binding fingerprints; no storage schema/state rewrite. Native ID and persistent WebKit store unchanged. Published IPA provenance/content checks are recorded separately below. |

Physical iPhone signing, update installation and weather execution have not been
performed by this audit. No acceptance draft or unfinished weather source was merged.

Deployment uses the established protected workflow with keep_vars, pre/post binding
fingerprints, health and no-inference authentication checks. No migration, Durable
Object deletion, secret replacement or provider enablement is part of this release.
The iOS workflow published the unsigned IPA from the merged source, after simulator
tests, device compilation and byte-for-byte shared frontend packaging checks.

## Production Worker evidence

[Deployment 39539962014](https://github.com/onlykappa/KappaForge/actions/runs/39539962014)
passed at source `682201d3f49fcbfaccb80676066307dc58607778`, uploading version
`92bcd18c-54fe-4bad-9b8d-80a994d8fcd7` to
https://kappaforge-chat.ballaking1738.workers.dev. Pre-upload and post-deployment
fingerprints matched all 18 bindings, including 9 secret bindings. keep_vars and
the existing Durable Object binding/migration remain unchanged; no DO data was
cleared or migrated. Provider policies, dashboard variables and secrets were
preserved without printing values.

Health returned 200/ok. Actions KAPPA_ROUTER_URL matched the deployed origin.
Runner inference rejected no bearer (401), accepted the separate runner credential
far enough to reject malformed JSON (400), and rejected an invalid bearer (401/403).
Those checks stop before inference. The live-smoke workflow step was skipped.

Sanitized diagnostics observed Groq GPT-OSS 120B permission, binding, discovery200
and capability guards eligible; health clear, retryAt null; gateway requests
15/100 daily and 0/20 in the current minute. Historical HTTP 413 remained recorded
as provider_error; it is not evidence of account quota exhaustion or an active
cooldown. Remaining provider quota is null/unknown. Discovery and eligibility
are not inference-capacity tests. No provider inference was attempted.

## Published app and final artifact audit

[Main Linux/browser CI 39539961991](https://github.com/onlykappa/KappaForge/actions/runs/39539961991)
and [native/release run 39539961927](https://github.com/onlykappa/KappaForge/actions/runs/39539961927)
passed at merged source `682201d3f49fcbfaccb80676066307dc58607778`.
The release native job passed all four XCTest cases with zero failures, both simulator
and device builds, rendered screenshot validation and IPA archive validation.

**Published:** [KappaForge v2.2.13](https://github.com/onlykappa/KappaForge/releases/tag/v2.2.13),
2026-10-21 03:51:40 UTC, draft=false, prerelease=false. GitHub's latest-release
endpoint selects this native version. Both release target and tag resolve to
`682201d3f49fcbfaccb80676066307dc58607778`.

- [Published KappaForge-unsigned.ipa](https://github.com/onlykappa/KappaForge/releases/download/v2.2.13/KappaForge-unsigned.ipa),
  asset ID 661278526, 273416 bytes.
- Downloaded release asset SHA-256 matches GitHub's asset digest:
  `54599b9b7d93a32b4fc70ab5fdb364164abed4ef90bafc2f2cc02f8add73d7e1`.
- Independent archive inspection passed CRC, arm64 Mach-O executable, icon/assets,
  bundle ID `com.onlykappa.KappaForge`, version 2.2.13 and build 20.
- All 23 bundled shared files matched the merged Git blobs, with the three generated
  version files reproduced through the repository's configure.generated function
  using the published version, UTC build date and merged commit title. This includes
  the actual fixed app-main.js and app-dashboard.js. A PR artifact was not substituted.

Release and broad audit are complete; ready for owner installation and device testing.
The new app is required for the bundled submission fixes. The Worker is already deployed.
The existing Phase 5 integration acceptance remains recorded separately; this maintenance
release has not run another live inference or weather task.

## Installation and owner test

1. In KappaForge open Settings -> Updates -> Check for updates.
2. Choose Download IPA for SideStore, then Install with SideStore and select SideStore.
   Alternatively import the published IPA above from Files in the existing SideStore setup.
3. Sign/install over the current KappaForge app with the same Apple ID/team and bundle
   identifier. Do not delete the existing app or replace provider credentials.
4. Fully reopen the app and confirm installed version 2.2.13 in Updates.

Only after the owner is ready, the existing explicit retry control accepts
`Retry task #130.` It creates fresh retry authorization while preserving the existing
weather task and draft PR; it is not an instruction executed by this release.
Actual model capacity and completion of that unfinished weather feature remain unverified.

## Operational limits and rollback

The submission fix does not implement weather, restore expired task authority,
establish remaining provider quota, or prove a live model has inference capacity.
No provider inference calls are part of this audit. Physical-device installation/behavior
remains an owner check after publication.

For rollback, revert the scoped PR through review and the same deployment process;
preserve dashboard settings, secrets and existing Durable Object storage. Do not
restore direct-key fallback or broaden provider permissions. Retain the prior
published IPA if a native rollback is needed; sign with the existing identity and
install over the same bundle identifier to retain app data. Do not uninstall first.

The old weather task #130 has expired authorization and prior failed attempts.
A retry must be a new explicit owner operation; this release must not dispatch it.

## Subsequent owner task #169 and follow-up repair

After the v2.2.13 release, the owner started weather task #169. Its planning call
completed on Gemini; its generation request exceeded the gateway byte cap. This
separate source-context construction defect was not covered by the earlier
submission fixtures. Empty policy-excluded provider model lists also triggered
misleading invalid-key warnings in Settings. Both confirmed defects are addressed
by merged [PR #170](https://github.com/onlykappa/KappaForge/pull/170), not by changing
the weather feature or replacing credentials. See
[TASK169-GATEWAY-REPAIR.md](TASK169-GATEWAY-REPAIR.md) for exact failure geometry,
provider eligibility evidence, focused regression coverage, deployment and native
release status. Historical #130 instructions above are not a request to retry it.
Only a fresh owner action may resume #169. No weather retry or provider inference
was sent by either maintenance repair/audit.

The follow-up Worker deployment passed with all 18 bindings/nine secrets preserved.
[v2.2.14](https://github.com/onlykappa/KappaForge/releases/tag/v2.2.14) is published
from merged source `03182fb2305187e4e93a880c030e36e0be86b9d4`; its downloaded IPA
passed checksum, native identity/executable and all 23 bundled-file checks. The
owner should install v2.2.14 over the existing app before explicitly retrying #169.
This supersedes v2.2.13 installation advice for this repair, while retaining the
earlier release's historical verification. No weather feature completion or
remaining inference capacity is established by the repair.

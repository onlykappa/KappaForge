# Phase 5: final verification and operational handoff

Updated 2026-10-21 UTC (2026-10-20 owner local date). **PARTIAL.** Actual app-started execution and persistence after reopening remain required. An executor-created issue, model discovery or fixture test cannot substitute.

## Baseline and promotion

- Isolated branch `codex/phase5-release-handoff` started at audited Phase 4 `b17f54f9b621a835182a96a1bfcc2153e5542166`. Other worktrees and runtime data are preserved. Phase 4 exact-head Linux CI [39526705871](https://github.com/onlykappa/KappaForge/actions/runs/39526705871) passed.
- Owner Phase 5 instructions superseded the earlier no-merge/deploy/release restriction. [PR #150](https://github.com/onlykappa/KappaForge/pull/150) merged as `ab30caa983b74ec7fc1cd55920e280c2d5c24d1c`; canonical Phase 3 [PR #146](https://github.com/onlykappa/KappaForge/pull/146) merged as `1a79c7b561644aa16d3c980cfe3b238cbb0e753f`. Main CI [39527477196](https://github.com/onlykappa/KappaForge/actions/runs/39527477196) and [39527533194](https://github.com/onlykappa/KappaForge/actions/runs/39527533194) passed. Unrelated PRs remain untouched.
- [Deployment 39527477187](https://github.com/onlykappa/KappaForge/actions/runs/39527477187) deployed source `ab30caa983b74ec7fc1cd55920e280c2d5c24d1c`, Worker version `22c1c5ac-7793-4350-b6c7-f1b82dc92a79`. URL **https://kappaforge-chat.ballaking1738.workers.dev** matches Actions `KAPPA_ROUTER_URL`.
- Production health passed. Unauthenticated inference returned 401; invalid runner credential was rejected; valid runner credential plus malformed JSON returned 400 before inference. Diagnostics passed secret presence, free/coding/private-code permissions, discovery/capabilities and recorded guards. These diagnostics do not establish provider inference capacity.
- One deployment inference returned HTTP 200 on `groq:openai/gpt-oss-120b`, fallback false, max completion 256, low reasoning. Reported usage **78 input + 22 output = 100 tokens**. Provider remaining allowance is unknown.

## Architecture and previous phases

Phase 1 supplied verified standalone OmniRoute artifact/protocol evidence; see [Phase 3](OMNIROUTE-PHASE3-CHECKPOINT.md) for its exact source. The owner replaced Phase 2's Linux host prerequisite with the existing Worker, SQLite `KappaMemory` Durable Object and Actions. No extra host, DNS, localhost, Windows process or always-on personal computer is required. Standalone Phase 2 deployment/restart/backup tests were not performed and remain unverified.

`config/providers.json` is shared by JavaScript/Python. Chat/planning (`/chat`, `/plan`) and runner-only inference (`/router/infer`, `/router/diagnostics`) share policy and persistent quota/health state. Long-running execution, validation, branch and draft PR creation stay in Actions. `/authorize` and `/jobs` preserve scope, repository/private-code permission, cancellation and expiry. Upstream destinations are fixed registry entries. Direct-key fallback remains disabled.

Owner-bound `Inference route: groq:openai/gpt-oss-120b` and `Edit path: docs/integration/<new-file>.md` fields restrict bounded tests. Pinned coding keeps fallback false, low reasoning, at most four calls, 768 output tokens, 26,000 prompt characters and a persisted minimum 65-second interval. These bounds do not establish a token balance or spending guarantee. Gateway caps remain 100/day and 20/minute. Reservations/leases, reset times, account/model cooldowns and idempotent outcomes stay in the existing DO. Estimates, measured usage and unknown provider allowance remain distinct.

Only routing, compatibility and reliability behavior was selectively integrated from OmniRoute. No Next.js app, desktop service, native SQLite dependency, credential store or coding loop was moved into a Worker. Existing upstream notices are retained; Phase 5 adds no copied upstream source.

## Phase 5 implementation

- The current user request can select the same bounded Groq pin for chat/planning, overriding saved Gemini for that request only. Duplicate/unsupported pins fail before inference. Prior messages, assistant text and planner background cannot set it. Server permissions/capability filters still apply; model output cannot start tasks. A pinned chat/plan uses at most 768 completion tokens, low reasoning and no fallback. No native/app source changed; no IPA update required.
- A redundant review request for already fully supplied candidate source no longer consumes another inference call or invents missing evidence. Partial/omitted/unavailable source, unmet requirements and concrete defects still block.
- In-task self-review repair tests document newness against the original immutable file list. It can correct its own new document while denying originally existing files. Saved-PR repair requires the GitHub delta to contain only the exact task-owned added document; modified baseline files and broader diffs are denied. Both paths have fixtures; no complete autonomous live repair is claimed.
- Deployment reads the fixed Cloudflare Worker settings endpoint before/after upload using the existing protected credential. Opaque fingerprints cover plain variables, secret presence and DO binding metadata; snapshots have no secret values and are not uploaded. A mismatch fails for investigation without overwriting owner changes. `keep_vars=true`, dashboard allowlists and existing DO migration remain intact.

## Bounded live task and discovered defects

Owner authorized the executor to start [issue #157](https://github.com/onlykappa/KappaForge/issues/157). [Run 39528019222](https://github.com/onlykappa/KappaForge/actions/runs/39528019222) ran on main `1a79c7b561644aa16d3c980cfe3b238cbb0e753f`, isolated branch `kappa/dev-157`, one new `docs/integration/PHASE5-RELEASE-SMOKE.md`. This is **not app-started evidence**.

All three gateway calls returned HTTP 200, exact `groq:openai/gpt-oss-120b`, fallback disabled, max output 768:

| Request ID | Input | Output | Total |
| --- | ---: | ---: | ---: |
| `839b0fc1-aa26-46ac-a4f7-5ca6de77bca8` | 4,688 | 172 | 4,860 |
| `69a17286-4085-4262-bbd4-a73adf463e4b` | 2,738 | 294 | 3,032 |
| `2e811fc3-54d6-4401-8a85-4243ec0cb759` | 2,791 | 372 | 3,163 |

Total **11,055 reported tokens**. No provider capacity failure occurred. Local review/repair failed: redundant source requests consumed two review calls; candidate sizes then made repair raise `PermissionError: Bounded documentation task requires a new file`. This was neither provider capacity nor account quota. The original Phase 4 run's discarded upstream 503 details remain unrecoverable; do not retroactively attribute that failure.

[Draft PR #158](https://github.com/onlykappa/KappaForge/pull/158) preserves `e69c8e60151a125be9d1b34f07dfcf4ef38123c5`. Independent complete-diff review confirmed only the authorized six-line Markdown file, exact heading/four bullets, no existing edits. The placeholder source-review finding was explicitly resolved with that manual evidence. This is not successful autonomous repair. Exact-candidate sandbox [39528701095](https://github.com/onlykappa/KappaForge/actions/runs/39528701095) passed with automatic inference repairs disabled. Verification-only [39529072466](https://github.com/onlykappa/KappaForge/actions/runs/39529072466) passed without inference, published ready status, completed the checklist step, cleared the active error/deadline and retained the original failure in history. Candidate unchanged; no automatic continuation. App rendering of that refreshed state remains unobserved. No new live task/retry is automatically authorized.

Acceptance PRs #153, #156 and #158 remain draft/unmerged. Do not reopen #151/#154. The initial failed task run stays failed; any verification-only recovery is separate evidence.

## Validation and acceptance gates

- **26 focused Node tests passed**: current pin overrides Gemini for authenticated chat/planning, preserves permissions, cannot dispatch a task, no fallback after failure, malformed/duplicate pin, planner background isolation, bounded outgoing Groq payload, binding order/variable/namespace fingerprints and secret redaction.
- **41 focused Python verification/gateway tests passed**: actual generation can repair its own new document, including from a saved added-file PR; pre-existing/broader diffs stay denied; redundant inspection avoids inference; partial/missing evidence remains enforced.
- Worker dry-run passed (221.62 KiB, 58.97 KiB gzip). Phase 5 full Linux CI and deployment are pending at this save.
- Windows broad checks encountered previously documented CRLF source-fixture, parser byte-hash and open `NamedTemporaryFile` permission failures; default Python encoding additionally caused Unicode decode errors. `check-web.py` invokes the unavailable system `python3` alias. These are local platform limits, not claimed green checks. Required Linux CI is the promotion gate; baseline Linux CI passed. No native bundle source changed.
- Installed-app chat/planning on this backend, launch through `/authorize` → `/jobs`, truthful final progress and persistence after reopening remain **UNVERIFIED**. Earlier screenshots of other tasks and navigation do not prove this path.

## Cost evidence and exclusions

Owner confirmed free account tiers for Groq/NVIDIA/Gemini/Mistral/Ollama. Keys/allowlists are not billing evidence. No plans, credits, limits or billing settings changed. Account billing consoles and remaining allowance are inaccessible here; never claim guaranteed $0 from source code/request caps. Cloudflare requests/DO storage, runner/artifacts, Workers AI and inference are separate allowances.

- [Groq free-plan limits](https://console.groq.com/docs/rate-limits) list GPT-OSS 120B including 8K TPM; 429/Retry-After governs exhaustion. Actual organization limits may differ. [Billing FAQ](https://console.groq.com/docs/billing-faqs) distinguishes upgraded Developer billing. Tier is owner-confirmed; model/quota documentation independently checked; successful usage observed; remaining balance unknown.
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) lists the registry Flash Lite free tier and separate paid tier. Existing reviewed configuration is preserved. No Gemini live test occurred; optional routes do not block Groq-only release.
- NVIDIA [trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) include evaluation restrictions. Mistral [billing](https://docs.mistral.ai/admin/billing-usage/billing) depends on plan/credit/auto-recharge settings not independently inspected. [Ollama pricing](https://ollama.com/pricing) separates starter usage from added credits; configured models were not proven starter-only. These remain excluded by reviewed-free-model policy despite keys/allowlists.
- [Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) documents SQLite DO Free limits and failure after caps; it does not establish this account's actual plan. Owner should retain Free and verify no paid/automatic billing path before calling overall operation guaranteed $0. No limit increase is requested.

## Deploy, rollback and exact resume

1. Review focused Phase 5 PR and required Linux checks, merge under existing authorization, allow backend deployment in `cloudflare-production`. Preserve `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KAPPA_ROUTER_TOKEN`, `KAPPA_ROUTER_URL`; no new secret, binding or migration. Use diagnostics-only marker as needed, not another automatic live-smoke marker.
2. Record source SHA/version UUID/run. Verify pre/post binding equality, health, URL and runner authentication without inference. Diagnostics establish guards only; the three successful task calls above prove actual usage at that baseline.
3. PR #158 sandbox and verification-only recovery passed. Review its saved result without further inference; preserve initial failure and manual-review distinction. Leave its draft unmerged unless the owner separately chooses its disposition.
4. After backend pin deployment, owner app action: request one small new Markdown note with literal `Inference route: groq:openai/gpt-oss-120b` and an unused `Edit path:`. Tap Plan task and its explicit launch/approval control. No Model manager change is needed. Report task number, reopen app and confirm same task/result/draft persists. The executor can follow cloud evidence after this phone action. Stop after a capacity failure; no automatic retries.
5. Keep `gateway-v1.0.0` release draft until app acceptance passes. `config/integration-release.json` versions this backend component separately. Publish with `make_latest=false` at the tested main SHA and record its URL; preserve latest IPA release. Backend changes need reload/retry of the request, not a new IPA.

Rollback: inspect current deployment to avoid overwriting another session, then restore verified Worker `22c1c5ac-7793-4350-b6c7-f1b82dc92a79` (source `ab30caa...`) using Wrangler version rollback in the same protected environment. Repeat health/auth checks. Preserve variables, secrets, DO data and migration; no state rewind. Revert focused source changes through a reviewed commit if Actions rollback is needed. Never restore direct-provider fallback or relax auth. This rollback removes planner request pin support but preserves coding task pins.

Rebuild from repository/locked Node dependencies and approved server secret stores; no personal device services required. No private database, credentials or real DO/vault backups enter Git/artifacts. Standalone host backup/restore tests remain unperformed under the superseded architecture.

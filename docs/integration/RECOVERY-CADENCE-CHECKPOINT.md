# Task-start and recovery audit — 2026-10-21

Status: implementation under review; **unmerged and undeployed at owner request**.
Baseline main `6bbd1debed31df89e4d3a3eae09930797815c7c7`.
Branch `codex/task-start-recovery-audit`, isolated checkout; unrelated worktrees preserved.
The older cadence/simulator record below remains historical evidence, not production
wake-up acceptance. No weather or acceptance PR is being merged.

## Task #174: exact observed boundary

[Run 39603920228](https://github.com/onlykappa/KappaForge/actions/runs/39603920228)
acknowledged and read 243 source files, then stopped at the **gateway reservation**.
Request `fdeb11ac-83f4-4aa3-b6d7-8c43ea2589b8`, prompt36804 characters, maxTokens8000:
HTTP429 `free_capacity_cooldown`, source `coordination`, category `provider_outage`,
historical upstreamStatus503, retryAt `1792587612221` milliseconds. No fresh provider503
is evidenced by this final failure; it cannot rule out an earlier attempt in the route loop. It is neither a fresh upstream429 nor proof of
account quota exhaustion, concurrency saturation, authentication failure or a gateway
minute/day cap. The matching reserve path returns an active stored pool/route cooldown
before checking concurrency. The response describes only the final route; earlier routes
may have been attempted. Fresh13:35 diagnostics found a Groq historical413 at12:58:44.409
UTC, close to this request, but existing shared-state metadata cannot correlate it to
a particular request. No fresh503 is established for #174. Actual failed provider/model was absent in this old response;
remaining provider allowance and usage are unknown. Do not guess them from eligibility.
The saved checkpoint is unchanged main `6bbd1de...`, files empty, no task PR, continuations0.

Eligibility `1792587642221` = 2026-10-21 13:00:42.221 UTC / 06:00:42 PDT includes the
existing 30-second margin. Checkpoint/progress updated 12:58:47/49 UTC. Screenshot6:09
PDT is consistent with these units; no timezone arithmetic defect was found.
The enabled recovery workflow (ID390098783) had **no observed scheduled scan** between
eligibility and issue closure. Its latest scheduled scan was
[39583498230 at10:17:28 UTC](https://github.com/onlykappa/KappaForge/actions/runs/39583498230).
Thus there is no scan skip/lease rejection to attribute to #174: no scan inspected it
in that window, no continuation ref was claimed and no continuation runner started.
The precise GitHub internal reason for absent schedule deliveries is not observable.

#174 was closed by `onlykappa` at13:09:59 UTC. It must stay stopped. The newly authorized
single continuation cannot proceed while closed; it was **not attempted**. #171 closed
at12:57:23 UTC; #174 was created at12:58:16 UTC with a distinct app authorization/request
ID `be56554a-057d-468f-b355-64bd86689479`. #169 and #171 have different IDs and checkpoints.
The backend Retry handler never creates issues. These records support a separate app
submission, not replay of one immutable authorization. They do not establish who tapped
which app control. #174's brief still ends at the supplied “Inspect the native iOS bridge
an”; the same end exists in the owner-provided text. No new 20,000-character truncation
or duplicate planner/chat inference was found in current submission code/tests.

## Confirmed defects and focused changes

- GitHub cron was the sole autonomous wake-up source. Five minutes is a minimum supported
  interval, not a delivery promise. Add task-driven alarms in a **separate `recovery-v1`
  instance of the existing KappaMemory class/binding**. No schema migration, provider key,
  external host or always-running Action is added. The existing account/vault/router
  instance `owner-v1` is preserved. Idle queue has no alarm. Up to32 pending tasks;
  original authorization and six-hour waiting bounds remain; one due task per
  alarm bounds Free-plan subrequests and respects the serialized Actions dispatcher; delivery is debited before
  network and stops after three ambiguous/failed deliveries. Diagnostics retain the stop.
- Runner-only `POST /router/recovery` accepts `{task}` and rereads the open owner task,
  durable cancellation record and trusted exact-scope bot checkpoint. It never accepts
  prompts, provider overrides, arbitrary workflows or URLs. `{task,statusOnly:true}`
  returns sanitized delivery state without dispatching. Browser tokens cannot access it.
- Alarms request only `recovery.yml` on main with that existing issue number. Python remains
  the authority for project access, candidate validation, atomic recovery refs and the
  per-task Actions queue. No inference runs in alarms/Workers recovery requests. Cron
  remains fallback. Initial submission registers a bounded acknowledgement watchdog too.
- Manual Retry/guidance of an existing waiting/running checkpoint joins the same wake-up
  path instead of blank-dispatching another agent. Neither HTTP202 nor elapsed cooldown
  is treated as a runner acknowledgement. Initial lost dispatch can recover the same issue.
- Lost acknowledgements/crashes reconcile after a two-minute acknowledgement window,
  retaining the same continuation token. Queued/active named agent runs suppress redelivery;
  an active previous runner cannot consume another continuation. Cancelled workflows stop.
- Exact-scope explicit renewal can carry the original candidate, budgets, requirements and
  failed approaches to the newly authorized identity. Changed briefs without that link are
  blocked; cancellation/expiry cannot silently renew. Replay and private-project checks remain. Every coding call rechecks current
  issue authorization before sending inference, including unpinned tasks.
- Preserve executionState/transition timestamps in progress. UI distinguishes cooldown,
  waiting for recovery, recovery requested, dispatch requested, confirmed GitHub queue,
  Actions started and acknowledged running. Receipt persistence keeps the last confirmed
  snapshot rather than replacing it with invented running progress. Silence is not failure;
  actionable delay offers existing-task Retry, with an in-flight duplicate-click guard.
- Expired gateway leases release concurrency but retain bounded late-outcome attribution.
  Replayed expired/completed lease IDs are refused. Cancellation only releases its lease;
  it cannot clear another failure. An old success cannot erase a newer account block.
  Structured authentication/access blocks stop recovery. Error evidence now includes a bounded per-route attempt history, the
  candidate provider/model and whether inference was attempted, preserving provenance.

- Groq's reviewed Free Plan table lists8K TPM for both approved models, separate
  from the131K model context. Add a conservative per-request token envelope with
  bounded output headroom; preserve exact input and return a typed preflight413
  if no route fits. This is an estimate/guard, not a remaining-token balance or an
  account-specific allowance. A large owner brief may not fit Groq; it is never
  silently shortened or sent to an unapproved provider. Other existing approved
  routes retain their own capabilities and permissions. Official source:
  https://console.groq.com/docs/rate-limits (checked2026-10-21).

## Validation and remaining gates

Baseline focused journal33 and routing19 tests passed. Initial updated focused journal41,
combined recovery/routing/progress55, native fixture/control transport3 passed. Worker
Wrangler4.151.1 dry-run passed:236.79KiB /62.44KiB gzip. Full local JavaScript386 tests and web/bundle checks passed in an isolated LF
snapshot. Python374 ran with only the two existing Windows temporary-file sharing
errors (workflow output files); the regression suite otherwise passed. Full
Linux/browser/native PR CI is required and results will be appended. Local Windows temporary-file sharing and CRLF
source-fixture issues are known baseline limitations; use isolated LF snapshots and
independent Linux CI. `engine/validate_change.py` is absent at baseline; do not invent a pass.

Native test now **taps real Retry and confirms the native dialog**, exercises production
`userAuthorizedFetch` through `/authorize` then `/retry` with isolated fake responses,
asserts one same-task request, preserves the candidate and reopens the persisted receipt.
Only Debug simulator code supplies these fixtures; every non-fixture destination is
rejected. Device Release builds exclude the fixture. Actual native CI observations and
screenshots must be recorded separately from Node fixture results.

Read-only Production [inspection39609368709](https://github.com/onlykappa/KappaForge/actions/runs/39609368709)
completed with the deploy job **skipped**. Chat permission is configured, Groq secret,
chat/free/coding policy and chat credential are present. No settings were written.
[Guard diagnostic39609364855](https://github.com/onlykappa/KappaForge/actions/runs/39609364855)
passed: model discovery200, Groq free/coding/private-code policy true, gateway day22/100,
minute0/20, recorded healthclear/no currentcooldown. Historical Groq failure413 at
12:58:44.409UTC remains visible. inferenceCapacity=unverified, provider quota unknown.
This is not another inference attempt and does not prove free capacity is available.
Fresh production health returned200 and unauthenticated `/router/infer` returned401.
Read-only configuration inspection and inference-free diagnostics are separate from
provider-capacity acceptance; see appended run evidence. Last established deployed source
is `03182fb2305187e4e93a880c030e36e0be86b9d4`, version
`f8b7ad28-4bbf-4385-b361-48349a5cc228`, deployment39545174469. Main/IPA fixes did not redeploy
the Worker. Published IPA remains v2.2.15 from `d1e61c499db85b28aedb457276b9071c74479e03`.
No live inference, task restart, new issue, merge, deployment, publication, credential
rotation, counter reset or DO-state deletion was performed in this audit.

## Cost, deployment order, rollback and exact resume

[GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
is best effort and has a five-minute minimum; do not configure one-minute GitHub cron.
[Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) offer
at-least-once wake-up with bounded platform retries, requiring idempotent handlers.
[SQLite Durable Objects Free allowances](https://developers.cloudflare.com/durable-objects/platform/pricing/)
include100,000 requests/day (alarms included),13,000GB-s/day,5million row reads/day,
100,000 row writes/day and5GB storage. On Workers Free, exceeded limits fail rather than
bill automatically. These are platform limits, not a verified reading of this account's
billing plan or remaining usage. The existing class is SQLite-backed; no upgrade or new
service is needed. Provider accounts remain owner-confirmed free/no-card; no provider is
enabled or paid fallback introduced. Quota remaining is unknown. Alarms and Actions still
have platform delays/outages; this implementation promises neither exact minute timing
nor inference capacity. Monitor allowances separately from provider quota.

**Do not promote now.** After owner review: verify the account remains Workers Free and
check current main/deployment/CI; merge only this focused PR if separately authorized.
Publish Actions first, then deploy Worker through existing preserve-settings workflow
(`keep_vars=true`, all18bindings/9secrets retained; no migration). New route uses existing
KAPPA_ROUTER_URL/KAPPA_ROUTER_TOKEN and Worker ROUTER_ACCESS_TOKEN/GITHUB_JOB_TOKEN; no
new secret or dashboard variable. Verify health/auth and inference-free recovery status.
Existing waiting tasks are not bulk-restarted: explicitly register only still-authorized,
uncancelled work after checking active runs/cooldown. Publish a new IPA for bundled UI
changes through established native process; PR artifacts are not a published update.

Task #174 is closed. Do not reopen it or replace weather automatically. Exact next live
action requires the owner to explicitly choose resumption of this same closed task and
renew authorization as needed, after deployment review. Before the single controlled
continuation inspect current state, runs and cooldown. Observe dispatch/runner/gateway/
inference/save; stop forced retries on another capacity failure. Do not manually implement
weather as cloud-engine evidence. Production alarm dispatch and inference remain unverified.

Rollback only focused code through review. Retain new scheduler storage keys/namespace
instance and existing routing data, variables, secrets, owner authorization and candidates.
A previous Worker has no alarm handler, so suspend pending scheduler alarms deliberately
under a reviewed operation before rollback; never delete the shared storage. Reverting
Actions/UI alone restores the cron-only timing limitation. Do not restore direct-key calls
or clear provider counters/health. Keep the prior IPA; install updates over the existing
app with the same signing identity without uninstalling.

---

## Historical PR #172/#173 record (preserved)

# Recovery cadence and native fake-task verification

Baseline: `0a6b07ce197ac9373ac7233b8ee69cc57626e2f0`.
Branch: `codex/recovery-cadence`, isolated worktree. Other sessions are preserved.

## Observed task #171

[Owner-started run 39595578701](https://github.com/onlykappa/KappaForge/actions/runs/39595578701)
saved progress after request `d0bb2c77-47fd-482e-85ae-84c5ba17c42e` returned
HTTP503 `free_route_unavailable`, with source `upstream`, category
`provider_outage`, upstreamStatus503. Prompt36751 characters, maxTokens8000;
route and usage were null. The evidence does not identify the actual failed
provider/model, establish remaining quota or indicate the earlier HTTP413 bug.
No direct provider fallback occurred. Candidate `0a6b07c...` and unchanged owner
authorization were saved; files remained empty and no task PR existed.
The checkpoint was eligible at 12:01:05 UTC after its 11:56:05 failure, but the
app still showed waiting at 12:13. A successful workflow means the checkpoint
was saved, not that inference or the requested weather feature succeeded.

## Implemented

- Recovery scans change from 15 to five minutes, off the hour at `2-57/5`.
  [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
  supports no shorter interval. Schedules may be delayed or dropped; neither
  five-minute execution nor one-minute execution is guaranteed.
- Transient provider failures become eligible after 60 seconds, retaining every
  later retry/cooldown plus the existing 30-second safety margin. Other failures
  retain the five-minute minimum. No existing nextAt is rewritten. Waiting scans
  cannot consume continuation attempts; atomic reservations, bounded delivery,
  cancellation, expiry, project permissions and candidate checks remain.
- A local reminder exposes READY TO RESUME and existing explicit Retry one minute
  after recorded eligibility. It does not declare failure or available capacity,
  dispatch a workflow, infer or reset authorization. The timer is labeled Waiting.
  A future cooldown suppresses this reminder. Expiry offers authorization renewal.
  New snapshots include scanIntervalSeconds300; old snapshots remain readable.
- A Debug-simulator-only fake task exercises future cooldown, the real local
  one-minute boundary (seeded at second59), explicit Retry visibility and full
  process-restart persistence. No real credentials, issue polling, task dispatch
  or inference are permitted. Fixture code is excluded from iPhone Release builds.

## Validation and delivery

Baseline focused Python31 and JS20 passed. New engine, UI, timing and fixture
tests exercise actual production helpers, not just copied mocks. Required
Linux/browser/native CI and the new native XCTest must pass before promotion.
Simulator and fixture results are not live provider recovery or a second physical
iPhone test. Initial validation used no live inference or weather retry; the
later owner-authorized real continuation is recorded separately below.

The Actions schedule/engine take effect on merged main. The bundled UI needs a
new published IPA. No Worker, provider key, dashboard variable, DO schema or data
change is required. Native screenshots and xcresult are retained by existing CI.
Runtime and publication evidence will be added when observed; implementation alone
does not establish publication or installation on the owner's phone.

## Observed verification and authorized real continuation

[PR #172](https://github.com/onlykappa/KappaForge/pull/172) merged as
`d1e61c499db85b28aedb457276b9071c74479e03`. Its tree matches tested head
`015a1447b5bc9a6549e14379863f28d823413f88` (`e998a891d9de7b656f2cb7c7323812c4498a2f95`).
[Linux/browser CI](https://github.com/onlykappa/KappaForge/actions/runs/39599520095)
passed 364 Python tests, 368 JavaScript tests and Chromium/mobile Safari regressions.
check-web.py passed with bundled Python, UTF-8 and the missing python3 alias mapped
to that same runtime. Local Windows temporary-file sharing/CRLF differences remain
the documented baseline. The absent engine/validate_change.py is also a baseline
limitation; independent trusted CI and targeted failure-injection tests were used.

[Native PR CI](https://github.com/onlykappa/KappaForge/actions/runs/39599520052)
passed all five native UI tests, builds, launch screenshot and IPA packaging.
`testRecoveryEligibilityAndReopenInNativeSimulator` passed in 22.380 seconds on an
**iPhone 16 Pro Max simulator**: no early Retry during a future cooldown, real local
timer crossing, Retry visibility and persisted eligibility after process restart.
Retained screenshot `F49EE5A0-267C-4688-B0DF-485FAB5460F3.png` was visually inspected:
Waiting time, READY TO RESUME and Retry render without obstruction. This is a
simulator observation, not a physical-phone test or provider-capacity guarantee.
[Main CI](https://github.com/onlykappa/KappaForge/actions/runs/39601296697) passed.

The owner subsequently explicitly requested the real task #171 continue. One
existing atomic queue reservation preserved its original authorization/candidate,
reserved continuation1 and dispatched
[Actions 39601496556](https://github.com/onlykappa/KappaForge/actions/runs/39601496556)
from merged main. At 12:41:10 UTC request
`fe15d2b7-7d6d-40d5-8ae0-1707bd8ebcbb` (36814 prompt characters, maxTokens8000)
again returned HTTP503 `free_route_unavailable`, source upstream,
category provider_outage/upstreamStatus503. Route and usage were null: the actual
failed provider/model and remaining quota are unknown. It saved back to waiting,
without code edits or a task PR. A successful workflow means checkpoint persistence,
not weather completion. No second manual retry was launched. Existing authorized
bounded recovery remains enabled; its future results must be inspected separately.
This real request is separate from the inference-free native simulation.

[Main native/release 39601296608](https://github.com/onlykappa/KappaForge/actions/runs/39601296608)
passed all five UI tests, including recovery/reopen again in 20.636 seconds.
[v2.2.15](https://github.com/onlykappa/KappaForge/releases/tag/v2.2.15) was published
2026-10-21 12:50:32 UTC from exact source `d1e61c499db85b28aedb457276b9071c74479e03`.
Its [KappaForge-unsigned.ipa](https://github.com/onlykappa/KappaForge/releases/download/v2.2.15/KappaForge-unsigned.ipa)
is asset662498458, 274342 bytes. Downloaded SHA-256 matched GitHub's digest:
`46b4de2c482e00ecc7a5871e7b42965ca706be4747204f02c67968318c0dbfe2`.
Independent archive inspection passed CRC, arm64 executable, icons, bundle ID
`com.onlykappa.KappaForge`, version2.2.15/build20 and all 23 shared files against
merged source plus reproduced version metadata. Debug fixture strings were absent
from the published device executable. Latest native release selects v2.2.15.
No Worker deployment, credential change, variable change or state migration occurred.

Owner installation: Settings -> Updates -> Check for updates; import the published
IPA into SideStore and install over the existing app with the same signing identity.
Do not uninstall. Fully reopen and confirm version2.2.15. Open existing task #171;
do not create a replacement issue. Its original authorization and bounded automatic
recovery remain. No further manual inference retry is authorized by this checkpoint
alone. Inspect latest progress before any separately requested retry. Installation
on the owner's physical phone and successful weather inference/implementation
remain unverified. Provider503 is separate from the verified queue/UI fix.

Rollback: revert only this scoped PR through required checks. Preserve task
checkpoints, authorization, candidates, credentials, DO data and provider limits.
Keep the previous IPA; install with the same signing identity without uninstalling.
Do not restore direct-key inference or restart weather as part of rollback.

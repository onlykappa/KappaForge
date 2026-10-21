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

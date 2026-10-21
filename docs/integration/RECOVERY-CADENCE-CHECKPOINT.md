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
iPhone test. No live inference or manual weather retry is part of this repair.

The Actions schedule/engine take effect on merged main. The bundled UI needs a
new published IPA. No Worker, provider key, dashboard variable, DO schema or data
change is required. Native screenshots and xcresult are retained by existing CI.
Runtime and publication evidence will be added when observed; implementation alone
does not establish publication or installation on the owner's phone.

Rollback: revert only this scoped PR through required checks. Preserve task
checkpoints, authorization, candidates, credentials, DO data and provider limits.
Keep the previous IPA; install with the same signing identity without uninstalling.
Do not restore direct-key inference or restart weather as part of rollback.

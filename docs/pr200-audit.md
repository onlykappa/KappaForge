# PR #200 audit and PR #102 integration

Reviewed the PR against `main` (`6182558`), including the implementation through
`38a6007` and the fixes in this commit. PR #102 is already merged; its task
progress layer is inherited by both branches. The audit covered shared routing,
owner restrictions, mixed scopes, authorization claims/receipts, local history
and compensation, cancellation evidence, rollout negotiation, runner-context
recovery, progress interpretation and dependent-action continuation.

## Findings addressed

1. **High — incomplete development could become verified.** Both ordinary passing
   reports and “Tests passed — but the work is not finished” previously became
   `tests-passed`. The parser now preserves incompleteness. Verification requires
   a current PR candidate, a complete-work sandbox report, and successful sandbox
   and iOS checks for that candidate. Human-readable report headings alone cannot
   establish current-candidate verification.
2. **High — failed investigations could become verified.** Failure now takes
   precedence over completion. Read-only work needs a fresh successful final
   `complete` report, rather than merely a finished flag.
3. **Medium — stopped or untested work could display passing tests.** Closing,
   cancelling or merging a task no longer manufactures test success. Skipped,
   neutral, cancelled, stale and unknown workflow conclusions do not count as
   passing checks. Chat and dashboard readiness use the same verified-task gate.
4. **Medium — validation could belong to another candidate.** Selection requires
   the exact task branch, full candidate SHA and known workflow path. Polling reads
   the current PR head and current workflow inventory. Newer rerun failures win
   over older passing reports. A moved head invalidates prior verification.
5. **High — saved routing evidence could outlive current proof.** A historical
   `verified` journal entry cannot release a software dependency by itself.
   Continuation also requires the matching tracked task, fresh candidate evidence
   and no polling error. Missing, stale, offline, changed-head and history-only
   records hold dependent work. Completed local actions are not repeated and the
   software action is not redispatched to obtain proof.
6. **Medium — stale workflow results could report or request repair.** Sandbox
   notifications and repair requests now confirm that the branch still points to
   the tested SHA. Workflow reports carry structured candidate/kind/result/run-ID
   metadata; sandbox reports also carry the complete-work flag. The task number
   is captured before other Bash regex checks, and the notification job has the
   read permission needed to inspect the candidate ref.

The shared router revision is **3**, so builds with the earlier verification
semantics receive an explicit compatibility response rather than silently using
the new Worker contract. The generated iOS web bundle is synchronized.

## Verification

- Standard `npm test`: **614 passed**.
- Complete Node test discovery: **723 passed**.
- Python discovery: **467 run, 3 skipped, no failures**.
- Desktop Chromium and mobile WebKit browser/accessibility regressions passed.
- Source syntax, configuration/version and generated bundle checks passed.
- Worker dry-run build passed.
- Production Bash notification/repair control flow was exercised with network
  calls replaced, including stale candidates, correct task targeting, incomplete
  work and candidate metadata. These tests do not dispatch live tasks or messages.

No further reproducible blocking defect was identified in the reviewed scope
after these fixes. Passing tests are evidence for the covered behavior, not a
guarantee about all natural-language requests or external-service failures.

## Remaining limits and rollout requirements

- Legacy reports without structured candidate/completion metadata cannot unlock
  software dependencies. Run the trusted updated workflows to obtain that proof;
  the app does not upgrade an older heading into verification.
- Workflow discovery is bounded to the latest 100 dispatch runs. Missing results
  remain unverified unless a matching structured report supplies the result.
  PR merge is not substituted for missing independent checks.
- Fresh evidence is required before open software tasks release dependent work.
  Polling outages or a head change can delay continuation; they do not authorize
  a retry, new coding task or weaker verification.
- The local receipt store, external-write crash window, browsers without Web
  Locks, cancellation coverage and disconnected-device rollout limits remain as
  documented in [operation protocol](operation-protocol.md).
- Hosted checks and native builds must be evaluated on the final pushed commit.
  No live production cleanup/task, PR merge, deployment or rollout-variable change
  was performed during this audit. Roadmap item 9 remains deferred.

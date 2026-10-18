# PR103: Live task progress

Last updated: 2026-10-18 (initial investigation)

## Scope and isolation
Base: `22871b42f36f4a13ba06c6f8e7a485229051cd47`; branch: `feat/pr103-live-task-progress`. Draft only. No merge or release. GitHub returned 404 for both PR and issue 102 at investigation time; do not alter any concurrent task.

## Acceptance and status
- [ ] Root cause verified and documented (in progress).
- [ ] Durable structured progress model and real execution events.
- [ ] Reference timeline, progress bar, elapsed timers and findings.
- [ ] Failure, retry, blocked, cancellation and stale states.
- [ ] Reconnect, restart and concurrent task isolation.
- [ ] Native iOS bundle integration and regression checks.
- [ ] Real screenshots compared to reference.
- [ ] End-to-end evidence recorded.
- [ ] Draft PR synchronized after each feature.

## Investigation
Read KAPPA.md and owner preferences. Existing `engine/developer.py::Progress` edits one bot comment. `preview/app-tasks.js` polls issue comments and `preview/core.js` recognizes progress headings. Existing UI tests already expect timelines, staged bars and findings. Missing-card root cause not yet established. Investigate submission tracking and renderer before changing CSS.

## Evidence and limitations
Reference images inspected in conversation. Direct GitHub git clone is unavailable in this environment; authenticated connector reads work. Source is being materialized through that connector. No tests or native build claimed yet.

## Checkpoints
Initial progress log only. Implementation pending.

## Resume
Finish source retrieval, inspect `preview/ui.js` renderTaskActivity, task submission in app-main.js and agent-work.js, and establish baseline tests. Add structured progress with compatibility for existing comments, then save each verified feature with this log.

## Feature 1 checkpoint: persisted client progress and launch visibility
Status: implemented; focused regression verification passed. Actual draft PR number is **102**, assigned by GitHub; PR/issue 102 did not exist before creation. Requested branch/log names retain pr103.

Verified causes: (1) `launchJob` previously saved a tracking record but inserted no progress message until a bot report arrived; (2) `runChatAction` ignored a false planner result, leaving the model's plan without an execution error; (3) comments were read only from the first 100 entries; (4) old progress comments were processed before retry timestamp checks; (5) task polling used a dashboard helper that could silently return cached data on failed refresh; (6) the 10-second timer cleared a failed request's backoff. All are corrected in the client checkpoint.

Changed: preview/task-progress.js, app-tasks.js, ui.js, design.css, index.html and generated native counterparts; tests/task-progress.test.mjs and tests/task-tracking.test.mjs. Versioned snapshots reject duplicate/delayed revisions and mismatched identities; queued/active timing is timestamp-based. Cards begin at confirmed dispatch and remain in the initiating chat. Live reference renderer implemented, awaiting browser screenshot validation.

Validation: 20 focused Node tests passed (task-progress, task-tracking, chat-activity-ui, task-autostart). `python scripts/check-web.py` passed syntax/configuration/bundle checks. Initial local source materialization added an extra terminal newline; corrected to exact baseline bytes before checks. No production end-to-end or native simulator claim.

Next: emit structured snapshots from real Python Progress transitions; add runner event tests, terminal state timing and stale indicators; run full baseline suite and mobile browser tests. Baseline Python suite output is being reviewed separately.


## Feature 2 checkpoint: real runner execution snapshots
Status: implemented and focused contract checks passed. `engine/developer.py::Progress` now publishes versioned JSON snapshots inside its existing edited bot comment. Actual transitions carry stable executed-step IDs, stable pending IDs, per-attempt identity, monotonic revisions, start/end timestamps, explicit failure and testing status, and measured implementation-stage units. Human-readable checklist compatibility is preserved. Raw model design reasoning is no longer copied into the live progress feed. Failed dispatch is blocked, not reported as completed.

Verification: 44 existing developer tests and 3 new runner wire-contract tests passed; 20 focused frontend tests and scripts/check-web.py passed. Snapshot tests verify real Progress calls, failure time freezing, JSON escaping, stable IDs and revision order. Terminal client timing now freezes on test/terminal lifecycle events.

Feature 1 remote commit: `6ee18ff789dd346a1e0e42ab86f764a18782c764`. Feature 2 commit is the commit containing this checkpoint.

Next: review all full-suite results after exact baseline restoration, exercise the real UI in an available browser, add structured-card assertions and connection isolation coverage, and document native/production integration limits. Browser preflight: runtime Playwright exists but its default Chromium and WebKit binaries are absent. Locate an installed browser before attempting screenshots.

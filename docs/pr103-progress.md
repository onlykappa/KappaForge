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

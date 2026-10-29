# Phase 3 execution queue — 2026-10-29

Owner request: prepare consecutive KappaForge coding tasks to reduce idle time, retain checks per task, and perform a broad review at the end. Nothing may merge, deploy, release or be marked ready.

This is a persisted **supervised queue**, not an implemented automatic dependency scheduler or a queue of chat messages. KappaForge has per-task Actions concurrency and recovery; neither advances to another task on successful completion. Later tasks deliberately lack `Mode` and `kappa-task` until activated. Do not describe them as running or guaranteed to start unattended.

| Order | Work | State | Dependency |
| --- | --- | --- | --- |
| 1 | [#313 native keyboard investigation](https://github.com/onlykappa/KappaForge/issues/313) | Dispatched: [40793251944](https://github.com/onlykappa/KappaForge/actions/runs/40793251944). No fix claimed yet. | Current failing native assertion P3-092 |
| 2 | [#314 scoped PR review ingestion and durable identities](https://github.com/onlykappa/KappaForge/issues/314) | Prepared, not executable | Honest Phase 3.1 closeout; investigate/correct #313 |
| 3 | [#315 incremental synchronization and recovery](https://github.com/onlykappa/KappaForge/issues/315) | Prepared, not executable | Validated #314 delivery on a compatible unmerged owner base |
| 4 | Phase 3.3 bounded review-driven repair | Roadmap backlog; no task dispatched | Validated review ingestion |
| 5 | Phase 3.4 visual verification and Phase 3.5 native evidence reporting | Roadmap backlog | Repair/evidence interfaces |
| 6 | Phase 3.6 mobile review experience and Phase 3.7 lifecycle enforcement | Roadmap backlog | Ingestion/evidence contracts; owner-only boundaries |
| 7 | Phase 3.8 acceptance and Phase 3.9 broad integration/security review | Roadmap backlog | Completed feature slices |

## Engine and publication

#312 remains the only bug/engine accumulator, on `fix/308-phase3-followups`. A rename experiment automatically closed that PR; the original branch was restored and #312 reopened immediately. It remains an open draft. No code or receipt was rewritten.

The unchanged runtime binds trial engines to a task-specific owner branch and draft PR. For #313, [#316](https://github.com/onlykappa/KappaForge/pull/316) is a frozen snapshot at `6c8b1389b23be8790b81f4a55f10cc6ae2b7364d`, identical to #312's source at dispatch. Do not develop or merge that snapshot. The explicit owner Fix runs from `fix/313-phase3-engine`. A durable intake claim on #313 prevents the label event from dispatching a second worker on main.

[Draft #317](https://github.com/onlykappa/KappaForge/pull/317), branch `kappa/dev-313`, was seeded with an honest investigation plan and an incomplete-review record, not a source fix or passing result. It targets #312's branch so validated corrections can be collected there without merging to main. A fresh task cannot start from an unapproved candidate engine.

## Advancing the queue

1. Inspect the live result, actual candidate source and independent checks; a green Actions job alone is insufficient.
2. Log and fix blockers; retain failures, authority boundaries and consumed budgets. Do not queue duplicate workers or increase limits.
3. Collect reviewed corrections into #312 without merging; record exact source/evidence. Close Phase 3.1 only when its remaining acceptance work is honestly reconciled.
4. Activate #314 with an explicit current owner base and engine selection. Keep its scope bounded to ingestion. Activate #315 only after its dependency is validated and available in that base.
5. Keep task checks focused and defer the complete cross-phase review to 3.8/3.9. Never substitute that later review for authorization and publication gates.

No production app update, live cancellation, native physical-device validation, or unattended cross-task scheduler is claimed.

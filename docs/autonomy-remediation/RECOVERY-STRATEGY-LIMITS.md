# Bounded applied recovery strategies — partial KF-AUDIT-010

The existing repair controller now enforces at most five applied repair mechanisms for the current named failing-test family. It reuses persisted source-backed repair plans and includes the first permitted unplanned repair. A successful tool patch consumes a slot; a rejected patch, read-only observation or provider capacity wait does not. Model requests remain charged independently. Existing 20-candidate/100-action and lifetime task budgets still apply across different failure families.

The controller checks allowance before another model request, plan acceptance and mutation. Exhaustion retains the candidate, failure evidence and exact usage receipt with a truthful failed/strategy_limit result. Explicit owner Fix can recheck that candidate, but cannot refill its strategy allowance. Corrupt saved counters stop with strategy_state_invalid and unknown usage, rather than an invented count. Existing legacy attempts without attributable family metadata remain explicitly marked legacy_unattributed; this migration does not manufacture historical precision.

Five regressions execute the actual controller and, for restart, the real Journal/Session. A controlled recurring failure executes five distinct source-cited plan/patch pairs and stops before a sixth model request. Invalid patches do not consume a slot; the first applied unplanned patch does. Per-family limits remain bounded by global quotas. A real checkpoint interrupted by scripted provider429 retains the charged request, consumes no repair mechanism, then resumes and completes with exactly one applied repair. An explicit Fix on an exhausted checkpoint can validate again but cannot request another repair. No live model, paid inference, production workflow, deployment or owner permission change was used.

## Executed results

64 focused tests passed. Full Python1529 total:1495 passed,34 skipped,zero failures/errors in123.382s. Standard Node279 passed,zero failures/skips. Five new tests passed again after strengthening the corrupt-counter diagnostic assertion. Structural scan, dependency map, execution-policy and diff checks passed. Exact candidate CI/real sandbox remain pending. Simulator results are tracked separately and never inferred from Python/Node tests.

Initial fixture errors used a different repository tree against a real Journal scope and correctly raised CheckpointMismatch. Fixtures now use the existing authorized Session. The observed unmodified base has an empty diff fingerprint; tests require that exact initial marker and 64-character later revisions, retaining source-evidence assertions. These fixture corrections did not bypass controller scope checks.

## Remaining scope and rollback

This is partial010, not full recovery completion. Applied mechanism counting and normalized source-backed hypotheses do not prove semantic novelty or live model judgment. Invalid arguments, output corruption, authorization, unavailable resources and other failure classes still need their explicit integrated category policy. Generation and repair retain different controllers. Live Task322/330 and the50-task autonomy benchmark remain unrun. Legacy unattributed attempts have unknown strategy attribution. No new autonomy score is assigned.

Rollback the controller and repair_strategy changes together; preserve all stored plans, spend, receipts and cancellation state. Review this candidate after generation recovery#348; run the actual final integration tree before any separately owner-approved PR merge.

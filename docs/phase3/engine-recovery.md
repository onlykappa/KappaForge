# Engine revision and candidate revision

The controller's engine SHA and the candidate SHA are separate identities. A candidate may contain engine edits that have not been approved for host execution. Updating the candidate never implicitly updates the running engine.

## Before task work

The development workflow enables `KAPPA_ENGINE_CHECK`. `Journal.begin` checks the local checkout against `GITHUB_SHA`, then checks the current run's repository, workflow path, event, branch and SHA against GitHub metadata before candidate investigation, inference, edits or sandbox execution.

A main run checks the current main ref. If main advanced while the job was queued, the stale engine does no task work; recovery can dispatch current main. A task carrying an authorized trial receipt cannot fall back to a main revision that omits the trial fixes.

An owner-started trial must be the same repository's exact `kappa/dev-<task>` branch, and both its actor and triggering actor must be the owner. The run title must identify that task. Its current branch head must still match its workflow SHA. The receipt records the task authorization digest, engine SHA and original run ID. A comment or PR body cannot create this receipt.

## Continuation

Trial recovery revalidates the original owner-started run, reserves a task-bound `kappa/recovery-<task>-<digest>-<attempt>` ref at the immutable engine SHA, and dispatches only that ref. It verifies the reservation again before dispatch. The next worker checks the actual checkout and ref before consuming its continuation token or doing task work. Candidate branch movement does not change the engine SHA.

The authorization guard permits this dispatch only while the controller holds the verified task-specific dispatch context. Free-runner admission still checks the active public repository, exact reviewed workflow contents and manifest hash, approved runners, and unchanged ref. Other refs and workflow changes remain blocked. Existing owner authorization, cancellation, expiry, continuation counters and repair budgets remain in force.

After the owner merges a main revision containing the trial engine commit, recovery may upgrade to current main. GitHub comparison metadata must prove that main includes that engine SHA. It cannot downgrade to the earlier main revision.

## Pre-merge operation and limits

Trial checkpoints use machine status `engine_pinned`, with the logical status in `engineStatus`. New readers decode it. Legacy scanners do not recognize it as runnable, preventing the old main scanner from dispatching an obsolete engine.

While a trial worker is alive, a recoverable provider failure retains its checkpoint, respects retry time, rechecks cancellation in at-most-30-second waiting intervals, and queues the pinned engine before exiting. GitHub's existing per-task concurrency group serializes the handoff. The task execution deadline bounds waiting.

An owner can run the engine-aware recovery workflow on the exact task branch to recover a forcibly terminated trial. A hard kill before handoff, or a wait beyond the current execution deadline, leaves a protected checkpoint. The currently deployed legacy main scanner cannot resume that checkpoint. After the owner merges this change, the normal engine-aware main scanner can handle it automatically. This PR does not modify main, merge itself or deploy the Worker.

## Regression evidence

`tests/test_runtime_engine.py` exercises real Journal and intent-guard paths for immutable engine handoff, later candidate edits, stale main/checkouts, forged receipts, changed refs, unavailable provenance, cancellation, legacy-reader isolation and promotion to a containing main revision. `tests/test_infrastructure.py` verifies that a trial dispatch still requires its task receipt, exact engine SHA and reviewed free workflow.

The engine-selection regression failed against the previous Journal implementation because it dispatched `main`; it passes with this change. Counts and live outcomes are recorded under P3-013 in the issue ledger. Passing a recovery test does not establish completion of the Phase 3.1 audit.

# Integration plan

Isolated program worktree: /workspace/KappaForge-remediation, branch remediation/program from origin/main19c9592. Keep original audit worktree untouched. Create coherent subsystem candidate branches/PRs after local validation. Stack dependencies explicitly, test the actual composed integration head, and keep every PR draft until all applicable gates pass. Owner approval required for every merge; none authorized yet. No production dispatch, deployment or release as a test side effect.

Proposed clusters: (1) budgets/requirements; (2) typed evidence/terminal state; (3) workflow privilege and explicit deployment boundary; (4) tool observations/versioned edits; subsequent runtime/recovery/context/tools clusters only after dependency tests. Each PR records gap IDs, root cause, changed files, tests/results, limitations, security implications and rollback. Do not mark an entire phase complete when its production/device gates remain blocked.

Rollback: revert a candidate PR before merge, preserve all journal history/spend/cancellation evidence and pin prior trusted engine. A rollback must not replay side effects or reset budgets.

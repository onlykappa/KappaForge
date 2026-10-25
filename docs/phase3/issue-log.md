# Phase 3 issue and rerun ledger

This is the shared issue log for every defect, missing acceptance proof, test failure or workflow error discovered during Phase 3. Record evidence before changing code. For a fix, capture the reproducer, patch location, regression and immediate rerun before moving to unrelated work. Never mark a finding patched from an agent claim alone.

**Statuses:** `OPEN`, `PATCHED` (only after reproducer passes), `BLOCKED` (needs owner decision), `NOT REPRODUCED` (include the attempted reproducer), `ACCEPTED LIMITATION` (owner-approved only).

| ID | Found in / checkpoint | Evidence and impact | Reproducer / initial result | Permanent fix and regression | Immediate rerun (command, counts, result) | Commit / PR | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P3-001 | 3.1a task/PR setup | The initial setup converted task #273 into PR #273. The workflow correctly filters PR objects out of task selection, so run [#264](https://github.com/onlykappa/KappaForge/actions/runs/40221871561) completed preflight/classify but skipped analyze and code. This was a setup error, not a KappaForge code defect. | Dispatch with issue_number=273 and action=fix; classify succeeded, analyze/code were skipped. | Corrected task/PR separation: owner-authored task #274, PR #275 on expected branch kappa/dev-274. | Corrective dispatch for issue #274 has not yet run; do not mark patched until code job starts and produces audit progress. | Draft PR #275 | OPEN |

## Finding template

### P3-NNN — short defect title

- **Checkpoint and date:**
- **Evidence:** exact file/symbol/line, workflow run or artifact URL; distinguish observation from inference.
- **Impact and scope:**
- **Reproducer:** exact command or deterministic steps; initial outcome and counts.
- **Permanent patch:** files/commit and why this addresses the cause.
- **Regression:** test name and the behavior it asserts.
- **Immediate rerun:** command, discovered/passed/skipped counts, exit status and result, performed immediately after the patch.
- **Broader validation:** exact commands and evidence, separately from immediate rerun.
- **Status:** OPEN / PATCHED / BLOCKED / NOT REPRODUCED / ACCEPTED LIMITATION.
- **Owner decision needed:** yes/no; question if yes.

Do not put secrets, private review content or personal data in this log. Link sanitized artifacts with access controls appropriate to the repository.

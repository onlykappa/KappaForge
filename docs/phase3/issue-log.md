# Phase 3 issue and rerun ledger

This is the shared issue log for every defect, missing acceptance proof, test failure or workflow error discovered during Phase 3. Record evidence before changing code. For a fix, capture the reproducer, patch location, regression and immediate rerun before moving to unrelated work. Never mark a finding patched from an agent claim alone.

**Statuses:** `OPEN`, `PATCHED` (only after reproducer passes), `BLOCKED` (needs owner decision), `NOT REPRODUCED` (include the attempted reproducer), `ACCEPTED LIMITATION` (owner-approved only).

| ID | Found in / checkpoint | Evidence and impact | Reproducer / initial result | Permanent fix and regression | Immediate rerun (command, counts, result) | Commit / PR | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | No Phase 3.1 audit findings recorded yet | This scaffold is not an audit result. | Not run | Not applicable | Not run | Draft PR #273 | OPEN |

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

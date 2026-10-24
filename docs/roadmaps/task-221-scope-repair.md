# Task #221: preserve the goal during PR review and repair

## Goal

Fix the engine defects that turned a one-line workflow comment into unrelated README/test edits and repeated repairs in draft PR #222. Preserve owner-controlled merging and real code-review requirements.

## Evidence

- First source checkpoint `73c8b88` prepended exactly the requested comment to the workflow.
- `lifecycle_requirement` rejects “Open a draft PR for this change and do not merge it” because “change” matches the code-work blacklist. The actual draft receipt therefore cannot satisfy this requirement.
- Subsequent checkpoints add `.github/README.md` as a supposed PR placeholder and extra whitespace; the final candidate duplicates the requested comment.
- Initial sandbox run `40044201272` failed one test: its test-source inventory omitted the actual workflow read by the generated test. Adding that workflow to the inventory removes the false rejection.
- Final sandbox run `40044973223` passed, but its first-line assertion accepts duplicate comments and the requirement review correctly keeps the work incomplete.

## Plan

1. Recognize referential PR lifecycle wording without treating substantive code requirements as completed PR facts. Supply the verified draft receipt to generation and repairs.
2. Enforce explicit bounded edit goals before checkpointing and against the complete candidate delta, including exact single-comment requests. A model review cannot authorize unrelated files or duplicate the requested edit.
3. Fix test-source inventory discovery and add deterministic #221 replay coverage, including negative scope and receipt cases.
4. Run the relevant Python, Node, structural and CI checks; leave the fix as a draft for owner review.

PR #222 remains evidence and is not merged or rewritten by this engine fix.

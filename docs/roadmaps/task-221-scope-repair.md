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
2. Keep the original owner goal in planning, generation and review by default. Infer deterministic acceptance for simple comment insertions without requiring “change nothing else.” Validate before checkpointing and against the complete candidate delta. A model review cannot authorize unrelated files or duplicate the requested edit.
3. Fix test-source inventory discovery and add deterministic #221 replay coverage, including negative scope and receipt cases.
4. Run the relevant Python, Node, structural and CI checks; leave the fix as a draft for owner review.

PR #222 remains evidence and is not merged or rewritten by this engine fix.

## Implemented behavior

- The owner request is separated from signed control metadata and earlier conversation context, then carried through every generation/repair prompt. Explicit owner guidance can amend it; model reviews cannot.
- The known task PR receipt is supplied to code generation and repair even when an earlier model has misclassified the PR requirement.
- Referential lifecycle wording (“for this change”, “with these changes”) resolves from the actual PR. Mixed asks for real code changes remain code requirements.
- Simple comment-insertion goals get an anchored source comparison and file boundary automatically. An unrelated README/test, a duplicate comment, or even extra whitespace is rejected before checkpointing. Ordinary broader tasks retain semantic review; this does not claim deterministic understanding of every natural-language request.
- A repair of an older already-polluted bounded PR stops before generation rather than silently preserving unrelated files. This fix does not rewrite #222's history.
- The Python test-source inventory now uses actual repository files rather than a short hardcoded list that omitted the workflow being tested.
- The #221 replay uses an owner prompt without “change nothing else,” opens its draft before coding, writes exactly the requested workflow delta, accepts the trusted receipt, and completes after one edit and one review.

## Validation

- Failing-before reproduction: the original classifier rejected #221's lifecycle sentence; the new test catches it.
- Full local Python suite: 539 tests run successfully before the final comment-in-Python regression was added; 5 Docker/structural-tool tests skipped on Windows.
- Final focused scope/lifecycle/developer suite: 83 tests passed, including the additional code-file comment case.
- Full Node suite: 822 passed.
- Dependency map regenerated within the existing 6000-character budget.
- CI runs the pinned Linux structural tools, Docker canaries, browser tests and Worker checks before owner review.

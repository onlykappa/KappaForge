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

## Shared task-state extension (owner requested)

Carry a bounded task record into every planning, coding, review and recovery model call. It must contain the owner goal, task/repository/branch/candidate identity, verified PR facts, candidate-bound check outcomes, recent rejected attempts, remaining requirements, and the next action with a reason and success condition. Saved/model-reported progress is not independent proof. Rebuild from the existing recovery journal after interruption, refresh receipts, invalidate stale checks when the candidate moves, and preserve all existing authorization and budget limits. Validate stale/different-task facts, context-size boundaries, secret redaction, and the full #221 replay.

### Delivered shared record

- `engine/task_state.py` builds one controller-owned view for all roles. The common `runner.run_model` boundary attaches it to direct-provider and integrated-gateway calls. Planner, coder, stage reviewer, final reviewer and repair actions declare their purpose and success condition.
- The view contains the sanitized owner goal/digest, repository/task/branch/candidate, observed PR receipt, selected GitHub run status, current/planned stages, touched paths from controller checkpoints, last four rejected attempts, pending review claims and remaining budgets. Touched paths can include earlier checkpoints; they are not claimed as the current full PR diff. Omitted path counts remain explicit after compaction.
- Model reviews and saved progress are explicitly unverified. Selected workflow runs do not assert that their actual checkout was independently verified. A passing check never implies that the owner goal is finished.
- Candidate movement clears check/review observations and stops an in-flight edit before checkpointing, with no model retry against the stale view. Existing remote fast-forward and authorization checks remain in force.
- The existing recovery journal persists bounded history and stage hints. Restarts can reuse that history but must observe PR/CI facts again. Wrong-task, changed-goal and malformed saved records cannot supply facts.
- Role and stage contexts are isolated across parallel workers. Reusing a wrapped prompt refreshes changed observations; a marker embedded in source cannot replace the controller record.
- The record is valid JSON within 6000 UTF-16 code units, with explicit omission counts. Context-budget checks measure the full augmented prompt; secrets in error/history text are redacted.

Validation adds 14 shared-state tests, including the real runner boundary for both routing modes, #221's planner/coder/reviewer sequence, stale edits and checks, saved-state refresh, restored touched paths, task identity, corrupt/forged context, stage progress, concurrency, budgets and context growth. The complete suite now contains 554 Python tests; Linux CI supplies the Docker and structural-tool checks skipped on this Windows host.

### Review hardening requested by the owner

- A literal comment already present at the start of the controller-read source is preserved. New tasks report the observed commit and stop before model calls, branch/PR creation or test dispatch. The report explains that the source needs no change and a new source PR cannot be produced; it does not claim that a requested PR was opened. Duplicate insertions fail validation, including with Windows line endings.
- Both dispatched iOS jobs prefer `candidate_sha` over a moving branch, then compare the actual checkout's `git rev-parse HEAD` with that SHA. Manual runs without a candidate retain their branch behavior. A regression executes the production checkout guard against matching and moved Git commits.
- Broad-task proposals must justify each changed file before acceptance. Claims are bound to source hashes and are untrusted review input. Independent requirement review must judge every file's necessity against the original request and cite current source. Repair review includes files already on the PR, so an unrelated earlier checkpoint cannot disappear from scrutiny.
- Missing scope decisions or unsupported quotes cause a bounded review retry and then leave the draft incomplete. They never authorize source edits to manufacture missing review evidence. Negative scope decisions keep unrelated work flagged as unfinished; passing CI cannot override them. These semantic judgments remain model assessments, not a deterministic proof of relevance.

Seven additional regressions bring the suite to 561 Python tests. Local verification passed with five existing Docker/structural-tool skips, and all 822 Node tests passed. Linux CI and the iOS workflow provide the remaining checks before owner review.

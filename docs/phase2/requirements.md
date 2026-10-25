# Phase 2 section 4: structured requirement classification

A development task now splits the owner's request into distinct requirements, labels each one, and finishes with a
table that shows, per requirement, where it was implemented and which test exercises it. Behavior that the review
finds implemented but untested keeps the task open. The labels never grant any permission.

The code is in `engine/requirements.py`, the schema in `config/requirement-classification.schema.json`.

## Splitting, with traceability

`requirements.split(request)` makes one requirement per list item, otherwise one per sentence. Each gets:
- an id (`R1`, `R2`, …);
- the owner's exact wording;
- its position, so that `request[start:end]` is the wording.

How splitting handles edge cases:
- A sentence ends at `.`, `!` or `?` followed by whitespace, so file names and versions (`a.yml`, `v1.2.3`) stay whole.
- A piece that starts in lower case continues the sentence before it.
- Fillers such as "Thanks!" or "ok" are dropped.
- At most 30 requirements are kept.

## Classification, once per task

The categories are `code`, `bug_fix`, `testing`, `documentation`, `housekeeping` (PR, branch or repository bookkeeping),
`security`, `research` and `owner_decision`. Several may apply.

**One model answer, at no extra cost.** The planner's existing call carries the classification: its prompt lists the
requirements with their ids, and it answers `requirements: [{id, categories, reason}]`. Classification spends no
extra model request.

**Strict checking of the answer.** The answer must cover every id exactly once, with categories from the schema;
otherwise the whole answer is discarded and the deterministic rules classify alone. Only the id, the categories and
the reason are read. Any other field the model adds is ignored, such as an "authorized" flag or rewritten text.

**Deterministic validation** (`requirements.validate`), applied to the model's answer and the rules alike:

| Check | Rule |
| --- | --- |
| Safety signals | An ask for an owner-only action is always `owner_decision`. A security signal always adds `security`. |
| Hidden work | Code, tests or docs that the request names cannot be relabeled as only housekeeping, research or an owner decision. |
| Owner instructions | An owner action that conflicts with a merge hold in the request, or with the `noMerge` restriction, is noted. The `noTests`, `noCode` and `noPR` restrictions are noted on the requirements they affect. |
| Authorization | A read-only task (`analysis`, `audit` and so on) notes work it will report but not change. An owner-only action is always noted as needing the owner's own action. |

**What counts as an owner-only action.** Merge, deploy, release, publish, ship, grant, revoke, make public, delete a
repository or branch, force-push, or change permissions. A negated ask such as "don't merge" or "never release" is a
restriction, not a request.

The classification is saved in the recovery journal, bound to the task, repository, authorization scope and request.
A resumed task reloads it and runs the same deterministic rules over the saved labels; it makes no new model call. The
saved record holds only ids, labels and reasons, and the wording is rebuilt from the request, so redaction can never
alter it.

## Classification grants nothing

- A `Requirement` record has no field that could carry a permission. `owner_action` only marks a request that KappaForge will not carry out.
- `engine/requirements.py` never sets the active execution scope, calls `permit` or `transition`, or changes restrictions.
- `engine/intent_guard.py` never imports or reads classification.
- Merging through the API is still refused by the guard, whatever the classification says. A test asserts each of these.

## Requirement-to-test matrix

The requirement review receives the classified requirements and is asked to report each one by id. For a behavior
change, it also cites `test: {path, quote}`. A cited test counts only when:
- the path is a test file;
- the quote is literally in that file's current candidate source.

`requirements.matrix` gives each requirement a status:

| Status | Meaning |
| --- | --- |
| `tested` | Implemented, with an accepted test citation; after sandbox validation the draft shows "ran: full suite passed" |
| `untested` | Behavior (code, bug fix or testing) implemented with no accepted test. **An open problem**: the repair round is asked to add or cite a test, and the task is not complete until one exists |
| `not implemented` | The review found it unmet; it is already an open problem through the review |
| `not reviewed` | The review did not report it by id or exact wording. Shown, not sent to repair: a review gap cannot be fixed by editing source |
| `done` | Non-behavioral work, such as documentation, that the review found implemented |
| `checked on GitHub` / `KappaForge action` | PR bookkeeping, decided by GitHub's own record of the draft PR |
| `owner decision` | Only the owner can do it; KappaForge never does |

The draft PR shows the matrix under **Requirements and tests**. The task plan's acceptance criteria are the classified
requirements, as `R1 (code): …`.

## Tests

`tests/test_requirements.py` covers:
- **Splitting:** exact wording and positions, intact file names, and bounds.
- **Phrasings:** every category across several wordings, and negated owner actions treated as restrictions.
- **Model answers:** a valid answer is used; out-of-schema answers fall back to the rules; the model cannot drop safety signals, hide work or rewrite wording.
- **Authorization:** classification cannot bypass the guard and never touches the execution scope; owner restrictions and read-only modes are noted.
- **The matrix:** every status, test citations that are refused, and the rendered table.
- **The published schema:** it matches the code.
- **Persistence:** the classification is saved, reloaded and revalidated, and tampered labels are corrected.
- **End to end:** a development run in which the planner classifies with no extra model call, the review links a test, and the draft shows the matrix.

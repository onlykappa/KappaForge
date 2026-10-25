# Phase 2 section 3: evidence-driven plans

A development task now keeps one plan for its whole run and changes it as it learns. The plan (`engine/task_plan.py`)
starts from the planner's choices and is revised when an investigation answers a question, a stage finishes, the
requirement review finds an unmet requirement, or a sandbox test fails or passes. Every revision records what
changed, what triggered it and why. The plan is saved in the task's recovery journal, so a resumed task continues
from it instead of planning (and reading the repository) again. It is a record of evidence and intent; it never
authorizes anything.

## What the plan holds

| Field | Contents |
| --- | --- |
| `objective`, `expected_behavior` | The issue title and the owner's request (up to 600 characters) |
| `acceptance_criteria` | The request's list items, or its sentences when it has no list |
| `files` | `path`, `why` and, for files found by investigation, the line ranges actually read (`evidence`) |
| `dependencies` | Repository files the chosen sources import that are not themselves sources |
| `open_questions` | The planner's `investigate` questions, until an investigation answers them |
| `hypotheses` | `text`, `status` (`open`, `confirmed` or `rejected`) and optional `evidence` |
| `completed`, `remaining` | Work done and work left; stages start in `remaining` |
| `verification` | The sandbox regression, a new failing-then-passing test when one is required, and the requirement review |
| `revisions` | `at`, `trigger`, `reason` and `changes` (`added`, `removed`, `changed` per field) |

Lists hold at most 40 entries and keep the newest; text is whitespace-normalized and bounded. The revision history
keeps the first revision (how the plan started) and the latest 49.

## Revisions

`TaskPlan.revise(reason, trigger, **changes)` refuses a change without a reason, with an unknown trigger or with a
field the plan does not have. A change that alters nothing is not recorded. `add`, `done` and `resolve` are
incremental forms of the same call. The triggers are `planning`, `inspection`, `progress`, `test`, `documentation`,
`owner` and `repair`; `documentation` and `owner` are reserved for sections 5 and 6.

Where the development pipeline revises the plan (`engine/developer.py`):

| Event | Trigger | Change |
| --- | --- | --- |
| Sources read, planner's choices known | `planning` | Initial plan (`start_plan`) |
| Investigation finished | `inspection` | Open questions cleared; files it read added with their line ranges |
| Writer produced the change | `progress` | Remaining stages moved to completed |
| Requirement review found unmet requirements | `inspection` | One `Resolve:` item per problem added to remaining |
| Sandbox validation stopped | `test` | A hypothesis that the candidate fails the tests, and "Pass the sandbox test suite" |
| Full sandbox regression passed | `test` | Recorded as completed |

Each revision is announced in the task feed ("Plan revised: ...") and saved. The draft PR shows the plan below the
design notes, without repeating the goal, and lists the latest five reasons under "Why the plan changed".

## Persistence and resume

`task_plan.save` stores the plan in the recovery journal as a checkpoint blob beside the generation plan, bound to the
task number, repository, authorization scope digest, base commit and a digest of the request. `task_plan.load`
returns it only when all of these match and raises `CheckpointMismatch` otherwise, so a plan from another task, base
or request is never reused. A plan whose revision history or hypotheses fail validation is refused as untrusted.

On resume, `start_plan` loads the saved plan and says "Resumed the saved plan (N revisions); no re-planning"; the
generation plan checkpoint already skips the planner, investigation and repository reads. The running plan lives in a
context variable reset at the end of each task run (`task_plan.scoped`), so nothing leaks into the next task.

## Tests

`tests/test_task_plan.py`: revisions require a reason and a known trigger; the recorded diff; completed and remaining
work; hypothesis resolution; the bounded history and lists (the newest entry is kept); rendering; acceptance criteria
from lists and sentences; tampered saved plans refused; a journal round trip with identity checks; a resumed task
continuing from its saved plan without calling the planner; no leak between runs.

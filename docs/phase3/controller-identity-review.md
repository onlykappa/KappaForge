# Task-identity constraints use controller receipts

Run [40456364028](https://github.com/onlykappa/KappaForge/actions/runs/40456364028)
got past reviewed-checkpoint recovery but stopped at the 12-proposal effort bound.
Logs record 11 gateway calls: ten verification and one requirement review, with
no coding calls or published changes. One local unsent proposal also consumed
effort. Lower call volume did not establish completion.

Several stale findings were disproved, but review tried to prove "Do not resume
task #274 or reuse its branch/checkpoint" using document lines. A source quote
cannot prove which task/checkpoint the controller is running. Historical mentions
of another task in the document also do not mean that task is being resumed.

For this exact instruction form, the verifier now checks the active record,
derived task branch, journal scope and checkpoint identity. The task/repository/
candidate must match, the excluded task must differ from the active task, and the
instruction must occur as an exact sentence in the owner goal. A mismatched or
missing authority stays unmet. Model-supplied controller exemptions are discarded.
Only identity findings resolved by these receipts are removed from the review's
problem list. Such orchestration gaps are not sent to a source-repair model;
unresolved requirements remain visible. All source requirements retain their
literal evidence checks and the whole-task review still runs.

The same controlled replay on main `37e8a92cd518be570f6351acf08c94ff99827e9b`
and this patch uses actual review/finding/inference code with scripted responses:

| Identity-check workload | Baseline | Patch |
| --- | ---: | ---: |
| Gateway adapter invocations | 4 | 1 |
| Finding-verification invocations | 3 | 0 |
| Whole-task reviews | 1 | 1 |
| Identity requirement verified | No | Yes |

These are simulated calls, not live HTTP traffic or proof of full 3.1a completion.
Tests include mismatched task, candidate, repository and scope, invented owner
instructions, and a model trying to exempt a source requirement from evidence.
Task #282 / PR #284 remains scoped to 3.1a and draft until actual work is verified.
The effort ceiling and cumulative counters are not raised or reset.

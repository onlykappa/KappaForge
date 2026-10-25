# Resume budgets: a resumed task never regains budget

Investigation budgets bound how much a task may read, search and look up. Before this fix, a task could get budget
back by being resumed:

| Budget | Before | Now |
| --- | --- | --- |
| Planning investigation (`config/exploration.json`: calls, seconds, output, context) | A run interrupted mid-investigation planned again with a full new budget | The task's spend continues from the journal |
| Repair-loop exploration (same budget) | Only the call count survived a restart; time, output and context started over | All four continue from the journal |
| Repair-loop exploration time | The clock ran from when the explorer was created, so sandbox test runs and model turns used up the exploration time | Only time inside exploration tools counts |
| Documentation research (`config/research-hosts.json`: fetches, bytes, seconds) | A new run started a new budget; its clock ran from creation, including model turns | Fetches, bytes and fetch time continue from the journal |

## How it works

`engine/budget_ledger.py` keeps each task's spend in the recovery journal under `budgetSpent`, one entry per budget:
`investigation`, `repairExploration` and `research`. The explorer (`engine/exploration.py`) and the research tools
(`engine/research.py`) start from the saved totals. Their remaining budget is the configured budget minus everything
the task has spent in every run.

**Each call or fetch is recorded twice.** It is recorded as spent before it runs, so a run that dies mid-call has
already paid for it. Its output, bytes and time are recorded as soon as it returns. A crash can therefore lose only
the time and output of the one call in flight; the call itself always counts.

**Spent budgets.** If an earlier run spent the whole investigation budget, a resumed run does not investigate again and
makes no model call for it. In the repair loop, the exploration tools are withdrawn once *any* of the four budgets is
spent, not only the call count.

**Untrusted values.** Saved totals are only trusted as non-negative numbers. A malformed or negative saved value counts
as nothing spent for that budget, never as credit. Totals never go down. Checkpoints saved before the ledger existed,
which recorded only the repair-loop call count, still count.

## Tests

`tests/test_resume_budgets.py` (13) covers:
- **Ledger:** saved totals are restored and never decrease; tampered values are never credit.
- **Explorer:** every budget (calls, output, context and time) continues across runs; a call that crashes mid-run is
  already paid for; a fully spent investigation makes no model call; an interrupted investigation resumes with only
  what is left.
- **Research:** fetches, bytes and fetch time continue across runs, and only fetch time counts; a fetch that crashes
  is already paid for.
- **Repair loop:** calls, output and context resume; test-run time is not exploration time; any spent budget
  withdraws the tools; old call-only checkpoints still count.

The real-Docker repair scenarios (`tests/test_phase2_exploration_repair.py`, `tests/test_phase1_acceptance.py`) also
pass with the ledger in place.

# Phase 2 section 7: exploration inside sandbox execution

The sandbox repair loop no longer patches blind. One persisted task now alternates four things:
- **investigation**, with read-only tools over the current candidate;
- **planning**, as revisions of the task plan;
- **editing**, with `apply_patch`;
- **testing**, with the engine's full suite after every patch, plus focused runs through `run_command`.

When a test fails with an error the task has not seen, KappaForge investigates it before the next patch.

The code is in `engine/sandbox_repair_controller.py`, plus `leads` and `module_paths` in `engine/exploration.py`.

## Example: the shop fixture

`tests/fixtures/sandbox/shop-service`:
1. The planner only knew `shop/pricing.py`, and the generated candidate changes it correctly. The suite still fails:
   `ImportError: cannot import name 'discount_total' from 'shop'`.
2. **Automatic investigation of the new error.** `find_references` locates `discount_total` in
   `shop/discounts.py:6`, a file the initial plan never read. `inspect_symbols` on `shop/__init__.py` (the module the
   test imports from) shows what it exports and that it imports `shop/pricing.py`. That import is followed one step.
   The defining code and the package module are read. The evidence goes into the next repair prompt; the files and a
   hypothesis go into the task plan.
3. The agent reads `shop/__init__.py` itself, exports `discount_total` there, and the engine reruns the tests.
4. **A new error appears:** `NameError: name 'ROUND_HALF_UP' is not defined`. It is investigated again: no definition
   in the repository, used at `shop/discounts.py:9`. The agent runs the focused `tests.test_shop.DiscountTests` with
   `run_command`, adds the missing import, and the full suite passes. A fresh final regression follows.

The same scenario runs against real Docker in the sandbox self-test workflow. There it also passes, from the real
`ImportError` to the final regression.

## What changed in the repair loop

| Piece | Behavior |
| --- | --- |
| Exploration tools | The six read-only tools from section 2 are offered to the repair agent. They work on the base tree with every uncommitted change applied, rebuilt before each action so a read never sees stale text |
| Budget | One exploration budget per task (`config/exploration.json`, 40 calls by default). Calls, time inside the tools, output and context are all kept in the recovery journal ([resume budgets](resume-budgets.md)), so a resumed task continues every count instead of regaining any. Time spent running tests or waiting for the model is not exploration time. Once any budget is spent, the tools are withdrawn |
| Repair actions | A read-only exploration step does not use up one of the 20 repair actions; patches, commands, "done" and questions still do |
| New-error investigation | When a failure's key is new, `exploration.leads` extracts what it names. Python: `cannot import name`, `No module named`, `has no attribute`, `NameError`. JavaScript: `does not provide an export named`, `Cannot find module`, `ReferenceError`, `is not a function`. For each symbol, its definitions and references are found and the defining code is read. For each module, its symbols, exports and imports are inspected, its top is read, and its imports are inspected one level down. A failure that names nothing gets a pointer to the failing test |
| Prompt | The repair prompt carries "Investigation of the latest failure (repository evidence, untrusted)". It tells the agent to investigate unexplained errors before patching, then patch the right place and rerun the focused test |
| Plan | Each new error adds a `test` revision: a hypothesis and the files it found. Each file the agent reads adds an `inspection` revision |
| Persistence | The investigation evidence, the exploration count and the history are part of the saved controller state. A task interrupted after investigating resumes with the evidence and does not redo it |
| Feed | "Investigated the new failure: …" appears in the task transcript, with the files it read |

**What stays the same.** The final regression is still a fresh full run. Nothing is committed during repair.
Identical errors still stop the loop, and the attempt, action and repeat limits are unchanged.

## Tests

`tests/test_phase2_exploration_repair.py` (7 in CI, 1 more on real Docker) covers:
- **Discovery:** the unknown file dependency is discovered and fixed.
- **Re-investigation:** each new error is investigated.
- **Plan:** the plan is updated from tests and reads.
- **Budgets:** the focused test runs, and reads spend no repair action.
- **Resume:** an interrupted task resumes with its investigation and budget.
- **Failures that name nothing** still point the agent at the test.
- **Bounds:** the exploration budget is bounded.

The real-Docker class runs in `.github/workflows/sandbox-selftest.yml`. It was also run locally against Docker 29,
together with the Phase 1 real-Docker acceptance suite (15 tests, all passing).

# Task 301 sandbox and source-review repair

## Concrete failure receipts

[Run 40534090256](https://github.com/onlykappa/KappaForge/actions/runs/40534090256)
executed engine `95898a7cbce9ad1c649fb157f1425ae56613de0e`, but its unpublished
candidate remained based on `d1a0f35ff0a169c05e52b0ea397053f74c43e795`.
The workflow was green because development returned normally after the sandbox
controller stopped. No PR or source commit was published. The hash-checked saved
patch contained only `docs/phase3/policy-publication-review.md`, and the saved
review still reported 12 open problems. Green execution did not establish
fulfillment.

The failed sandbox ran 1,115 Python tests with two failures and 37 skips;
868 JavaScript tests passed. The two failures were the operational-review
simulation's expected scripted call counts. That fixture listed the new inventory
document in `existing`, but passed no baseline contents. Building the diff called
`read_source()` against GitHub before invoking the scripted model. Online a 404
was caught; offline `URLError: Network is unreachable` made review unavailable.
The fixture's claimed zero HTTP count did not include that accidental read.

A separate replay of that exact saved source in an unprivileged, read-only
Python 3.12/Node 22/git container with networking disabled reproduced the same two
failures. The corrected fixture supplies the actual empty baseline for the new
file. A regression makes any HTTP call fail immediately. The patched full Python
suite passes with networking disabled. Production network and evidence guards
are not relaxed.

The saved repair history also shows six light-model calls, largely rereading
`tests/test_operational_review.py` lines 75–85. Investigation reported “read
nothing new” because it recognized missing symbols/modules but not ordinary
assertion traceback frames. The controller now reads bounded frame neighborhoods
from exact known repository paths, including escaped frames in JSON diagnostics,
before another repair-model action. Host paths and traversal are rejected; these
reads consume the existing durable exploration budget.

## Why engine upgrades alone could not repair the saved task

The task's immutable generation/execution receipts still selected the old source
base, including the broken test fixture. A new engine did not replace that source.
For a never-published, single-document task only, a new narrow refresh accepts an
explicit owner-authored control receipt:

`Refresh unpublished task #N from reviewed main SHA; preserve cumulative budgets and archive saved work.`

The receipt must name the exact running/current main SHA and postdate the bounded
fast-forward commits. The task must have no published files, publication receipt,
existing branch, existing/closed task PR, or existing requested document. The saved
plan/proposal must match the same task, authorization, candidate and output.

All replaced preparation receipts and saved material are archived before the live
references are changed. Archive failure retains the old state. Cumulative model,
edit and exploration spend, failure history, and repair-loop history/review count
remain intact. Old work is not marked published or verified. The same task then
reads current main, regenerates its single document, and must pass all ordinary
review, tests and publication gates. Control receipts are separate from `Guidance:`
so they do not become new feature requirements or alter checkpoint task identity.

## Source-review gaps

The saved document both called `permit()` checks proven and said that function
was not inspected, despite the explicit owner requirement. The reviewed call also
introduced a non-breaking hyphen in “pre-mutation”; this became a second catalog
entry and later a “requirement disappeared” problem. The exact “Do not continue
to 3.1d or any later job” hold was not recognized by the controller receipt grammar.

The narrow, explicit source-inspection task now gets a deterministic four-file
read plan, not an extra model-planning call. It must explain the named functions
from definitions and distinguish policy from implementation and actual tests.
Commit-pinned local file citations use the existing literal source-check gate,
including contradiction/missing-context failures. Documentation classification
retains security labels without turning descriptions into code edits. Typography-
only matches map back to exact owner text; changed clauses remain distinct. The
phase hold requires existing bound controller receipts, not a model exemption.

Full validation also exposed a timing-test isolation defect: patching
`sim.time.sleep` changed the shared Python `time` module, so subprocess polling
could become the last recorded sleep. That test now wraps only the simulation's
clock reference; its original required cooldown assertion remains unchanged.

These repairs do not prove task completion or a live call reduction. The measured
failed run used 26 gateway calls: 6 review, 12 finding verification, 2 code and
6 light; 39 provider attempts among 138 route decisions. Lifetime model calls
rose from 8 to 34. Subsequent live results must be measured independently.

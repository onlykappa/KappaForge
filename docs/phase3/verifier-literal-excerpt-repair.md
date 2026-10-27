# Literal predicate evidence in repair verification

Task #301's [run 40550305377](https://github.com/onlykappa/KappaForge/actions/runs/40550305377)
stopped at its existing 12-proposal effort bound. It made 12 gateway calls:
5 finding verifications, 5 whole-task reviews and 2 coding calls. The durable
lifetime model-call counter increased from 42 to 54. It published no new candidate;
draft #304 remained at `f1b77839b1206fc3249e5a7457892bb7b9a06d15`.

A saved verifier decision rejected the finding about the document's false claim
that `permit()` does not inspect `force`. Current `engine/intent_guard.py` does
check `not (payload or {}).get("force")` when permitting ref updates. Replaying
the actual finding batch against that source reproduced the missing predicate
in the verifier's bounded excerpt. Generic keyword ranking selected other source
and omitted the line needed to decide the finding. A literal quote from an
incorrect document cannot establish the truth of its description of code.

Repair payloads now reserve a few exact quoted-fragment matches as read leads
before generic keyword selection. Only fragments actually matching source count;
identifier prefixes, invented fragments and very common matches do not become
anchors. The search uses at most 32 fragments from bounded displayed claims and
keeps at most four lines. Explicit requested lines and traceback leads remain.
The existing 3,000-character code excerpt and 14,000-character aggregate source
budgets, provider limits, literal-evidence checks, cumulative counters and
12-proposal bound are unchanged. A read lead is neither proof nor permission.

The regression uses the actual finding batch and repository guard source. Before
the repair it omitted the force predicate; after it includes both that predicate
and GET/HEAD behavior, with real source line numbers and `complete: false`, within
the same budget. Negative cases cover absent fragments, identifier-prefix
collisions, Unicode source and bounded anchor counts. These tests make zero
provider HTTP calls. They demonstrate evidence availability, not a guaranteed
future model verdict or a measured live-call reduction. The source-inspection
output remains draft pending actual factual correction and independent review.

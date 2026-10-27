# Bounded verification for small document repairs

The prior task #282 run logged 52 gateway calls (44 verification, five review,
three code), with repeated stale findings and a final provenance rejection.
That production result is a diagnostic baseline, not a controlled benchmark.

## Changes

- Preserve independently rejected finding feedback when assembling the retained
  requirement catalog. Keep raw finding hashes out of that feedback.
- Reuse only decisive, ungated findings within the same runtime record and exact
  owner goal, candidate, source snapshot, PR diff, branch observation, check/PR facts and allowed
  routes. Uncertainty is never cached; a changed input requires fresh verification.
  The bounded cache is memory-only and never becomes a recovery receipt.
- Classify inspected merge-commit nouns as research instead of an action to merge.
  Recognize phase-stop constraints and the compound draft/report/stop instruction
  without treating an accompanying request to fix code as lifecycle work.
- Supply bounded observed PR diff context to finding verification and explain
  that unchanged baseline sections are not new scope violations. This improves
  the model's evidence; it does not make semantic judgments deterministic.
- Remove internal finding/source hashes from coding repair-assessment context.
  Retain candidate and GitHub facts and preserve complete internal diagnostics.
  Prompt compaction also deep-copies check facts, preventing shortened display
  labels from mutating the controller's stored receipt.
- Bound a repair touching at most two document files to 12 model proposals in one
  runtime record. This is a conservative effort ceiling, not a 12-request provider
  quota: a proposal may fail locally, while one gateway call may try several
  provider routes. Exhaustion stops with the saved draft; it never implies success.
  Lifetime budget counters, provider quotas and paid Worker settings are unchanged.

## Controlled simulation

The same replay in tests/test_verification_efficiency.py ran against main
`920e8bdeaa415a40c10f08e546b2590039af059a` and the patch. It traverses the real
model-review, finding verification, task-state and inference boundary code with
scripted gateway responses, without live HTTP/provider traffic.

| Result | Baseline | Patch |
| --- | ---: | ---: |
| Simulated gateway calls | 7 | 4 |
| Finding verification calls | 5 | 2 |
| Requirement review calls | 2 | 2 |
| Review completed | No | Yes |
| Generated edits | 0 | 0 |

The workload rejects an invented finding, re-reviews with that feedback, and has
three consumers verify the same immutable source. Gateway calls fall 43% and
finding verification calls 60%; required whole-task reviews still run twice.
These are controlled replay counts, not a claim that production fell from52 to4.

Run from either checkout, pointing PYTHONPATH at the engine version under test:

```sh
PYTHONPATH=/path/to/checkout python /path/to/patched/tests/test_verification_efficiency.py
```

Regressions also check cache invalidation, uncertainty exclusion, coding context
separation, lifecycle/code separation, and stopping at the effort limit before
another gateway invocation. The existing envelope test changes its source between
calls so it continues testing actual post-answer inference, preserving its source,
receipt, owner-scope and 4074-character assertions alongside the new cache tests.

The final provenance gate remains mandatory. PR #284 stays draft and task #282
stays at checkpoint 3.1a. Live provider reliability and final task fulfillment
still require measurement on a new exact candidate. engine/validate_change.py is
absent from this checkout; available regression suites and independent CI apply.

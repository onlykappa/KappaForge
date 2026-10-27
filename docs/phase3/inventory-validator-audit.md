# Inventory validator audit — task #298

Inspected engine/main: `42272f41b30b7d59b5b891ad083f6fccb321c46f`.
Inspected draft #299: `995d974af63e5cbe7bcfe9b172d7daf9a364f3a3`.
Output #284 remains draft at `4516ae8e393747aeb6b782ab2d7f417979dd94a4`.
No audit output or existing task checkpoint was modified by this repair.

## Observed result

[Run 40502982224](https://github.com/onlykappa/KappaForge/actions/runs/40502982224)
completed but published an explicitly incomplete draft. Its final review retained
nine problems. It used 14 gateway requests: diagnose 1, light 8, code 1, review 1,
verify 3; their router records contain 23 attempted provider routes. Largest
prompt: 18,912 characters. These are live log counts, not a simulation.

The inventory names app-dashboard.js as the web startup file, while index.html
loads the scripts and app-main.js contains startup. It calls settings.js the
primary configuration, omitting config/app.json and the Worker configuration.
It leaves workflow filenames unknown instead of enumerating available files.
Passing regression tests do not validate these descriptions.

## Gap status

| Gap | Current disposition |
| --- | --- |
| Historical generated fake commit references | Publication existence gate merged in #291; semantic accuracy of a description remains separate. |
| Lost rejection feedback / stale historical findings | Repairs #293 and #297 merged; their regressions remain applicable. |
| Stale unpublished execution proposal | Repair #294 merged; no new evidence of that failure in task #298. |
| One exact negative task identity instruction | Receipt-based repair #295 merged; it is deliberately not general proof of every operational restriction. |
| Truncated finding-verifier replies | Headroom repair #296 merged; no ceiling or effort-budget increase in this PR. |
| Negated comma lists request owner merge/deploy actions | Addressed here: narrow list negation, clause boundaries and saved-label revalidation. |
| Pure scope holds become behavioral work | Addressed here for a closed grammar of execution/audit scope restrictions; product safety invariants remain substantive requirements. |
| A document can substantiate itself without its linked source | Addressed here for architecture/repository/source inventories with same-repository, full-SHA blob citations. Missing, duplicate, invented or unshown source checks block completion; explicit contradictions become problems. |
| Fresh branch, untouched foreign task/PR, and unchanged limits require source quotes | OPEN. These need separate, candidate-bound controller receipts, not blanket lifecycle exemptions or model assurances. This PR does not assert those requirements met. |
| Actual #299 inventory errors and omissions | OPEN. No output edits or retry performed. The new validator has not yet been exercised on a live regenerated candidate. |
| Planning overhead / repeated small reads | OPEN. Eight light calls occurred; this PR adds no mandatory model call but does not claim a measured production reduction. |

## What changes

Inventory review now receives up to eight local cited source files plus available
startup/configuration evidence within that same bound. The partial path index
prioritizes real workflow/configuration filenames. Existing source/context size
adaptation and source-inspection round bounds remain in force. Unknown and foreign
paths never cause arbitrary HTTP reads or candidate execution.

The reviewer must return source_checks per linked file, bound to its document,
with a literal supplied source quote, boolean supports verdict and reason. A
missing check is a review-process gap, not authority to edit source. A false
supports decision becomes an outstanding contradiction even if the model marks
the requirement met. The gate checks evidence integrity; it cannot independently
understand every responsibility claimed by prose. Existence, truthful source
interpretation and historical provenance remain distinct obligations. Source
checks use CURRENT candidate contents, not a claim to have read historical blob
contents. More than eight cited files remains incomplete rather than silently
skipping the excess. Non-inventory tasks do not carry the inventory protocol.

The negative-list classifier only relabels requests; it grants no permissions.
Positive actions after a new clause still require owner authority. The closed
scope-hold grammar does not absorb product constraints such as preventing data
loss or credential disclosure, or a positive second request to fix code.

## Controlled validation

The self-citation regression fails on isolated protected main 42272f4: a scripted
review claiming completion with only a document quote was accepted. The patched
review blocks that same response. A corrected inventory with a literal source
check passes; a contradictory check blocks it even when requirements claim met.
Both versions use one scripted review invocation, zero finding-verification calls
and zero live HTTP requests. This is stronger validation at equal fixture call
count, not evidence of production call savings or completed checkpoint 3.1b.

Additional cases cover invented/unshown/foreign/duplicate evidence, malformed
boolean verdicts, unavailable source, eight-file limits, and negation/positive
clause boundaries. Existing whole-task, scope, provenance and independent sandbox
checks remain mandatory. No cumulative counters, 12-proposal bounds, provider
quotas or Worker settings are changed. engine/validate_change.py is absent in the
baseline; no execution of that nonexistent validator is claimed.

Local final validation: 1,100 Python tests, OK (32 skipped); 868 JavaScript tests
passed. Web synchronization/syntax, execution-policy manifest, ast-grep structural
checks and whitespace validation passed. These are repair regressions, not
completion of task #298 or a live test of regenerated inventory quality.

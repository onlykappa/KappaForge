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
| Fresh branch, untouched foreign task/PR, and unchanged limits require source quotes | Addressed here with narrow typed controller receipts: observed fresh-main origin, current task isolation and bounded requests/documentation-only changes. Missing history, mismatched authority or changed code stays unverified; there is no blanket exemption. |
| Actual #299 inventory errors and omissions | Corrected in architecture-inventory.md in this PR: HTML/startup distinction, central configuration and all 22 workflow filenames. #299 itself is untouched; no live regeneration is claimed. |
| Planning overhead / repeated small reads | Addressed for this narrow new-document inventory: deterministic pinned-tree read plan, archive reuse, no redundant controller-source injection or discovery questions. Other task shapes use the ordinary planner. Production improvement still requires live measurement. |

## What changes

Inventory review now receives bounded literal source snippets for up to 32 cited
files, within the existing forty-file context bound. The initial eight-citation
global ceiling was too restrictive and is replaced; the eight-file follow-up
inspection request bound, context caps and effort budget remain unchanged.
Startup/configuration evidence and real workflow/configuration filenames are
prioritized in the partial index. Existing source/context size
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
contents. More than 32 distinct cited files remains incomplete without reading beyond the
bound. Missing paths are never fetched; no source can be silently skipped. Non-inventory tasks do not carry the inventory protocol.

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
boolean verdicts, unavailable source, source-context limits, and negation/positive
clause boundaries. Existing whole-task, scope, provenance and independent sandbox
checks remain mandatory. No cumulative counters, 12-proposal bounds, provider
quotas or Worker settings are changed. engine/validate_change.py is absent in the
baseline; no execution of that nonexistent validator is claimed.

Initial PR #300 validation: 1,100 Python tests, OK (32 skipped); 868 JavaScript tests
passed. Web synchronization/syntax, execution-policy manifest, ast-grep structural
checks and whitespace validation passed. These are repair regressions, not
completion of task #298 or a live test of regenerated inventory quality.


## Operational receipts and efficiency follow-up

Fresh-origin receipts are emitted only after the controller read main and observed
an unused task branch. They are bound to repository, task and authorization;
publication carries them only through the verified parent, and adoption of a
newer head requires a GitHub ancestry check. Saved checkpoints without this new
receipt remain unverified; history is never synthesized from a model assertion.
The current receipt does not assume that a repository's default branch is main.

Foreign-task restrictions are checked against the actual active execution guard.
Workflow dispatch is narrowed to the existing branch-scoped validation/review
workflows; deployment or extra release inputs are refused. Source-scope/limit
receipts additionally require a complete documentation-only change set within the
owner-named paths. Current fitted-request diagnostics are recorded only after the
existing prompt-size gate succeeds, piggybacking on normal journal writes. They
are not provider HTTP totals and do not replace durable proposal counters. Product
behavior requirements still need source/test evidence. Unsupported constraints,
missing receipts and mismatched authority stay unmet without source-repair votes.

The constrained inventory read plan applies only to one new owner-named document
when the expected KappaForge source tree is present. Positive feature/code asks,
existing output or incomplete trees fall back to normal planning. It reads real
startup/configuration/entry sources and selected workflow definitions; all 22
workflow filenames come from the pinned tree. It reuses the downloaded archive,
does not inject the large unrelated engine/developer.py file, and does not replace
source generation, scope review, provenance checks or independent tests.

Controlled replay against original PR #300 head cec0e87: operational review used
3 gateway invocations (1 finding-verification, 2 review), incomplete; patched uses
1 (0 finding-verification, 1 review), complete for the fixture. Both start with 14
consumed proposals; their counters end at 17 and 15 respectively, never reset.
A separate planning replay uses 1→0 planner calls and 1→30 locally selected source
paths, with the discovery question eliminated. Twelve cited workflow files can be
reviewed in one bounded call rather than failing the former eight-file ceiling.
All these providers are scripted, with zero live HTTP. They are not measurements
of full task #298 or a promise of production call savings.

No output task was retried and no phase advanced. The remaining acceptance step is
an exact-engine live task after this repair is reviewed/merged; model semantic
accuracy, transport/provider failures and old checkpoints lacking receipts still
need honest handling. This PR fixes the identified mechanisms, not every possible
future model error.

Final expanded repair validation: 1,114 Python tests, OK (32 skipped); 868 JavaScript
tests passed. Web, execution-policy, structural and whitespace checks passed. A
separate pinned-source check resolved all 11 blob/tree links, enumerated the 22
workflow filenames and rechecked paid Worker limit declarations. GitHub CI is
reported on the PR against its exact head; no live task was launched.

Source excerpts also carry renderer-owned path metadata. Literal source headers
inside an untrusted document cannot impersonate a supplied source block; a
regression covers that forged-header case.

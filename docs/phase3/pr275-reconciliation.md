# Historical PR #275 reconciliation

Source: [fecc0aa92170cbdbb2703caa9598bb28346e283d](https://github.com/onlykappa/KappaForge/commit/fecc0aa92170cbdbb2703caa9598bb28346e283d), compared with main 3263e4306ff4f0618e0e4e42fddb0259928d617b and PR #279 e2f940375bdd6d9dd764ed0cfb501849a527b921.

This archive preserves the unique P3-039–P3-044 notes below; their original run/test claims are historical reports, not rerun evidence or current completion claims. The old authorization for task #274 is not renewed by this reconciliation. New small audit tasks supersede that orchestration path; never reset its counters or bypass its authorization.

## Disposition of unique work

- The review-overhead regressions and lossless requirement references are retained in PR #279. Bounded routing hints are integrated with current inventory/source-inspection instructions; the current-main safety wording is preserved.
- Intake clock isolation and the explicit expiry refusal regression are retained in PR #279.
- Current main is authoritative for runtime attestation, source/owner receipts, verifier evidence and output budgets. The historical branch must not replace these newer guards. The old alternative runtime changes and deleted test are not adopted.
- The historical audit/provenance row is superseded by the more complete pinned record on PR #284. Keep its separate 3.1a review rather than copying the older row.
- The Phase 3 roadmap and task-intake/probe work are retained in PR #279; tracking now reflects the small audit PRs. No later phase is marked complete.
- The source branch and closed PR preserve the complete original diff, including the shorter historical review prompt. No commit or branch history is deleted.

## Preserved historical ledger excerpt

## P3-039 — final requirement review spends its envelope on repository routing hints

- Evidence: [40349678051](https://github.com/onlykappa/KappaForge/actions/runs/40349678051), engine `67ed37e`, completed two verifier requests, two coding requests and 19 scope-review requests, all logged HTTP 200. Coding rejected one invented edit anchor rather than applying it. Final requirement review then stopped locally with `GatewayResourceExhausted`; no corrected audit patch was published. Used counts reached 265 calls, three edit attempts and 28 fix cycles. No new Cloudflare 1102 is established by this run.
- Independently measured construction: the first 400 repository paths occupy 13,055 characters. A zero-source review with the saved retained requirements was 22,431 characters before controller state, already exceeding the retained 13,040 review envelope. The repository actually has over 500 tracked paths. Listing metadata is not scope proof.
- Correction: show at most 600 characters of complete path routing hints, prioritizing exact task-named paths, with an explicit omitted-path count. Keep the complete candidate inventory, source membership checks and the separate all-file scope batches. An omitted routing hint cannot prove missing behavior or excuse an unreviewed changed file. Compact repeated review instructions while retaining individual requirement coverage, runtime wiring, failure-path/real-test checks, exact documentation verification, owner scope, lifecycle separation, untrusted-input handling and literal source proof.
- Regression: the owner-shaped 500-path review fails against the prior review prompt (27,308 characters versus the 11,000 fixture boundary), then passes after correction. The new inventory test preserves a specifically named late file and explicit omission/complete-scope semantics. Existing literal-proof tests remain unchanged.

## P3-040 — retained requirement wording is redundantly serialized beside the complete owner request

- The saved catalogue contains 23 requirements totaling 3,824 serialized characters; many repeat wording already in the current owner request, including slight formatting variants. Source/diff compaction cannot reduce these repeated fixed fields.
- Correction: serialize exact Unicode spans into the complete unchanged task where available. For bounded formatting variants, use exact shared spans plus literal gaps only when smaller; preserve unmatched wording in full. Concatenating every part reconstructs the original retained requirement exactly. No requirement, prior decision or full durable catalogue is discarded; unmatched/oversized strings retain their full text. Follow-up retention uses the same lossless references.
- Focused tests actually RUN: review overhead 4, large scope 3, long task briefs 7, owner goal 26, requirements 17, verification 41 and repair root causes 12 passed across focused runs. Reconstruction tests cover Unicode, wholly unmatched asks and shared-fragment variants. A task-local final-review replay with actual saved state, owner guidance, current candidate sources and full PR scope metadata now reaches a scripted requirements call at 12,691 characters within the unchanged 13,040 envelope. It mocks already-separated scope decisions and returns unmet requirements; it does not claim live audit acceptance.
- The final replay after retaining the existing reviewer identification phrase is 12,697 characters. No request envelope or saved counter is raised/reset.
- Status for P3-039/P3-040: PATCHED locally; complete regression pending. The corrected audit remains unpublished.

## P3-041 — saved task authorization expired before the next corrected continuation

- Current task checkpoint expiry is 2026-10-26 18:35:46 UTC (11:35:46 Pacific). The later [40391796816](https://github.com/onlykappa/KappaForge/actions/runs/40391796816) is green only because classify/report-expired succeeded; coding and analysis were skipped. It is not Phase 3 progress. Saved usage remains 265 calls, three edit attempts and 29 fix cycles.
- Earlier [40378194692](https://github.com/onlykappa/KappaForge/actions/runs/40378194692) stopped with HTTP 502, recorded as provider outage. These later attempts are inspected evidence; no hidden successful continuation is claimed.
- Status: BLOCKED — the backend's existing `renewTask` requires a fresh authenticated user action to retry an expired task (`chat-backend/src/agent-work.js`). Use the existing Fix it action for task #274 to renew its exact scope with the supported resumeFrom linkage, retaining counters/history. Do not edit expiry or authorization markers by hand or dispatch an expired checkpoint. The permanent review-size fixes can still be validated and pushed for review.

## P3-042 — intake eligibility fixture expires with wall-clock time

- The first full review-overhead regression run discovered 1,088 tests and failed five: one intake eligibility test plus four prompt-fixture failures described below. Intake's fixed creation timestamp passed its real 24-hour authorization deadline during this task, so the supposed fresh-task fixture correctly became ineligible.
- Correction: freeze only this test class's clock at one minute after its fixture creation timestamp and restore it afterward. Add an explicit after-expiry refusal assertion. All five intake tests pass; production task expiry rules remain unchanged. This fix does not renew task #274.

## P3-043 — compact reviewer wording breaks existing scripted prompt identification

- Four full-suite fixtures identified a requirement review by the established `You are reviewing a change` prefix. The shorter wording removed it, so their simulated models returned another response shape, producing incomplete-state and excluded-route failures.
- Correction: retain that existing identification phrase in the compact reviewer instructions. Cloud 12, lifecycle simulation 13 and simulated task 2 tests pass in focused reruns with their original assertions. No production validation/authorization check or test assertion was removed. Complete online/offline reruns follow.

## P3-044 — replacement authorization blocks development and lacks saved-scope linkage

- Fresh inspection after the expiry report finds issue #274 updated at 2026-10-26 20:00:48 UTC. Its replacement authorization is no longer expired, but contains `restrictions.noPR=true` and `resumeFrom=null` for Mode develop. Local validation through the unchanged `ExecutionScope` rejects it with `Owner restrictions prevent this development workflow` before any model call.
- The previous checkpoint still belongs to the original authorization/digest and retains all used counts. Renewal should use the backend's supported resume linkage; no new empty checkpoint or usage reset is acceptable. Missing linkage is an observed metadata gap, not a successfully exercised live resume.
- Status: BLOCKED — owner authorization repair is required to permit the existing PR #275 workflow while preserving its exact scope, no-new-PR/no-lifecycle limits, counters/history and prior identity linkage. Do not clear noPR, invent resumeFrom/approval or dispatch the replacement authorization from this automated run. The prior P3-041 instruction to use Fix it is superseded by this newer record: renewTask retains an existing restrictions object, so another unchanged retry is not a demonstrated fix.

- Final validation for P3-039/P3-040/P3-042/P3-043 actually RUN: Python online — 1,089 run, OK, 33 skipped, 61.716s; proxy-blocked — 1,089 run, OK, 33 skipped, 66.563s. npm — 858 passed. Dependency-map generation/check, execution-policy and whitespace passed. The earlier five failures remain recorded above and were corrected without removing assertions. Status: review-size corrections PATCHED and regression-tested; no corrected live retry because authorization is blocked. No native/Docker or completed-audit result is claimed for these local checks.

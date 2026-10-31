# Master remediation tracker

Baseline main: 19c95923d12156688487fd8d4e1f6dd1c16eefa6. Audit archive verified against all eleven reports and 61 unique canonical gaps. No improved autonomy score is assigned. No merge/deploy/release authorized.

Statuses: NOT STARTED / INVESTIGATING / IMPLEMENTING / TESTING / BLOCKED / VERIFIED / INTEGRATED. VERIFIED requires the original acceptance gate; local progress alone never closes live evidence requirements.

Counts: BLOCKED=6, INVESTIGATING=20, NOT STARTED=13, TESTING=8, VERIFIED=14

Machine-readable record: gaps.json. Regenerate with python docs/autonomy-remediation/update_tracker.py.

## Resume checkpoint

Read TEST-EVIDENCE.md and INTEGRATION-PLAN.md, fetch latest main/open PRs, inspect candidate branches, then continue the first unmet dependency. Preserve old failure evidence. Do not repeat validated tests unless code/environment changed.

## KF-AUDIT-001 — File-scope constraint blocks an otherwise passing candidate

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Source-quote schema is applied to a constraint whose proof is the changed-file inventory.

Required implementation: Type evidence as source, diff_scope, command, authority or publication; verify scope deterministically from exact base/candidate diff.

Dependencies: Foundation contracts

Branch: remediation/c-lifecycle-reconciliation; PR: [#335](https://github.com/onlykappa/KappaForge/pull/335).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Typed source/diff/test/authorization/publication/runtime evidence. Scope receipts require active authority, exact candidate and complete published/proposed paths including rename origins. Exact operation prohibitions use read-only authority probes; requested test commands supplement mandatory regression.

Required acceptance/tests: Replay #330: one allowed file passes scope proof; adding any second file fails; no model quote needed.

Actual results: Task330 one-file scope positive, extra/forbidden/stale/forged receipt negatives and exact command receipts passed in isolated regressions.

Regression coverage: tests/test_typed_scope_evidence.py; tests/test_operational_review.py; tests/test_owner_validation_commands.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Normal live Task330 intake/model/publication replay has not been rerun; verified contract behavior is independent controlled evidence.

## KF-AUDIT-002 — Passing suite can certify tests of copied logic

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Test citation and suite success do not establish execution of the production behavior.

Required implementation: Require production imports/calls plus independent negative controls or mutation tests for changed behavior.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Scope-aware JavaScript call analysis rejects tests of locally copied production helpers; an import in another callback cannot certify the copy.

Required acceptance/tests: Original #323 inline-copy test is rejected; a wrong production implementation makes the replacement test fail.

Actual results: Original PR323 base faf250e310ad9afe0e6e640c5b6bd4c6d59c0c87/head534633c2a1db73bc7616015fcd3848770af9effc replay now reports copied isAnswered behavior.; Real Node independent mutation: correct production passes; constant-true production fails.

Regression coverage: tests/test_copied_logic_evidence.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Binding analysis is a targeted semantic safeguard, not proof that arbitrary tests are sufficient.

## KF-AUDIT-003 — Workflow success differs from objective completion

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Workflow exit code reports controller execution rather than delivered objective state.

Required implementation: Emit separate controller, validation and objective conclusions with a terminal receipt consumed by UI and workflows.

Dependencies: KF-AUDIT-001

Branch: remediation/c-lifecycle-reconciliation; PR: [#335](https://github.com/onlykappa/KappaForge/pull/335).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Finalize against the exact open draft head and unresolved requirements. Separate objectiveReceipt from controller/check conclusions. Blocked backend state overrides green tests in UI and persists measured start/finished times; stopped tasks have no live elapsed timer.

Required acceptance/tests: Green workflow plus blocked review renders blocked, never completed, in API and UI.

Actual results: Blocked-after-green validation and stable timer regression passed; no READY/DONE or running data-since for blocked work.

Regression coverage: tests/test_objective_finalization.py; tests/task-panel.test.mjs; tests/test_closed_draft_reconciliation.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Current production remains unchanged; polling freshness and cancellation race gates belong to044/040.

## KF-AUDIT-004 — Requirement extraction silently drops work after 30 entries

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Fixed prefix cap has no overflow failure or decomposition receipt.

Required implementation: Detect overflow, preserve all original requirements and page/decompose with stable IDs.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Retain complete owner wording and original spans. More than30 extracted requirements produces an explicit actionable limit error, never a silently truncated list.

Required acceptance/tests: 40 explicit requirements produce 40 tracked IDs or a visible nonterminal overflow; none disappear.

Actual results: 40-input regression rejects explicitly; boundary30 preserves all rows and long final constraint is retained.

Regression coverage: tests/test_requirement_limits.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Verified candidate only; owner approval and exact integration-head validation remain mandatory.

## KF-AUDIT-005 — Sparse budget updates discard previously spent counters

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Dictionary rebuilt only from incoming keys.

Required implementation: Merge into prior totals monotonically, preserving omitted keys.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Merge sparse cumulative counters monotonically and atomically validate all input. Preserve independent kinds and persisted totals across restart; exclude boolean/nonfinite/negative/string values and non-string keys.

Required acceptance/tests: Persist calls=10 bytes=100 then calls=11; restart retains bytes=100 and calls=11.

Actual results: Direct real-Ledger restart retains calls11/bytes100 and other-kind spend. Invalid updates cannot mutate memory or persisted spend.

Regression coverage: tests/test_budget_ledger_integrity.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Verified candidate only; owner approval and exact integration-head validation remain mandatory.

## KF-AUDIT-006 — Budget record input is not sanitized like saved input

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P2.

Root cause: Only loaded values filter types and nonnegative values; record accepts arbitrary mapping values.

Required implementation: Validate finite numeric nonnegative counters and string keys at both ingress points.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Merge sparse cumulative counters monotonically and atomically validate all input. Preserve independent kinds and persisted totals across restart; exclude boolean/nonfinite/negative/string values and non-string keys.

Required acceptance/tests: Reject booleans, strings, NaN, infinity, negative values and non-string keys without corrupting prior spend.

Actual results: Direct real-Ledger restart retains calls11/bytes100 and other-kind spend. Invalid updates cannot mutate memory or persisted spend.

Regression coverage: tests/test_budget_ledger_integrity.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Verified candidate only; owner approval and exact integration-head validation remain mandatory.

## KF-AUDIT-007 — Patch mismatch and unchanged proposals recur across nominally distinct strategies

Classification: PARTIAL; status: **TESTING**; phase: D; priority: P1.

Root cause: Strategy labels do not demonstrate changed causal conditions.

Required implementation: Persist normalized failure family, source version, attempted hypothesis and evidence delta; prohibit repeat without new evidence.

Dependencies: Foundation contracts

Branch: remediation/d-rejected-edit-memory; PR: [#340](https://github.com/onlykappa/KappaForge/pull/340).

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: Persist deterministic rejected-anchor identity using exact target bytes, find and preceding same-file edits. Block redispatch before patching, including after journal restore; allow corrected arguments or changed actual source.

Required acceptance/tests: Replay #322 emits no same-anchor edit against the same source after its first failure; later action reads exact lines or changes edit method.

Actual results: 87 controller/tool/strategy/recovery tests passed;6 focused actual Session/Journal and real Node tests passed.; Full Python1505 OK(skip36) on d526ddd.

Regression coverage: tests/test_rejected_edit_memory.py; tests/test_execution_recovery.py:test_rejected_anchor_receipt_survives_journal_restore_and_skips_duplicate_dispatch

Final verification evidence: Not yet collected.

Remaining limitations: Runtime repair admission fixed; initial generation rejection protocol and live Task322 replay remain separate. Category-specific five-strategy recovery not complete.

## KF-AUDIT-008 — Latest malformed-tool recovery lacks live acceptance evidence

Classification: PARTIAL; status: **TESTING**; phase: D; priority: P1.

Root cause: Parser/cap improvement tested locally but the historical failed workflow was not repeated on current runtime.

Required implementation: Run isolated recorded-response replay and later an explicitly authorized live repair; retain stop reasons and candidate tests.

Dependencies: Foundation contracts

Branch: remediation/c-lifecycle-reconciliation; PR: [#335](https://github.com/onlykappa/KappaForge/pull/335).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Real controller recovers truncated/fenced/singleton tool responses using dynamic export/file observations, exact digest edits and independently executed Node assertions. Explicit Fix can renew invalid-output streak without replenishing lifetime budgets.

Required acceptance/tests: A truncated reply, fenced object and singleton list recover and finish a genuine failing-import repair without changing task scope.

Actual results: Controlled wrong-import repair fails real Node first, then passes candidate plus fresh regression; production/assertions unchanged.; Automatic continuation does not renew invalid_limit; explicit Fix retains actions, attempts and history.

Regression coverage: tests/test_offline_agent_recovery.py; tests/test_execution_recovery.py

Final verification evidence: Not yet collected.

Remaining limitations: Scripted free-provider transport; no current live NVIDIA/model canary or normal authorized intake replay. Do not treat this as general live recovery proof.

## KF-AUDIT-009 — Recovery must reconcile closed drafts and obsolete goals before inference

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: Saved authority/candidate state can outlive the actionable draft.

Required implementation: Reconcile issue, PR state, branch, candidate and already-shipped behavior before any generation; terminal superseded/cancelled outcome.

Dependencies: Foundation contracts

Branch: remediation/c-lifecycle-reconciliation; PR: [#335](https://github.com/onlykappa/KappaForge/pull/335).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Reconcile saved output PR before model/tool work. Closed task-bound drafts emit blocked_closed_draft/objective receipt and stop; finalizer retains that specific outcome.

Required acceptance/tests: Closed #323 produces zero model/tool writes and a precise superseded or owner-decision receipt.

Actual results: Closed-draft regression performs zero model/test/publication calls and refuses foreign repo/branch association.

Regression coverage: tests/test_closed_draft_reconciliation.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Verified candidate only; owner approval and exact integration-head validation remain mandatory.

## KF-AUDIT-010 — Multiple retry ceilings do not encode five meaningful strategies

Classification: PARTIAL; status: **INVESTIGATING**; phase: D; priority: P2.

Root cause: Proposal retries, sandbox attempts and continuations have different semantics and budgets.

Required implementation: Unify lifetime budget accounting; default at most five evidence-changing repair strategies, category-specific transient waits separate.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Exhaustion across restart preserves all budgets; 429 waits do not consume repair strategies; no repeated side effects.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-011 — Initial generation and sandbox repair remain separate execution protocols

Classification: PARTIAL; status: **INVESTIGATING**; phase: B; priority: P1.

Root cause: Initial code is proposed from assembled context; dynamic tools exist in investigation and repair rather than one uniform loop.

Required implementation: Introduce typed action/observation runtime shared by planning, editing, tests and review; retain current adapters during migration.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: A task discovers an unplanned dependency, reads it, edits, tests and replans through one durable event contract.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-012 — Tool history is clipped rather than semantically compacted

Classification: PARTIAL; status: **INVESTIGATING**; phase: B; priority: P2.

Root cause: Text tails can omit the original cause and prior ineffective strategies.

Required implementation: Keep immutable receipts externally; construct context from active goal, current evidence, failed hypotheses and retrievable result IDs.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: After >30k history the next action still respects first failure and can retrieve omitted output.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-013 — String find/replace is a fragile edit interface

Classification: VERIFIED; status: **VERIFIED**; phase: B; priority: P1.

Root cause: Model must reproduce exact text from excerpts; no generalized semantic patch transaction.

Required implementation: Provide versioned line/unified-diff patches with expected file digest and explicit conflict observations; retain exact-match safe fallback.

Dependencies: Foundation contracts

Branch: remediation/b-versioned-tools; PR: [#334](https://github.com/onlykappa/KappaForge/pull/334).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Add apply_line_patch to the existing controller/catalog, requiring exact full-file SHA256, bounded nonoverlapping original line ranges and atomic replacement. Conflicts return current digest and reread guidance; no fuzzy fallback.

Required acceptance/tests: Formatting and stale-source fault fixtures trigger reread/rebase, never repeated blind replacement or silent wrong-file writes.

Actual results: Stale digest, bad range/overlap/path, formatting and atomicity fixtures passed.; Real Node import repair uses dynamically observed hash and exact file.; Supported real sandbox CI run41137357086 passed.

Regression coverage: tests/test_versioned_line_patch.py; tests/test_offline_agent_recovery.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Legacy exact find/replace remains supported;007 repeated-strategy policy and011 protocol consolidation remain open.

## KF-AUDIT-014 — Static planning limits narrow large-project reach

Classification: PARTIAL; status: **INVESTIGATING**; phase: B; priority: P2.

Root cause: Bounded windows are necessary but coverage is not an exhaustive repository investigation.

Required implementation: Page file/symbol inventory and expose explicit coverage and subgoal expansion under lifetime budgets.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Target past path 700 and dependency past initial source list are found without raising all context caps.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-015 — General-purpose executor is not exposed through the development-only tool catalog

Classification: MISSING; status: **NOT STARTED**; phase: F; priority: P1.

Root cause: Tools center on sandbox coding, curated docs and app/GitHub operations.

Required implementation: Add permission-scoped capability registry with shared execution receipt and artifact contracts.

Dependencies: KF-AUDIT-011

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: One supported task combines research, a file artifact and authorized application operation with verified receipts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-016 — NVIDIA priority routes fail in latest live task

Classification: PARTIAL; status: **INVESTIGATING**; phase: A; priority: P1.

Root cause: Eligibility and static strong tier do not guarantee useful compatible output.

Required implementation: Add fixture-backed normalization/parameter contracts, route quality health by role and small opt-in canaries; demote unusable routes without hiding errors.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Replay 200-empty, reasoning-only and first-byte timeout; fallback completes, attribution and cooldown reasons remain correct.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: No authorized live provider credentials/canary used. Empty/reasoning-only/first-byte timeout replay and attribution/cooldown/fallback acceptance remain open.

## KF-AUDIT-017 — Conservative admission makes strong fallback routes unusable for ordinary prompts

Classification: PARTIAL; status: **INVESTIGATING**; phase: E; priority: P1.

Root cause: Input/output reservations and conservative token estimates exceed route limits.

Required implementation: Keep safe upper bounds but create route-specific compact prompts and output reserves; validate tokenizer estimates before policy changes.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: #330-shaped request admits an eligible compact Groq/Mistral route when within its real limits; oversized requests still fail safely.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-018 — Model routing is role-ranked policy, not measured task-quality optimization

Classification: PARTIAL; status: **INVESTIGATING**; phase: E; priority: P2.

Root cause: Strong/light metadata and route order lack independent task success calibration.

Required implementation: Track verified outcome by model/role/task class with uncertainty and quota-aware selection.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Held-out routing evaluation beats static ordering on completion or latency without paid spend or quality regression.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-019 — Full deployed provider activation and quota state unavailable

Classification: PARTIAL; status: **BLOCKED**; phase: A; priority: P1.

Root cause: Repo configuration cannot establish deployed permission, credentials or remaining quotas.

Required implementation: Publish authenticated sanitized effective-config and deployment/version receipt with no inference.

Dependencies: Foundation contracts

Branch: remediation/a-effective-diagnostics; PR: [#336](https://github.com/onlykappa/KappaForge/pull/336).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Add authenticated no-store effective configuration diagnostics: configured credential presence only, channel/private-code policy, durable Premium enabled/unknown, Worker/build identity, stable policy fingerprint and explicit unprobed quota/availability. Deployment proposal stamps exact SHA; no deployment executed.

Required acceptance/tests: Owner supplies read-only capabilities/health snapshot covering every provider and policy/version fingerprint.

Actual results: Controlled Worker auth/method/origin, no-external-fetch, secret exclusion, unknown-store and fingerprint tests passed.; Existing premium free-first/off/no-charge-under-OFF tests run; no actual paid request.

Regression coverage: tests/deployment-diagnostics.test.mjs; tests/premium*.test.mjs

Final verification evidence: Not yet collected.

Remaining limitations: Current production snapshot and upstream account cost/quota state unavailable. Endpoint is an unmerged proposal; owner-authorized integration/deployment plus read-only snapshot needed for full acceptance.

## KF-AUDIT-020 — Native tool calling is not the active coding protocol

Classification: PARTIAL; status: **INVESTIGATING**; phase: B; priority: P2.

Root cause: Application emulates tools with text JSON; native function schemas are not used here.

Required implementation: Retain portable JSON adapter; add tested native-tool adapter only for proven compatible models.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Both adapters pass identical validation/error/cancellation fixtures; unsupported route cannot receive native tool fields.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-021 — Paid-off default is implemented but current production setting is not audited

Classification: PARTIAL; status: **BLOCKED**; phase: A; priority: P1.

Root cause: Persisted owner settings and current account state are not accessible.

Required implementation: Expose sanitized premium enabled flag and reservations; assert default off and last-resort ordering in deployment smoke suite.

Dependencies: Foundation contracts

Branch: remediation/a-effective-diagnostics; PR: [#336](https://github.com/onlykappa/KappaForge/pull/336).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Add authenticated no-store effective configuration diagnostics: configured credential presence only, channel/private-code policy, durable Premium enabled/unknown, Worker/build identity, stable policy fingerprint and explicit unprobed quota/availability. Deployment proposal stamps exact SHA; no deployment executed.

Required acceptance/tests: Fresh store is OFF; free exhaustion alone cannot charge when OFF; explicit ON obeys task/day caps.

Actual results: Controlled Worker auth/method/origin, no-external-fetch, secret exclusion, unknown-store and fingerprint tests passed.; Existing premium free-first/off/no-charge-under-OFF tests run; no actual paid request.

Regression coverage: tests/deployment-diagnostics.test.mjs; tests/premium*.test.mjs

Final verification evidence: Not yet collected.

Remaining limitations: Current production snapshot and upstream account cost/quota state unavailable. Endpoint is an unmerged proposal; owner-authorized integration/deployment plus read-only snapshot needed for full acceptance.

## KF-AUDIT-022 — Mutable issue comments are the durable control-plane storage

Classification: PARTIAL; status: **INVESTIGATING**; phase: C; priority: P1.

Root cause: Checkpoint writes, progress and archive rotation span GitHub API operations without a single atomic transaction.

Required implementation: Add append-only sequence/hash-linked event journal plus CAS state pointer; keep issue comments as export/projection initially.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Kill between each multipart write and pointer update: recover exact validated candidate or explicit incomplete state, never stale success.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-023 — Recent execution context is deliberately bounded and can lose causal history

Classification: PARTIAL; status: **TESTING**; phase: C; priority: P2.

Root cause: Compact active state is not a permanent evidence ledger.

Required implementation: Separate bounded prompt view from complete retained event and artifact storage with retention policy.

Dependencies: Foundation contracts

Branch: remediation/c-repair-history-retrieval; PR: [#341](https://github.com/onlykappa/KappaForge/pull/341).

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: Bounded repair-history index and exact SHA256/paged JSON retrieval through existing tools/journal; replace full recent-plan prompt dump with small index and mark history non-authoritative.

Required acceptance/tests: Old failed hypothesis remains retrievable after rotation and restart without entering every prompt.

Actual results: 28 targeted retrieval/strategy/tool/restart tests passed with >30k historical fixture and independently reconstructed full hash.; Full Python1509 OK(skip36) on bc04800.; bc04800 supported unit/browser/Worker/structure and strict real sandbox CI passed; broader generation/archive acceptance remains open.

Regression coverage: tests/test_repair_history_retrieval.py; tests/test_execution_recovery.py:test_old_hypothesis_can_be_retrieved_after_large_history_and_runner_restart

Final verification evidence: Not yet collected.

Remaining limitations: Repair-plan retrieval implemented and supported CI passed; generation-stage events/raw observations across actual archive rotation and general semantic compaction still need acceptance evidence.

## KF-AUDIT-024 — Current engine-pin restart behavior not fault-tested end to end here

Classification: UNVERIFIED; status: **INVESTIGATING**; phase: C; priority: P1.

Root cause: Many receipts/renewals guard runtime identity; local unit evidence is insufficient for real interruption coverage.

Required implementation: Create process-kill replay around engine renewal, sandbox save, publication and continuation dispatch.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: 20 injected interruption points resume on authorized engine/candidate with no budget reset or duplicate PR.

Actual results: Existing real supported CI passed interruption/provider-outage recovery fixtures; the original20-point fault-injection matrix is not complete.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-025 — Project memory is a bounded index snapshot rather than durable project understanding

Classification: PARTIAL; status: **NOT STARTED**; phase: E; priority: P2.

Root cause: Paths/top files and commit IDs do not preserve validated decisions and failure causality as retrievable knowledge.

Required implementation: Separate project facts, decisions and source citations from task journal; invalidate on relevant changes.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Yesterday task resumes with cited decisions and failed approaches; changed source invalidates stale facts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-026 — Cross-device sync, deletion and conflict handling lack live device evidence

Classification: UNVERIFIED; status: **NOT STARTED**; phase: E; priority: P1.

Root cause: Browser crypto/storage code and tests do not establish device retention or long-term deletion guarantees.

Required implementation: Specify retention and tombstone expiry; test concurrent offline edits, device restore and deletion propagation.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Two devices offline/online do not resurrect deleted chat; export and erase prove server/local removal within declared retention.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-027 — No general semantic task-context compaction service

Classification: PARTIAL; status: **NOT STARTED**; phase: E; priority: P2.

Root cause: Context assembly is distributed across code paths with size limits.

Required implementation: Use evidence-aware summarization retaining goal, constraints, unresolved subgoals, receipts and retrieval IDs.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Long task exceeds context size then resumes with every constraint intact and no repeated failed strategy.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-028 — General web search and research are absent beyond curated documentation

Classification: MISSING; status: **NOT STARTED**; phase: F; priority: P1.

Root cause: Allowed search APIs are MDN, npm and ReadTheDocs, not broad current-information research.

Required implementation: Add optional free-first search adapter with dated citations, source access receipts and explicit unavailable outcomes.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Five held-out research tasks cite fetched sources and distinguish inaccessible or conflicting evidence.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-029 — No agent-controlled browser session tools

Classification: MISSING; status: **NOT STARTED**; phase: F; priority: P1.

Root cause: HTTP docs fetch and UI Playwright tests are not an autonomous browser capability.

Required implementation: Optional isolated Playwright/browser worker with per-domain grants, screenshot/DOM observations and approval-bound submit actions.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Navigate dynamic fixture, log in with delegated test credentials, extract data, stop before unauthorized external submit.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-030 — Document and spreadsheet workflows lack purpose-built adapters

Classification: MISSING; status: **NOT STARTED**; phase: F; priority: P1.

Root cause: Attachments and generated source are not tested PDF/DOCX/XLSX operations.

Required implementation: Add sandbox file/artifact adapters, table parsing and deterministic output verification.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Round-trip fixtures preserve formulas, sheets, document structure and produce downloadable artifacts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-031 — General MCP/external connector runtime not found

Classification: MISSING; status: **NOT STARTED**; phase: F; priority: P2.

Root cause: Integrations are bespoke; no discovered MCP lifecycle or permission registry.

Required implementation: Implement optional connector adapter with scoped grants, schemas, secret isolation and receipts; avoid mandatory service cost.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: One local fake MCP server supports discovery/call/cancel with denied tools never invoked.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-032 — Desktop/local-device execution is not an implemented agent surface

Classification: MISSING; status: **NOT STARTED**; phase: G; priority: P2.

Root cause: Native app bridge is not a general desktop automation or local shell agent.

Required implementation: Optional signed local companion with explicit workspace/network grants; keep cloud-only use supported.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Local test workspace read/edit works; access outside approved root is refused and logged.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-033 — Sandbox language/dependency profiles are narrower than arbitrary projects

Classification: PARTIAL; status: **INVESTIGATING**; phase: C; priority: P2.

Root cause: Constrained Python/Node-oriented runners deliberately reject unsupported commands and installs.

Required implementation: Declare supported runtimes; add versioned image/profile adapters on demand with isolated installers.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Unsupported ecosystem identified before generation; supported pinned fixtures restore and test offline.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-034 — Real Docker isolation was not executed in this audit environment

Classification: VERIFIED; status: **VERIFIED**; phase: C; priority: P1.

Root cause: No local Docker daemon/client evidence; existing production receipts prove tests ran but not hostile escape resistance.

Required implementation: Run sandbox-selftest in disposable approved runner and adversarial network/env/host filesystem tests.

Dependencies: Foundation contracts

Branch: remediation/b-versioned-tools; PR: [#334](https://github.com/onlykappa/KappaForge/pull/334).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Collected missing actual supported-runtime evidence without weakening infrastructure admission. Existing sandbox retained.

Required acceptance/tests: No secrets, Docker socket, host files or network visible to test commands; time/memory/process limits enforced.

Actual results: GitHub-hosted Docker run41137357086/job124342988292:25 sandbox tests,2 repair integrations,18 Phase1,8 Phase2,2 Phase3 passed.; Secrets/network/system-file denial and timeout/memory/output containment executed.; Local Docker admission correctly refused unsupported non-GitHub environment; it was not spoofed.

Regression coverage: tests/test_sandbox.py:RealDockerTests; tests/test_phase1_acceptance.py:RealSandboxAcceptance

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Evidence applies to supported GitHub-hosted Linux runner and pinned profiles, not arbitrary remote/local hosts or unknown languages.

## KF-AUDIT-035 — Generated workflow proposals can execute before owner merge review

Classification: PARTIAL; status: **TESTING**; phase: A; priority: P0.

Root cause: Draft status and no-auto-merge do not stop branch/workflow_dispatch execution with repository secrets.

Required implementation: Separate trusted orchestrator from candidate workflows; forbid secret-bearing execution from candidate refs until explicit workflow approval; use least-privilege installation tokens.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Block model-controlled .github/workflows and .github/actions publication before GitHub mutation. Never select workflow-capable PAT for generated changes; preserve unpublished checkpoint. Require explicit owner dispatch for deploy/release, with release OFF by default and exact-main candidate.

Required acceptance/tests: Malicious draft workflow attempting secret exfiltration never receives secrets or privileged token before explicit gate.

Actual results: Malicious workflow/action proposal denied even with PAT/task prose; GitHub mutation mock remains untouched.; Actual deploy/release guards evaluated for owner/event/ref/candidate/opt-in; PR native release job skipped.

Regression coverage: tests/test_privileged_publication.py; tests/test_phase1_acceptance.py:PolicyAcceptance

Final verification evidence: Not yet collected.

Remaining limitations: Critical mitigation is code-tested, not a declaration of full security readiness. Actions permissions and main protection reads returned403; production-release environment was absent, cloudflare-production had no protection types. Owner verification of actual credentials, forks and independent approval settings remains required.

## KF-AUDIT-036 — Persisted preferences contain historical authority broader than current owner policy

Classification: PARTIAL; status: **TESTING**; phase: A; priority: P1.

Root cause: Versioned natural-language instructions can outlive task-specific authorization.

Required implementation: Treat repository prose as untrusted preferences only; exact expiring grants in control plane govern consequential actions.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Remove historical auto-merge preference; align KAPPA/README with task-scoped authority, owner merges and separately approved deployment. Existing authority service remains final guard.

Required acceptance/tests: Historical auto-merge text cannot authorize a new task; policy contradictions surface as diagnostics.

Actual results: Authority and policy regressions passed; repository preferences cannot expand execution scope.

Regression coverage: tests/test_intent_guard.py; tests/test_privileged_publication.py

Final verification evidence: Not yet collected.

Remaining limitations: General runtime diagnostics for conflicting stored historical preferences still need implementation/acceptance evidence.

## KF-AUDIT-037 — Shared bearer credential persists in browser localStorage

Classification: PARTIAL; status: **INVESTIGATING**; phase: A; priority: P1.

Root cause: Single-owner simplicity increases impact of browser script compromise/device extraction.

Required implementation: Use short-lived session credentials and secure native storage or HttpOnly session where feasible; device revocation and strong CSP.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Revoked device token fails; injected script cannot read long-lived privileged credential in browser test.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-038 — Prompt-injection defense not independently adversarially validated

Classification: UNVERIFIED; status: **NOT STARTED**; phase: H; priority: P1.

Root cause: Prompt warnings plus path guards do not demonstrate resistance across model output and privileged GitHub operations.

Required implementation: Add adversarial fixture corpus for repo docs, comments, web pages and test output with controller-side authority checks.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Zero unauthorized writes, paid calls, merge/deploy or secret disclosures in the security benchmark and fuzz cases.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-039 — Deployed secret scopes, branch protections and environment gates unavailable

Classification: UNVERIFIED; status: **BLOCKED**; phase: A; priority: P1.

Root cause: Workflow declarations do not establish actual PAT scope or production environment approval settings.

Required implementation: Collect read-only sanitized permission inventory and enforce environment approvals before deploy/release.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Read-only settings inventory recorded with no secret values; no permissions or protections modified.

Required acceptance/tests: Owner verifies least privileges and deployment gate rejects unapproved release; audit record contains no values.

Actual results: Actions workflow permissions and main branch protection returned403.; Environment metadata readable:cloudflare-production has no listed protections; production-release not present.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Owner must independently verify least-privilege tokens and required environment reviewers. No grant may be bypassed.

## KF-AUDIT-040 — Cancellation races across running tools and publication need proof

Classification: UNVERIFIED; status: **INVESTIGATING**; phase: C; priority: P2.

Root cause: Checks exist but end-to-end cancellation during each side effect was not executed.

Required implementation: Use cancellation epoch on every tool/publish claim and actively terminate child sandbox execution.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Cancel at model wait, patch, test, push and dispatch boundaries; no later consequential action starts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-041 — Retention and privacy boundaries differ across vault, issue journals and provider prompts

Classification: PARTIAL; status: **INVESTIGATING**; phase: E; priority: P2.

Root cause: Encrypted chat backup does not encrypt GitHub task evidence or provider-bound source.

Required implementation: Publish data-flow policy and per-tool redaction/retention controls; prohibit private context in public issues.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Privacy fixtures verify secret redaction and correct private-code provider restrictions; deletion procedure covers every store.

Actual results: Existing engine/execution.py require_storage already blocks private candidate checkpoints in a public task tracker. General retention/deletion/provider privacy acceptance remains open.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-042 — Task state can remain testing after runner has finished with incomplete review

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P1.

Root cause: No canonical terminal reconciliation updates every projection.

Required implementation: Finalize durable objective state even on review block, then publish UI projection with sequence and heartbeat.

Dependencies: KF-AUDIT-003

Branch: remediation/c-lifecycle-reconciliation; PR: [#335](https://github.com/onlykappa/KappaForge/pull/335).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Finalize against the exact open draft head and unresolved requirements. Separate objectiveReceipt from controller/check conclusions. Blocked backend state overrides green tests in UI and persists measured start/finished times; stopped tasks have no live elapsed timer.

Required acceptance/tests: #330 replay ends blocked_verification with accurate finished time and resume action; no indefinite active timer.

Actual results: Blocked-after-green validation and stable timer regression passed; no READY/DONE or running data-since for blocked work.

Regression coverage: tests/test_objective_finalization.py; tests/task-panel.test.mjs; tests/test_closed_draft_reconciliation.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Current production remains unchanged; polling freshness and cancellation race gates belong to044/040.

## KF-AUDIT-043 — Native composer keyboard failure remains open

Classification: PARTIAL; status: **TESTING**; phase: F; priority: P1.

Root cause: Existing layout test failed; no root cause confirmed in this audit.

Required implementation: Inspect native simulator artifact and bridge/layout geometry; repair without weakening keyboard assertions.

Dependencies: Foundation contracts

Branch: remediation/f-native-composer-host; PR: [#339](https://github.com/onlykappa/KappaForge/pull/339).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Move native UITextView out of WebKit-managed hierarchy into a sibling UIKit host, convert DOM coordinates to host and reapply retained frame on host layout.

Required acceptance/tests: Same device/orientation reproducer passes composer-above-keyboard assertion and four other existing UI tests.

Actual results: Native run41136935766/job124341580014:five UI tests passed; release skipped.; Latest125a099 native simulator:5 tests,4 passed,1 failed,0 skipped; independently downloaded count receipt and hierarchy retained.; 14 local Node keyboard/native/update contracts passed; actual Swift/native simulator candidate64a9ac3 is pending.; Exact64a9ac3 native run41203455958 passed5/5 unchanged UI tests,0 skipped; build succeeded, release skipped. Artifact fb2abed2ee3942de97c2457d2590d488fc4fb7213d1f4b28d1a5c1c04f9eeec7 verified.

Regression coverage: Unchanged native five-test UI suite; tests/ios-keyboard-layout.test.mjs; tests/test_native_build.py; tests/test_native_evidence.py

Final verification evidence: Not yet collected.

Remaining limitations: Supported simulator candidate passes; previous unmodified host also passed on0bba923, confirming intermittency. Do not infer elimination of all races or physical-device closure from one successful candidate. Device/orientation acceptance remains unmeasured.

## KF-AUDIT-044 — Task progress is polling-based with freshness limits

Classification: PARTIAL; status: **INVESTIGATING**; phase: C; priority: P2.

Root cause: Progress comments and frontend timing can diverge after delays/offline periods.

Required implementation: Backend event sequence, heartbeat and terminal reconciliation; optional SSE transport, polling fallback.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Out-of-order/duplicate events never regress state; offline reconnect reflects terminal backend state within 15 seconds.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-045 — UI implementation relies on classic-script shared globals and mirrored bundles

Classification: PARTIAL; status: **NOT STARTED**; phase: G; priority: P2.

Root cause: Load-order dependencies and generated copies increase integration risk.

Required implementation: Gradually introduce explicit modules/state contracts while preserving shared bundle checks.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Web/iOS generated assets match; initialization-order and restored-session tests pass after each module migration.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-046 — Apple-style refinement and real-device accessibility not assessed

Classification: UNVERIFIED; status: **BLOCKED**; phase: H; priority: P3.

Root cause: No interactive device session or visual/accessibility execution in this audit.

Required implementation: Run existing browser suite and targeted real-device keyboard, touch, VoiceOver and offline checks.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: No native composer layout fix claimed. Foundation macOS CI built simulator/unsigned iPhone app and passed five simulator UI tests, collected separately from physical-device acceptance.

Required acceptance/tests: Document screenshots and accessibility results for agreed device sizes with no critical interaction blockers.

Actual results: Native run41136935766/job124341580014:five UI tests passed; release skipped.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Historical device/orientation reproducer, physical-device screenshots and accessibility acceptance unavailable. Existing simulator success does not establish closure of the original report.

## KF-AUDIT-047 — No measured general-purpose 50-task autonomy benchmark

Classification: MISSING; status: **NOT STARTED**; phase: H; priority: P1.

Root cause: Unit counts and prior simulation passes are not independent broad workload outcomes.

Required implementation: Implement the 50-task protocol in report 08 with hidden acceptance and task-level receipts.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: All tasks have actual results or unsupported outcomes; aggregate metrics computed from raw records.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-048 — Local passing suites leave important integrations skipped

Classification: VERIFIED; status: **VERIFIED**; phase: H; priority: P2.

Root cause: Optional infrastructure checks are not exercised by the local suite.

Required implementation: Report skips by capability; require dedicated integration gates with available infrastructure.

Dependencies: Foundation contracts

Branch: remediation/h-required-integration-gates; PR: [#338](https://github.com/onlykappa/KappaForge/pull/338).

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: Strict required-integration inventory and observed pass receipts; CI rejects any missing/skipped required Docker/repair/Phase1-3 test and preserves failed receipts.

Required acceptance/tests: Critical integration gate cannot pass when all real runtime tests are skipped.

Actual results: Supported real Docker CI executed; local full suite still legitimately skips live/native/integration gates. Critical-all-skipped CI enforcement remains to strengthen.; Five negative/positive gate tests and31 policy/infrastructure tests passed. Actual local sandbox module:19 passed/6 required skipped; new gate correctly exits1 despite unittestOK. Full Python1500 OK(skip36) on0bba923.; Actual supported run41203292992 passed all five strict integration gates; independently downloaded candidate-bound JSON receipts match artifact SHA256. All55 tests passed,0 skipped; required groups include all six real Docker tests.

Regression coverage: tests/test_required_integration_gate.py

Final verification evidence: evidence/required-positive/artifact-metadata.json; evidence/required-positive/kappaforge-integration-sandbox.json; evidence/local-required-sandbox-negative.json; tests/test_required_integration_gate.py

Remaining limitations: Verified mandatory integration gates on0bba923; unrelated live/native/device/benchmark coverage remains separately open. No integration/production claim.

## KF-AUDIT-049 — Dependency-map freshness is warning-only in CI

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P2.

Root cause: Stale context index may ship even when code imports change.

Required implementation: Generate deterministically and make freshness a required check or serve on-demand versioned index.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Dependency-map freshness is a mandatory CI failure. Regenerate from each exact standalone/composed candidate rather than a different worktree.

Required acceptance/tests: Import change without regenerated index fails check; index carries matching SHA.

Actual results: Old standalone641a7e9 CI failed map freshness; regenerated38aca4d CI passed.; Composeda62f949 CI required freshness check passed.

Regression coverage: scripts/dependency-map.py --check

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Map changes must be regenerated on every later source candidate; one branch map does not certify another.

## KF-AUDIT-050 — Production SLOs, incidents and long-window objective success unavailable

Classification: UNVERIFIED; status: **BLOCKED**; phase: H; priority: P1.

Root cause: Workflow status cannot measure task completion, latency, availability or false success.

Required implementation: Instrument task objective outcomes, route health, queue latency, recoveries, false-success audits and versioned SLO reports.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: No sustained production SLO result fabricated.

Required acceptance/tests: 30-day report has denominators, exclusions and incident causes; objective success is separately reported from run success.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Needs30-day objective-level denominators, exclusions, incidents and operational evidence after approved rollout.

## KF-AUDIT-051 — Current browser/Worker runtime and native build not fully executed locally

Classification: PARTIAL; status: **TESTING**; phase: H; priority: P2.

Root cause: Syntax and dry-run do not establish interactive or runtime behavior.

Required implementation: Execute existing workerd recovery check, Chromium/WebKit and macOS native suite in isolated CI.

Dependencies: Foundation contracts

Branch: remediation/b-versioned-tools; PR: [#334](https://github.com/onlykappa/KappaForge/pull/334).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Collected exact-candidate supported CI browser, isolated Worker recovery and foundation native evidence. Local runtime/browser limitations recorded separately.

Required acceptance/tests: Exact-head receipts include browser, runtime and native results with artifact hashes and skips.

Actual results: a62f949 CI unit/web/structure/Worker and real sandbox passed.; 38aca4d CI native five UI tests/build passed; no release.; Latest125a099 native check FAILED in composer case despite successful simulator/unsigned build. c3d6606 unit/web/Worker/structure passed. No integration-ready claim.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Newest composed head needs its own checks/artifact hashes. Local WebKit cannot launch without listed system libraries; no Xcode locally. Physical-device gates remain separate.

## KF-AUDIT-052 — Deployed Worker SHA and dashboard-managed policy not independently matched

Classification: PARTIAL; status: **BLOCKED**; phase: A; priority: P1.

Root cause: Engine main SHA is known, deployed Worker version/config fingerprint is not.

Required implementation: Return build SHA and redacted effective policy hash in authenticated health responses; archive deploy receipt.

Dependencies: Foundation contracts

Branch: remediation/a-effective-diagnostics; PR: [#336](https://github.com/onlykappa/KappaForge/pull/336).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Add authenticated no-store effective configuration diagnostics: configured credential presence only, channel/private-code policy, durable Premium enabled/unknown, Worker/build identity, stable policy fingerprint and explicit unprobed quota/availability. Deployment proposal stamps exact SHA; no deployment executed.

Required acceptance/tests: A task receipt identifies engine, Worker, policy and candidate versions end to end.

Actual results: Controlled Worker auth/method/origin, no-external-fetch, secret exclusion, unknown-store and fingerprint tests passed.; Existing premium free-first/off/no-charge-under-OFF tests run; no actual paid request.

Regression coverage: tests/deployment-diagnostics.test.mjs; tests/premium*.test.mjs

Final verification evidence: Not yet collected.

Remaining limitations: Current production snapshot and upstream account cost/quota state unavailable. Endpoint is an unmerged proposal; owner-authorized integration/deployment plus read-only snapshot needed for full acceptance.

## KF-AUDIT-053 — Push-to-main deployment couples code acceptance to production rollout

Classification: PARTIAL; status: **TESTING**; phase: A; priority: P2.

Root cause: Main merges can deploy Worker without an independently confirmed owner deployment decision unless environment gates enforce it.

Required implementation: Require explicit release authorization or protected environment approval with exact artifact digest; keep dry-run CI separate.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original finding retained. Candidate work or newly collected evidence is partial; remaining acceptance conditions are stated explicitly.

Implementation: Remove push-to-main deployment trigger. Deploy requires owner workflow_dispatch/main. Release additionally requires publish=true(defaultfalse), branchmain and empty/exact candidate SHA; builds remain independently available.

Required acceptance/tests: Merge alone cannot deploy/release under current owner policy; approved exact build can roll back to prior version.

Actual results: Executable guard negatives pass for push,PR,wrong actor/ref/branch/candidate and publishfalse.; Actual PR native build ran while release job skipped.

Regression coverage: tests/test_privileged_publication.py

Final verification evidence: Not yet collected.

Remaining limitations: No production deployment/rollback executed. Actual protected approval environment configuration and approved rollback drill remain owner-gated.

## KF-AUDIT-054 — Background autonomy is constrained by Actions and expiring task authority

Classification: PARTIAL; status: **INVESTIGATING**; phase: G; priority: P2.

Root cause: Actions scheduling and finite grants are not a general durable calendar/reminder service.

Required implementation: Expose supported schedules and expiry; optional DO alarm/queue coordinator with idempotent leases and owner-approved job scope.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: A scheduled test job survives coordinator restart; expired authorization blocks side effects and asks renewal once.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-055 — Limited stage parallelism is not independent multi-agent execution

Classification: PARTIAL; status: **INVESTIGATING**; phase: G; priority: P2.

Root cause: Disjoint-file waves alone do not prove workspace isolation, semantic conflict resolution or aggregate budget safety.

Required implementation: Keep serial default; permit optional isolated researcher/test/reviewer workers with explicit read/write sets and reconciliation.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Parallel independent fixtures reconcile cleanly; overlapping edits serialize; one child failure cannot corrupt parent state.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-056 — README presents obsolete capability and permission restrictions as current

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P2.

Root cause: Append-only milestone documentation contains mutually incompatible descriptions.

Required implementation: Publish one versioned current capability table and move historical release descriptions to history.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: README leads with current implementation/limitations and explicitly marks obsolete milestone prose historical. KAPPA commands name actual checks; application version remains2.2.9 until separately authorized release.

Required acceptance/tests: Every current capability links to implementation and exact validation; unsupported claims are visibly labeled.

Actual results: Current capabilities reference source/test evidence and missing production/general tools; nonexistent validate_change instruction removed.

Regression coverage: README.md; KAPPA.md; scripts/check-web.py

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Historical setup remains visibly preserved; documentation is not live functionality proof.

## KF-AUDIT-057 — All historical branches and PR descriptions not exhaustively inspected

Classification: UNVERIFIED; status: **INVESTIGATING**; phase: H; priority: P2.

Root cause: Large retained development history exceeds the inspected active surfaces; unassociated branches may contain material work.

Required implementation: Triage branch ancestry and last commit date, classify owner-active branches, inspect material divergences and archived PR context.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Every active divergent branch has owner/status, changed components and effect on audit; stale branches clearly excluded.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-058 — Task #330 test omits assertion for a required invalid key type

Classification: VERIFIED; status: **VERIFIED**; phase: A; priority: P2.

Root cause: Fixture includes key 123 but assertions only check string keys.

Required implementation: Add direct assertion against retained prior/totals keys and negative controls for each required invalid type.

Dependencies: Foundation contracts

Branch: remediation/a-foundation-security; PR: [#333](https://github.com/onlykappa/KappaForge/pull/333).

Latest-state reconciliation: Original acceptance checked against the candidate implementation and independent evidence listed below. Verified candidate only; not merged or production-validated.

Implementation: Direct real-Ledger input regression explicitly covers non-string key123 and asserts atomic rejection, preserved spend and write count.

Required acceptance/tests: Mutation that accepts non-string keys makes the new test fail while real implementation passes.

Actual results: Independent runtime mutation that admits non-string keys makes exactly that key123 subtest fail; real implementation passes. No product file modified.

Regression coverage: tests/test_budget_ledger_integrity.py:test_invalid_record_is_rejected_atomically

Final verification evidence: TEST-EVIDENCE.md; evidence/ci-receipts.json

Remaining limitations: Verified candidate only; owner approval and exact integration-head validation remain mandatory.

## KF-AUDIT-059 — Multimodal understanding/output coverage is not demonstrated

Classification: UNVERIFIED; status: **NOT STARTED**; phase: F; priority: P2.

Root cause: Voice/media transport is not evidence of document/image reasoning across active free models.

Required implementation: Define supported MIME/capability routes and fixture-based grounding tests; reject unsupported formats accurately.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Image/audio fixtures yield verified grounded outputs on allowed models or explicit unsupported state without fabricated inspection.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-060 — Duplicated recovery and authority surfaces increase change risk

Classification: PARTIAL; status: **INVESTIGATING**; phase: B; priority: P2.

Root cause: Cross-language twins and legacy/current paths require synchronized contracts.

Required implementation: Keep platform adapters but share schemas, conformance fixtures and one transition/receipt specification.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Same adversarial and transition corpus yields equivalent decisions in Python, Worker and frontend.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

## KF-AUDIT-061 — Sample contains failed/cancelled runs but broad recovered outcomes are not independently graded

Classification: UNVERIFIED; status: **INVESTIGATING**; phase: H; priority: P2.

Root cause: Survivorship avoided in selection, but status-only records cannot prove task-level recovery or intervention counts.

Required implementation: Grade sampled objectives against immutable requests/artifacts; include tasks without PRs and all retry chains.

Dependencies: Foundation contracts

Branch: unassigned; PR: not yet created.

Latest-state reconciliation: Canonical audit acceptance retained. Baseline main19c9592 had no post-audit fix at reconciliation. This gap is not closed by adjacent foundation changes.

Implementation: No fix claimed yet.

Required acceptance/tests: Random task sample reports first-attempt/recovery/human intervention with task denominator and missing-evidence count.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Original acceptance gate remains open; implement after dependencies, then collect independent evidence.

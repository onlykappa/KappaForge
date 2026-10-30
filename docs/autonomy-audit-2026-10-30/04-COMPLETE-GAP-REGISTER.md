# Complete evidence-supported gap register

Audit snapshot: 2026-10-30 UTC. Default branch `main`, commit `19c95923d12156688487fd8d4e1f6dd1c16eefa6`. Documentation-only branch `audit/autonomy-2026-10-30`. No inference requests, workflow dispatches, merges, releases, deployments or production configuration changes were made by this audit.

Evidence labels: VERIFIED = directly observed implementation or execution (the evidence specifies which); PARTIAL = implementation exists with material limits; BROKEN = observed failure or deterministic incorrect behavior; MISSING = no implementation found in the inspected execution surfaces; UNVERIFIED = insufficient execution/access evidence; NOT APPLICABLE = outside the declared supported scope. Source verification is not production verification.

This is the inventory from the inspected surfaces, not a claim that every possible defect has been found. UNVERIFIED entries are assurance/access gaps, not asserted product failures. Historical fixed symptoms are documented in report 05 and not counted as current broken defects.

61 gaps: High 31, Medium 28, Critical 1, Low 1

## KF-AUDIT-001 — File-scope constraint blocks an otherwise passing candidate

Subsystem: Verification  
Severity: High | Classification: BROKEN | Priority: P1

Description / user impact: File-scope constraint blocks an otherwise passing candidate. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/verify.py:parse_review; PR #331 requirements[16]; task #330. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Source-quote schema is applied to a constraint whose proof is the changed-file inventory.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Type evidence as source, diff_scope, command, authority or publication; verify scope deterministically from exact base/candidate diff.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Replay #330: one allowed file passes scope proof; adding any second file fails; no model quote needed.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-002 — Passing suite can certify tests of copied logic

Subsystem: Verification  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Passing suite can certify tests of copied logic. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: PR #323 diff; docs/phase3/issue-log.md:P3-131; engine/requirements.py:matrix. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Test citation and suite success do not establish execution of the production behavior.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Require production imports/calls plus independent negative controls or mutation tests for changed behavior.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Original #323 inline-copy test is rejected; a wrong production implementation makes the replacement test fail.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-003 — Workflow success differs from objective completion

Subsystem: Verification  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Workflow success differs from objective completion. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Run 41115534131 success; PR #331 incomplete; checkpoint testing. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Workflow exit code reports controller execution rather than delivered objective state.

Dependencies: KF-AUDIT-001 Phase A.

Recommended solution: Emit separate controller, validation and objective conclusions with a terminal receipt consumed by UI and workflows.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Green workflow plus blocked review renders blocked, never completed, in API and UI.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-004 — Requirement extraction silently drops work after 30 entries

Subsystem: Planning  
Severity: High | Classification: BROKEN | Priority: P1

Description / user impact: Requirement extraction silently drops work after 30 entries. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/requirements.py:split MAX_REQUIREMENTS; audit probe 40 inputs yields 30. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Fixed prefix cap has no overflow failure or decomposition receipt.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Detect overflow, preserve all original requirements and page/decompose with stable IDs.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: 40 explicit requirements produce 40 tracked IDs or a visible nonterminal overflow; none disappear.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-005 — Sparse budget updates discard previously spent counters

Subsystem: Persistence  
Severity: High | Classification: BROKEN | Priority: P1

Description / user impact: Sparse budget updates discard previously spent counters. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/budget_ledger.py:Ledger.record; audit probe calls+bytes then calls drops bytes. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Dictionary rebuilt only from incoming keys.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Merge into prior totals monotonically, preserving omitted keys.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Persist calls=10 bytes=100 then calls=11; restart retains bytes=100 and calls=11.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: S (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-006 — Budget record input is not sanitized like saved input

Subsystem: Persistence  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Budget record input is not sanitized like saved input. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/budget_ledger.py:Ledger.record versus __init__. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Only loaded values filter types and nonnegative values; record accepts arbitrary mapping values.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Validate finite numeric nonnegative counters and string keys at both ingress points.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Reject booleans, strings, NaN, infinity, negative values and non-string keys without corrupting prior spend.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: S (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-007 — Patch mismatch and unchanged proposals recur across nominally distinct strategies

Subsystem: Recovery  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Patch mismatch and unchanged proposals recur across nominally distinct strategies. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Task #322 recovery events: reread_source and smaller_stages repeat; engine/developer.py:generate_with. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Strategy labels do not demonstrate changed causal conditions.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase D.

Recommended solution: Persist normalized failure family, source version, attempted hypothesis and evidence delta; prohibit repeat without new evidence.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Replay #322 emits no same-anchor edit against the same source after its first failure; later action reads exact lines or changes edit method.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-008 — Latest malformed-tool recovery lacks live acceptance evidence

Subsystem: Recovery  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Latest malformed-tool recovery lacks live acceptance evidence. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/tool_loop.py; PR #327; #322 invalid_limit; #330 did not enter repair. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Parser/cap improvement tested locally but the historical failed workflow was not repeated on current runtime.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase D.

Recommended solution: Run isolated recorded-response replay and later an explicitly authorized live repair; retain stop reasons and candidate tests.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: A truncated reply, fenced object and singleton list recover and finish a genuine failing-import repair without changing task scope.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-009 — Recovery must reconcile closed drafts and obsolete goals before inference

Subsystem: Recovery  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Recovery must reconcile closed drafts and obsolete goals before inference. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Task #322 run 41114997477: No open pull request; #323 closed unmerged; engine/recovery.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Saved authority/candidate state can outlive the actionable draft.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Reconcile issue, PR state, branch, candidate and already-shipped behavior before any generation; terminal superseded/cancelled outcome.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Closed #323 produces zero model/tool writes and a precise superseded or owner-decision receipt.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-010 — Multiple retry ceilings do not encode five meaningful strategies

Subsystem: Recovery  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Multiple retry ceilings do not encode five meaningful strategies. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: developer.py:generate_with max_attempts=5; sandbox_repair_controller.py MAX_ATTEMPTS=20 MAX_MODEL_ACTIONS=100; recovery.py limits. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Proposal retries, sandbox attempts and continuations have different semantics and budgets.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase D.

Recommended solution: Unify lifetime budget accounting; default at most five evidence-changing repair strategies, category-specific transient waits separate.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Exhaustion across restart preserves all budgets; 429 waits do not consume repair strategies; no repeated side effects.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-011 — Initial generation and sandbox repair remain separate execution protocols

Subsystem: Runtime  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Initial generation and sandbox repair remain separate execution protocols. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: developer.py:select_files,generate_with,run_sandbox_repair; exploration.py; tool_loop.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Initial code is proposed from assembled context; dynamic tools exist in investigation and repair rather than one uniform loop.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Introduce typed action/observation runtime shared by planning, editing, tests and review; retain current adapters during migration.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: A task discovers an unplanned dependency, reads it, edits, tests and replans through one durable event contract.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-012 — Tool history is clipped rather than semantically compacted

Subsystem: Runtime  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Tool history is clipped rather than semantically compacted. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/tool_loop.py:history[-30000:] and _bounded_result 3000 chars; controller histories bounded. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Text tails can omit the original cause and prior ineffective strategies.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Keep immutable receipts externally; construct context from active goal, current evidence, failed hypotheses and retrievable result IDs.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: After >30k history the next action still respects first failure and can retrieve omitted output.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-013 — String find/replace is a fragile edit interface

Subsystem: Runtime  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: String find/replace is a fragile edit interface. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/sandbox_tools.py:apply_patch; developer.py:apply_changes; #322 anchor mismatches. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Model must reproduce exact text from excerpts; no generalized semantic patch transaction.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Provide versioned line/unified-diff patches with expected file digest and explicit conflict observations; retain exact-match safe fallback.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Formatting and stale-source fault fixtures trigger reread/rebase, never repeated blind replacement or silent wrong-file writes.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-014 — Static planning limits narrow large-project reach

Subsystem: Runtime  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Static planning limits narrow large-project reach. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: developer.py MAX_LISTED_PATHS=700 MAX_STAGES=5; read/change budgets. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Bounded windows are necessary but coverage is not an exhaustive repository investigation.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Page file/symbol inventory and expose explicit coverage and subgoal expansion under lifetime budgets.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Target past path 700 and dependency past initial source list are found without raising all context caps.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-015 — General-purpose executor is not exposed through the development-only tool catalog

Subsystem: Runtime  
Severity: High | Classification: MISSING | Priority: P1

Description / user impact: General-purpose executor is not exposed through the development-only tool catalog. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/tool_loop.py TOOL_CATALOG; chat-backend/src/operation-contract.js. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Tools center on sandbox coding, curated docs and app/GitHub operations.

Dependencies: KF-AUDIT-011 Phase F.

Recommended solution: Add permission-scoped capability registry with shared execution receipt and artifact contracts.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: One supported task combines research, a file artifact and authorized application operation with verified receipts.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-016 — NVIDIA priority routes fail in latest live task

Subsystem: Providers  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: NVIDIA priority routes fail in latest live task. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Task #330 gateway receipts: deepseek empty_response; nemotron timeout; inference-router.js. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Eligibility and static strong tier do not guarantee useful compatible output.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Add fixture-backed normalization/parameter contracts, route quality health by role and small opt-in canaries; demote unusable routes without hiding errors.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Replay 200-empty, reasoning-only and first-byte timeout; fallback completes, attribution and cooldown reasons remain correct.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-017 — Conservative admission makes strong fallback routes unusable for ordinary prompts

Subsystem: Providers  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Conservative admission makes strong fallback routes unusable for ordinary prompts. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Task #330 Groq context_limit, Mistral request_too_large; inference-router.js; docs/phase3/issue-log.md:P3-129. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Input/output reservations and conservative token estimates exceed route limits.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Keep safe upper bounds but create route-specific compact prompts and output reserves; validate tokenizer estimates before policy changes.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: #330-shaped request admits an eligible compact Groq/Mistral route when within its real limits; oversized requests still fail safely.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-018 — Model routing is role-ranked policy, not measured task-quality optimization

Subsystem: Providers  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Model routing is role-ranked policy, not measured task-quality optimization. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: config/providers.json routing; routing-policy.js; task #330 ranks. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Strong/light metadata and route order lack independent task success calibration.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Track verified outcome by model/role/task class with uncertainty and quota-aware selection.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Held-out routing evaluation beats static ordering on completion or latency without paid spend or quality regression.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-019 — Full deployed provider activation and quota state unavailable

Subsystem: Providers  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Full deployed provider activation and quota state unavailable. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: wrangler.toml keep_vars=true; production dashboard variables inaccessible; task #330 only shows attempted subset. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Repo configuration cannot establish deployed permission, credentials or remaining quotas.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Publish authenticated sanitized effective-config and deployment/version receipt with no inference.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Owner supplies read-only capabilities/health snapshot covering every provider and policy/version fingerprint.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-020 — Native tool calling is not the active coding protocol

Subsystem: Providers  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Native tool calling is not the active coding protocol. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: config/providers.json nvidia capabilities.tools=false; tool_loop.py JSON envelope; inference-router.js hasTools:false. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Application emulates tools with text JSON; native function schemas are not used here.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Retain portable JSON adapter; add tested native-tool adapter only for proven compatible models.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Both adapters pass identical validation/error/cancellation fixtures; unsupported route cannot receive native tool fields.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-021 — Paid-off default is implemented but current production setting is not audited

Subsystem: Providers  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Paid-off default is implemented but current production setting is not audited. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: chat-backend/src/premium.js,premium-store.js; routing-policy.js fullCatalog openrouter=false; tests/premium.test.mjs. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Persisted owner settings and current account state are not accessible.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Expose sanitized premium enabled flag and reservations; assert default off and last-resort ordering in deployment smoke suite.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Fresh store is OFF; free exhaustion alone cannot charge when OFF; explicit ON obeys task/day caps.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-022 — Mutable issue comments are the durable control-plane storage

Subsystem: Persistence  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Mutable issue comments are the durable control-plane storage. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/recovery.py:Journal.persist, multipart checkpoints; execution.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Checkpoint writes, progress and archive rotation span GitHub API operations without a single atomic transaction.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Add append-only sequence/hash-linked event journal plus CAS state pointer; keep issue comments as export/projection initially.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Kill between each multipart write and pointer update: recover exact validated candidate or explicit incomplete state, never stale success.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-023 — Recent execution context is deliberately bounded and can lose causal history

Subsystem: Persistence  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Recent execution context is deliberately bounded and can lose causal history. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: task_state.py INFERENCE_EVENTS=8; project_memory.py paths caps; recovery.py MAX_EVENTS=40. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Compact active state is not a permanent evidence ledger.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Separate bounded prompt view from complete retained event and artifact storage with retention policy.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Old failed hypothesis remains retrievable after rotation and restart without entering every prompt.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-024 — Current engine-pin restart behavior not fault-tested end to end here

Subsystem: Persistence  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Current engine-pin restart behavior not fault-tested end to end here. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: runtime_engine.py; recovery.py engine_pinned; tests/test_runtime_engine.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Many receipts/renewals guard runtime identity; local unit evidence is insufficient for real interruption coverage.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Create process-kill replay around engine renewal, sandbox save, publication and continuation dispatch.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: 20 injected interruption points resume on authorized engine/candidate with no budget reset or duplicate PR.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-025 — Project memory is a bounded index snapshot rather than durable project understanding

Subsystem: Memory  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Project memory is a bounded index snapshot rather than durable project understanding. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/project_memory.py:snapshot,recent_repo_memory; vector-index.js. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Paths/top files and commit IDs do not preserve validated decisions and failure causality as retrievable knowledge.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Separate project facts, decisions and source citations from task journal; invalidate on relevant changes.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Yesterday task resumes with cited decisions and failed approaches; changed source invalidates stale facts.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-026 — Cross-device sync, deletion and conflict handling lack live device evidence

Subsystem: Memory  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Cross-device sync, deletion and conflict handling lack live device evidence. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: preview/app-state.js encrypted vault, revision sync and 500 deletion tombstones. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Browser crypto/storage code and tests do not establish device retention or long-term deletion guarantees.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Specify retention and tombstone expiry; test concurrent offline edits, device restore and deletion propagation.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Two devices offline/online do not resurrect deleted chat; export and erase prove server/local removal within declared retention.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-027 — No general semantic task-context compaction service

Subsystem: Memory  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: No general semantic task-context compaction service. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tool_loop.py history clipping; task_state.py MAX_CONTEXT; project_memory.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Context assembly is distributed across code paths with size limits.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Use evidence-aware summarization retaining goal, constraints, unresolved subgoals, receipts and retrieval IDs.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Long task exceeds context size then resumes with every constraint intact and no repeated failed strategy.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-028 — General web search and research are absent beyond curated documentation

Subsystem: Tools  
Severity: High | Classification: MISSING | Priority: P1

Description / user impact: General web search and research are absent beyond curated documentation. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: config/research-hosts.json; engine/research.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Allowed search APIs are MDN, npm and ReadTheDocs, not broad current-information research.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Add optional free-first search adapter with dated citations, source access receipts and explicit unavailable outcomes.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: Five held-out research tasks cite fetched sources and distinguish inaccessible or conflicting evidence.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-029 — No agent-controlled browser session tools

Subsystem: Tools  
Severity: High | Classification: MISSING | Priority: P1

Description / user impact: No agent-controlled browser session tools. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/tool_loop.py catalog; research.py HTTP retrieval. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: HTTP docs fetch and UI Playwright tests are not an autonomous browser capability.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Optional isolated Playwright/browser worker with per-domain grants, screenshot/DOM observations and approval-bound submit actions.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: Navigate dynamic fixture, log in with delegated test credentials, extract data, stop before unauthorized external submit.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-030 — Document and spreadsheet workflows lack purpose-built adapters

Subsystem: Tools  
Severity: High | Classification: MISSING | Priority: P1

Description / user impact: Document and spreadsheet workflows lack purpose-built adapters. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tool catalog and app attachment/chat paths. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Attachments and generated source are not tested PDF/DOCX/XLSX operations.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Add sandbox file/artifact adapters, table parsing and deterministic output verification.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: Round-trip fixtures preserve formulas, sheets, document structure and produce downloadable artifacts.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-031 — General MCP/external connector runtime not found

Subsystem: Tools  
Severity: Medium | Classification: MISSING | Priority: P2

Description / user impact: General MCP/external connector runtime not found. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/tool_loop.py; operation-contract.js; config/repositories.json. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Integrations are bespoke; no discovered MCP lifecycle or permission registry.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Implement optional connector adapter with scoped grants, schemas, secret isolation and receipts; avoid mandatory service cost.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: One local fake MCP server supports discovery/call/cancel with denied tools never invoked.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-032 — Desktop/local-device execution is not an implemented agent surface

Subsystem: Tools  
Severity: Medium | Classification: MISSING | Priority: P2

Description / user impact: Desktop/local-device execution is not an implemented agent surface. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: ios native bridge and sandbox.py remote runner. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Native app bridge is not a general desktop automation or local shell agent.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase G.

Recommended solution: Optional signed local companion with explicit workspace/network grants; keep cloud-only use supported.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: Local test workspace read/edit works; access outside approved root is refused and logged.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-033 — Sandbox language/dependency profiles are narrower than arbitrary projects

Subsystem: Tools  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Sandbox language/dependency profiles are narrower than arbitrary projects. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: engine/sandbox.py profiles, dependency_plan and command validation. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Constrained Python/Node-oriented runners deliberately reject unsupported commands and installs.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Declare supported runtimes; add versioned image/profile adapters on demand with isolated installers.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Unsupported ecosystem identified before generation; supported pinned fixtures restore and test offline.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-034 — Real Docker isolation was not executed in this audit environment

Subsystem: Tools  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Real Docker isolation was not executed in this audit environment. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: sandbox.py flags; local Python skips; Docker CLI unavailable. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: No local Docker daemon/client evidence; existing production receipts prove tests ran but not hostile escape resistance.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Run sandbox-selftest in disposable approved runner and adversarial network/env/host filesystem tests.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: No secrets, Docker socket, host files or network visible to test commands; time/memory/process limits enforced.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-035 — Generated workflow proposals can execute before owner merge review

Subsystem: Security  
Severity: Critical | Classification: PARTIAL | Priority: P0

Description / user impact: Generated workflow proposals can execute before owner merge review. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: KAPPA.md workflow policy; developer.py:push_token; .github/workflows/agent.yml. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Draft status and no-auto-merge do not stop branch/workflow_dispatch execution with repository secrets.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Separate trusted orchestrator from candidate workflows; forbid secret-bearing execution from candidate refs until explicit workflow approval; use least-privilege installation tokens.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Malicious draft workflow attempting secret exfiltration never receives secrets or privileged token before explicit gate.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: L (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-036 — Persisted preferences contain historical authority broader than current owner policy

Subsystem: Security  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Persisted preferences contain historical authority broader than current owner policy. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: .kappaforge/owner-preferences.md owner authorization 2026-10-27; KAPPA.md versus current audit constraints. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Versioned natural-language instructions can outlive task-specific authorization.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Treat repository prose as untrusted preferences only; exact expiring grants in control plane govern consequential actions.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Historical auto-merge text cannot authorize a new task; policy contradictions surface as diagnostics.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-037 — Shared bearer credential persists in browser localStorage

Subsystem: Security  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Shared bearer credential persists in browser localStorage. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: preview/app-state.js access=localStorage.getItem; index.js Bearer authentication. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Single-owner simplicity increases impact of browser script compromise/device extraction.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Use short-lived session credentials and secure native storage or HttpOnly session where feasible; device revocation and strong CSP.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Revoked device token fails; injected script cannot read long-lived privileged credential in browser test.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-038 — Prompt-injection defense not independently adversarially validated

Subsystem: Security  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Prompt-injection defense not independently adversarially validated. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tool_loop.py untrusted-output warning; sandbox.py; intent_guard.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Prompt warnings plus path guards do not demonstrate resistance across model output and privileged GitHub operations.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Add adversarial fixture corpus for repo docs, comments, web pages and test output with controller-side authority checks.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Zero unauthorized writes, paid calls, merge/deploy or secret disclosures in the security benchmark and fuzz cases.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-039 — Deployed secret scopes, branch protections and environment gates unavailable

Subsystem: Security  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Deployed secret scopes, branch protections and environment gates unavailable. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: agent.yml, deploy-chat.yml cloudflare-production; configured PAT reference. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Workflow declarations do not establish actual PAT scope or production environment approval settings.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Collect read-only sanitized permission inventory and enforce environment approvals before deploy/release.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Owner verifies least privileges and deployment gate rejects unapproved release; audit record contains no values.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-040 — Cancellation races across running tools and publication need proof

Subsystem: Security  
Severity: Medium | Classification: UNVERIFIED | Priority: P2

Description / user impact: Cancellation races across running tools and publication need proof. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: task-cancellation.js; engine/intent_guard.py; sandbox.py timeout removal. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Checks exist but end-to-end cancellation during each side effect was not executed.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Use cancellation epoch on every tool/publish claim and actively terminate child sandbox execution.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Cancel at model wait, patch, test, push and dispatch boundaries; no later consequential action starts.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-041 — Retention and privacy boundaries differ across vault, issue journals and provider prompts

Subsystem: Security  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Retention and privacy boundaries differ across vault, issue journals and provider prompts. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: app-state.js vault; recovery.py issue comments; runner.py model requests. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Encrypted chat backup does not encrypt GitHub task evidence or provider-bound source.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase E.

Recommended solution: Publish data-flow policy and per-tool redaction/retention controls; prohibit private context in public issues.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Privacy fixtures verify secret redaction and correct private-code provider restrictions; deletion procedure covers every store.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: Authorization regression or premature privileged execution; gate migration on adversarial tests.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-042 — Task state can remain testing after runner has finished with incomplete review

Subsystem: UX  
Severity: High | Classification: BROKEN | Priority: P1

Description / user impact: Task state can remain testing after runner has finished with incomplete review. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Task #330 checkpoint status testing; run completed 19:36:14Z; PR incomplete. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: No canonical terminal reconciliation updates every projection.

Dependencies: KF-AUDIT-003 Phase A.

Recommended solution: Finalize durable objective state even on review block, then publish UI projection with sequence and heartbeat.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: #330 replay ends blocked_verification with accurate finished time and resume action; no indefinite active timer.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-043 — Native composer keyboard failure remains open

Subsystem: UX  
Severity: High | Classification: PARTIAL | Priority: P1

Description / user impact: Native composer keyboard failure remains open. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: PR #317: editor maxY 601, keyboard minY+14 232.333; ios UI tests; issue #313. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Existing layout test failed; no root cause confirmed in this audit.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Inspect native simulator artifact and bridge/layout geometry; repair without weakening keyboard assertions.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Same device/orientation reproducer passes composer-above-keyboard assertion and four other existing UI tests.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-044 — Task progress is polling-based with freshness limits

Subsystem: UX  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Task progress is polling-based with freshness limits. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: preview/app-tasks.js 10-second poll and freshness refresh; progress_notes.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Progress comments and frontend timing can diverge after delays/offline periods.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase C.

Recommended solution: Backend event sequence, heartbeat and terminal reconciliation; optional SSE transport, polling fallback.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Out-of-order/duplicate events never regress state; offline reconnect reflects terminal backend state within 15 seconds.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-045 — UI implementation relies on classic-script shared globals and mirrored bundles

Subsystem: UX  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: UI implementation relies on classic-script shared globals and mirrored bundles. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: KAPPA.md Application; preview/index.html; scripts/bundle-web.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Load-order dependencies and generated copies increase integration risk.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase G.

Recommended solution: Gradually introduce explicit modules/state contracts while preserving shared bundle checks.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Web/iOS generated assets match; initialization-order and restored-session tests pass after each module migration.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-046 — Apple-style refinement and real-device accessibility not assessed

Subsystem: UX  
Severity: Low | Classification: UNVERIFIED | Priority: P3

Description / user impact: Apple-style refinement and real-device accessibility not assessed. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: preview styles; ios UI; local web syntax tests. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: No interactive device session or visual/accessibility execution in this audit.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Run existing browser suite and targeted real-device keyboard, touch, VoiceOver and offline checks.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Document screenshots and accessibility results for agreed device sizes with no critical interaction blockers.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-047 — No measured general-purpose 50-task autonomy benchmark

Subsystem: Testing  
Severity: High | Classification: MISSING | Priority: P1

Description / user impact: No measured general-purpose 50-task autonomy benchmark. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tests unit suites; tools/lifecycle_simulation.py narrow coding harness. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Unit counts and prior simulation passes are not independent broad workload outcomes.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Implement the 50-task protocol in report 08 with hidden acceptance and task-level receipts.

Alternative: Restrict the supported workload and show this limitation before dispatch until a verified adapter exists.

Acceptance criteria: All tasks have actual results or unsupported outcomes; aggregate metrics computed from raw records.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-048 — Local passing suites leave important integrations skipped

Subsystem: Testing  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Local passing suites leave important integrations skipped. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Audit Python 1452 run, 36 skipped; Docker/native/structural tooling unavailable locally. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Optional infrastructure checks are not exercised by the local suite.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Report skips by capability; require dedicated integration gates with available infrastructure.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Critical integration gate cannot pass when all real runtime tests are skipped.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-049 — Dependency-map freshness is warning-only in CI

Subsystem: Testing  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Dependency-map freshness is warning-only in CI. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tests.yml dependency-map --check || warning. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Stale context index may ship even when code imports change.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Generate deterministically and make freshness a required check or serve on-demand versioned index.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Import change without regenerated index fails check; index carries matching SHA.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: S (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-050 — Production SLOs, incidents and long-window objective success unavailable

Subsystem: Testing  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Production SLOs, incidents and long-window objective success unavailable. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: Actions run history; no supplied production telemetry or owner session traces. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Workflow status cannot measure task completion, latency, availability or false success.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Instrument task objective outcomes, route health, queue latency, recoveries, false-success audits and versioned SLO reports.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: 30-day report has denominators, exclusions and incident causes; objective success is separately reported from run success.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-051 — Current browser/Worker runtime and native build not fully executed locally

Subsystem: Testing  
Severity: Medium | Classification: UNVERIFIED | Priority: P2

Description / user impact: Current browser/Worker runtime and native build not fully executed locally. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: tests.yml workerd and Playwright jobs; local audit check-web/build evidence. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Syntax and dry-run do not establish interactive or runtime behavior.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Execute existing workerd recovery check, Chromium/WebKit and macOS native suite in isolated CI.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Exact-head receipts include browser, runtime and native results with artifact hashes and skips.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-052 — Deployed Worker SHA and dashboard-managed policy not independently matched

Subsystem: Deployment  
Severity: High | Classification: UNVERIFIED | Priority: P1

Description / user impact: Deployed Worker SHA and dashboard-managed policy not independently matched. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: wrangler.toml keep_vars; deploy-chat.yml; latest route receipts. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Engine main SHA is known, deployed Worker version/config fingerprint is not.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Return build SHA and redacted effective policy hash in authenticated health responses; archive deploy receipt.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: A task receipt identifies engine, Worker, policy and candidate versions end to end.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-053 — Push-to-main deployment couples code acceptance to production rollout

Subsystem: Deployment  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Push-to-main deployment couples code acceptance to production rollout. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: deploy-chat.yml push trigger and cloudflare-production environment. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Main merges can deploy Worker without an independently confirmed owner deployment decision unless environment gates enforce it.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Require explicit release authorization or protected environment approval with exact artifact digest; keep dry-run CI separate.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Merge alone cannot deploy/release under current owner policy; approved exact build can roll back to prior version.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-054 — Background autonomy is constrained by Actions and expiring task authority

Subsystem: Scheduling  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Background autonomy is constrained by Actions and expiring task authority. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: recovery.yml schedule; agent.yml timeouts; recovery.py continuation limits. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Actions scheduling and finite grants are not a general durable calendar/reminder service.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase G.

Recommended solution: Expose supported schedules and expiry; optional DO alarm/queue coordinator with idempotent leases and owner-approved job scope.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: A scheduled test job survives coordinator restart; expired authorization blocks side effects and asks renewal once.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-055 — Limited stage parallelism is not independent multi-agent execution

Subsystem: Parallelism  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Limited stage parallelism is not independent multi-agent execution. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: developer.py:waves MAX_PARALLEL_WORKERS=3; shared task context. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Disjoint-file waves alone do not prove workspace isolation, semantic conflict resolution or aggregate budget safety.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase G.

Recommended solution: Keep serial default; permit optional isolated researcher/test/reviewer workers with explicit read/write sets and reconciliation.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Parallel independent fixtures reconcile cleanly; overlapping edits serialize; one child failure cannot corrupt parent state.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-056 — README presents obsolete capability and permission restrictions as current

Subsystem: Documentation  
Severity: Medium | Classification: BROKEN | Priority: P2

Description / user impact: README presents obsolete capability and permission restrictions as current. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: README.md Current capability(v0.1), v0.2 sandbox, self-repair sections versus current developer.py. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Append-only milestone documentation contains mutually incompatible descriptions.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Publish one versioned current capability table and move historical release descriptions to history.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Every current capability links to implementation and exact validation; unsupported claims are visibly labeled.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: S (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-057 — All historical branches and PR descriptions not exhaustively inspected

Subsystem: Documentation  
Severity: Medium | Classification: UNVERIFIED | Priority: P2

Description / user impact: All historical branches and PR descriptions not exhaustively inspected. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: 273 branches discovered; 100 recent PR metadata; six open PR changed-file inventories. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Large retained development history exceeds the inspected active surfaces; unassociated branches may contain material work.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Triage branch ancestry and last commit date, classify owner-active branches, inspect material divergences and archived PR context.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Every active divergent branch has owner/status, changed components and effect on audit; stale branches clearly excluded.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-058 — Task #330 test omits assertion for a required invalid key type

Subsystem: Testing  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Task #330 test omits assertion for a required invalid key type. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: PR #331 tests/test_budget_ledger.py:test_ignores_invalid_saved_values. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Fixture includes key 123 but assertions only check string keys.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase A.

Recommended solution: Add direct assertion against retained prior/totals keys and negative controls for each required invalid type.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Mutation that accepts non-string keys makes the new test fail while real implementation passes.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: S (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-059 — Multimodal understanding/output coverage is not demonstrated

Subsystem: Memory  
Severity: Medium | Classification: UNVERIFIED | Priority: P2

Description / user impact: Multimodal understanding/output coverage is not demonstrated. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: chat-backend/src/voice.js; providers.js media metadata; app attachments. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Voice/media transport is not evidence of document/image reasoning across active free models.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase F.

Recommended solution: Define supported MIME/capability routes and fixture-based grounding tests; reject unsupported formats accurately.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Image/audio fixtures yield verified grounded outputs on allowed models or explicit unsupported state without fabricated inspection.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-060 — Duplicated recovery and authority surfaces increase change risk

Subsystem: Runtime  
Severity: Medium | Classification: PARTIAL | Priority: P2

Description / user impact: Duplicated recovery and authority surfaces increase change risk. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: runner.py fallback path; inference-router.js; intent_guard.py and intent-guard.js; actions_log.py and actions-core.js. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Cross-language twins and legacy/current paths require synchronized contracts.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase B.

Recommended solution: Keep platform adapters but share schemas, conformance fixtures and one transition/receipt specification.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Same adversarial and transition corpus yields equivalent decisions in Python, Worker and frontend.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.


## KF-AUDIT-061 — Sample contains failed/cancelled runs but broad recovered outcomes are not independently graded

Subsystem: Testing  
Severity: Medium | Classification: UNVERIFIED | Priority: P2

Description / user impact: Sample contains failed/cancelled runs but broad recovered outcomes are not independently graded. This limits reliable delivery or the evidence needed to trust that delivery.

Evidence: 100 agent runs; #308 many green Fix runs; #319 cancelled; report11. Repository references resolve to the audit SHA above; live evidence is linked in report 11.

Root cause: Survivorship avoided in selection, but status-only records cannot prove task-level recovery or intervention counts.

Dependencies: No prerequisite gap; preserve existing authority and exact-candidate checks. Phase H.

Recommended solution: Grade sampled objectives against immutable requests/artifacts; include tasks without PRs and all retry chains.

Alternative: Keep the existing implementation temporarily, but expose the limitation and fail closed rather than claim completion.

Acceptance criteria: Random task sample reports first-attempt/recovery/human intervention with task denominator and missing-evidence count.

Validation: Execute the acceptance scenario in an isolated fixture, record exact versions, commands, receipts and negative controls; then an owner-authorized canary where production evidence is necessary. Never infer closure from merge status.

Risk: State/contract compatibility with saved tasks and current UI; preserve old receipts and compare projections before cutover.

Effort: M (S: days; M: several engineering days to a few weeks; L: multiple weeks, contingent on access and scope). Unknowns: deployed configuration and live provider behavior are not fully accessible.

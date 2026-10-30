# Dependency-aware engineering roadmap

Audit snapshot: 2026-10-30 UTC. Default branch `main`, commit `19c95923d12156688487fd8d4e1f6dd1c16eefa6`. Documentation-only branch `audit/autonomy-2026-10-30`. No inference requests, workflow dispatches, merges, releases, deployments or production configuration changes were made by this audit.

Evidence labels: VERIFIED = directly observed implementation or execution (the evidence specifies which); PARTIAL = implementation exists with material limits; BROKEN = observed failure or deterministic incorrect behavior; MISSING = no implementation found in the inspected execution surfaces; UNVERIFIED = insufficient execution/access evidence; NOT APPLICABLE = outside the declared supported scope. Source verification is not production verification.

Critical path: typed evidence + complete requirements + safe privilege boundaries → unified action receipts → durable execution/cancellation → evidence-changing recovery → held-out task acceptance. Broad browser/office/parallel features cannot compensate for this foundation. Phase H evaluation design starts immediately; it is not postponed until the end. All work below is proposed, not implemented.

## Phase A — Stabilize truth, budgets and privileged boundaries

Goal and capability improvement: Narrow coding tasks can finish with truthful status and safer publication.

Current blockers: Existing evidence-type mismatch, stale status, workflow authority and missing deployed provenance.

Required implementation / technical approach: Typed evidence checker; terminal objective receipt; complete requirement list; monotonic budgets; closed-task reconciliation; secret-free candidate workflows; version/policy health receipt. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-001, KF-AUDIT-002, KF-AUDIT-003, KF-AUDIT-004, KF-AUDIT-005, KF-AUDIT-006, KF-AUDIT-009, KF-AUDIT-016, KF-AUDIT-019, KF-AUDIT-021, KF-AUDIT-035, KF-AUDIT-036, KF-AUDIT-037, KF-AUDIT-039, KF-AUDIT-042, KF-AUDIT-049, KF-AUDIT-052, KF-AUDIT-053, KF-AUDIT-056, KF-AUDIT-058.

Dependencies: None; audit approval before fixes.

Major components: engine/verify.py,requirements.py,budget_ledger.py,recovery.py; frontend task projection; workflows; Worker health. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Replay #330 scope failure, budget sparse update, 40 requirements, closed #323 and malicious draft workflow. All must have deterministic negative controls..

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 45–52/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Confirm deployment approval gates and sanitized configuration access; no paid mode.

Rollback: Feature-flag new receipt reader; keep old checkpoint import; restore prior trusted workflow and pin engine. Never roll back budget spend, completed side effects or cancellation records.


## Phase B — Unify the real agent runtime

Goal and capability improvement: Dynamic evidence-driven coding across stages.

Current blockers: Separate proposal/investigation/repair protocols and clipped tool observations.

Required implementation / technical approach: One typed action loop, paged reads and versioned patch tool; schema adapters and shared conformance fixtures. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-011, KF-AUDIT-012, KF-AUDIT-013, KF-AUDIT-014, KF-AUDIT-020, KF-AUDIT-060.

Dependencies: A.

Major components: engine/developer.py,tool_loop.py,sandbox_tools.py,task_state.py; operation-contract.js. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Unplanned dependency discovery, conflicting edit, tool argument correction and long-history retrieval; existing sandbox and authorization regressions pass.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 50–60/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Approve supported workspace/action surface.

Rollback: Run old controller behind adapter; compare receipts before switching task types. Never roll back budget spend, completed side effects or cancellation records.


## Phase C — Durable isolated execution and truthful progress

Goal and capability improvement: Reliable interruption/resumption for supported coding tasks.

Current blockers: Multipart comments, unknown kill recovery and runtime coverage.

Required implementation / technical approach: Append-only journal + CAS snapshot, artifact IDs, cancellation epoch, executor receipts and event projection. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-022, KF-AUDIT-023, KF-AUDIT-024, KF-AUDIT-033, KF-AUDIT-034, KF-AUDIT-040, KF-AUDIT-044.

Dependencies: A then B receipt contract.

Major components: engine/execution.py,recovery.py,sandbox.py; Worker DO coordinator; app-tasks.js. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: 20 kill points; no duplicate effects, lost candidate or reset budget; real sandbox network/secret/timeout isolation; reconnect state within 15s.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 58–68/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Disposable compute and retention choice; optional storage only with approval.

Rollback: Dual-write journal; verify rebuild; fall back to previous coordinator without replaying writes. Never roll back budget spend, completed side effects or cancellation records.


## Phase D — Evidence-based recovery

Goal and capability improvement: Useful self-correction instead of retry labels.

Current blockers: Repeated failures, malformed output and inconsistent attempt semantics.

Required implementation / technical approach: Failure taxonomy, hypothesis/evidence deltas, strategy ledger and category-specific retry budgets. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-007, KF-AUDIT-008, KF-AUDIT-010.

Dependencies: B,C.

Major components: engine/repair_strategy.py,sandbox_repair_controller.py,reliability.py,tool_loop.py. Relative complexity: M/L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Injected malformed JSON, wrong import, transient 429, provider outage and repeated anchor; recover supported faults within five different repair strategies.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 63–73/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Confirm five-strategy default and escalation policy.

Rollback: Keep failed-strategy ledger; revert planner selection, never restore spent budget. Never roll back budget spend, completed side effects or cancellation records.


## Phase E — Quality-aware routing and context

Goal and capability improvement: Longer coherent tasks with better eligible model utilization.

Current blockers: Strong routes excluded at real prompt sizes; project memory and context fragments.

Required implementation / technical approach: Capability/quality routing, safe route-specific compaction; separated project facts, chat and execution retrieval; privacy/deletion contract. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-017, KF-AUDIT-018, KF-AUDIT-025, KF-AUDIT-026, KF-AUDIT-027, KF-AUDIT-041.

Dependencies: B,C; D for recovery quality feedback.

Major components: providers.json,router modules,project_memory.py,task_state.py,app-state.js. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Held-out routing quality test; large context retains every constraint; cross-device deletion; stale fact invalidation; free-first and OFF premium regressions.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 68–78/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Retention/privacy choice and existing provider quotas; paid stays OFF.

Rollback: Revert routing policy version, retain old memory read path and all canonical journal events. Never roll back budget spend, completed side effects or cancellation records.


## Phase F — Expand general-purpose tools and repair native interaction

Goal and capability improvement: General assistant workflows beyond coding.

Current blockers: No broad search/browser/office/MCP; open native keyboard defect.

Required implementation / technical approach: Optional search/browser/file/office/connector adapters, MIME routing and native geometry fix with unchanged assertions. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-015, KF-AUDIT-028, KF-AUDIT-029, KF-AUDIT-030, KF-AUDIT-031, KF-AUDIT-043, KF-AUDIT-059.

Dependencies: B,C,E security contracts.

Major components: tool registry/adapters; artifact store; preview/; ios/; voice/media routes. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Research provenance, dynamic browser fixture, spreadsheet formulas, document round trip, connector denial, device keyboard and multimodal grounding.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 73–85/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Choose priority tools and test service accounts; approve optional compute before cost.

Rollback: Disable adapters by capability version; preserve user files and current chat; native previous build available. Never roll back budget spend, completed side effects or cancellation records.


## Phase G — Long-horizon scheduling and selective parallel work

Goal and capability improvement: Multi-session projects and selected parallel tasks.

Current blockers: Finite Actions execution, limited stage waves and classic UI coupling.

Required implementation / technical approach: Explicit scheduled grants; optional local companion; isolated worker roles; modular UI contracts. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-032, KF-AUDIT-045, KF-AUDIT-054, KF-AUDIT-055.

Dependencies: C,D,E and serial success gates.

Major components: task_queue.py,DO coordinator,executor adapters,frontend state modules. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: Restart scheduled job, expiry, disjoint worker reconciliation and overlapping-write rejection; local root containment.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 78–90/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Approve schedules/local access and aggregate budgets; no standing merge/deploy grant.

Rollback: Disable scheduling/parallel/local adapters; drain in-flight leases; retain serial mode. Never roll back budget spend, completed side effects or cancellation records.


## Phase H — Independent acceptance and operational qualification

Goal and capability improvement: Measured production readiness and target-scope completion.

Current blockers: No broad task benchmark, inaccessible settings and incomplete runtime/device coverage.

Required implementation / technical approach: Implement report08 harness, hidden acceptance, adversarial tests, SLO dashboards and branch/PR evidence closure. Retain authority and candidate identity checks throughout.

Exact gaps: KF-AUDIT-038, KF-AUDIT-046, KF-AUDIT-047, KF-AUDIT-048, KF-AUDIT-050, KF-AUDIT-051, KF-AUDIT-057, KF-AUDIT-061.

Dependencies: Evaluation starts in A; final gates require supported F/G scope.

Major components: evaluation harness; CI; metrics; docs/tracker. Relative complexity: L. Risk: saved task migration, authority changes and inconsistent old/new projections; require shadow comparison before promotion.

Suggested PR sequence: first schema + failing acceptance fixtures; next narrowly scoped implementation by component; then migration/import and UI consumption; finally exact-head integration receipts and tracker update. Keep security-boundary PRs separate from UX expansion. Never count a merged PR as closure.

Required tests: 50 tasks, repeated seeds, fault/security suites, all critical integration checks non-skipped; 30-day SLO evidence.

Completion criteria: every listed gap's acceptance criteria passes with exact version evidence; no unresolved critical regression; UNVERIFIED entries need the missing evidence, not a documentation-only closure.

Score potential: 90–100 conditional on thresholds/100 overall maturity after verification, not additive or guaranteed. Re-score all twelve categories from measured results.

Owner actions: Authorize live free inference budget and disposable accounts; owner deploy approval remains separate.

Rollback: Block capability promotion when acceptance fails; restore previous supported feature set with receipts. Never roll back budget spend, completed side effects or cancellation records.

## Practical maturity milestones

| Target | Reliably supported behavior / tools | Independence and remaining limitations | Safe regular use gate |
|---|---|---|---|
| 25% | Narrow chat/source analysis, no unverified execution claims | Explicit scope, manual recovery; no general tool autonomy | Low-consequence use with owner verification |
| 50% | Scoped repo edits, tests, draft PR, truthful typed completion, free fallback | Bounded tools; common failures recover; no arbitrary apps | No P0; supported coding smoke suite ≥80%, zero unauthorized effects |
| 75% | Dynamic coding, docs research, artifacts, tested restart and selected browser/files | Verified common multi-step tasks, limited optional integrations | Held-out supported completion ≥85%, recovery ≥75%, no false-success sample |
| 90% | Long projects, safe scheduled work, optional parallel roles and memory | Most supported tasks finish without infrastructure debugging; unsupported work identified | ≥90% supported completion, ≥85% fault recovery, ≥95% restart recovery; 30-day SLO |
| 100% target scope | Declared chat/coding/research/file/data/browser/approved API workflows with evidence | No omniscience or unlimited quotas; explicit unsupported/blocked outcomes; consequential actions require owner | All critical/high functionality gates closed; ≥95% supported completion, ≥90% fault recovery, ≥99% restart recovery, zero observed false success/unauthorized effects in ≥500 evaluations, supported-task intervention ≤10% excluding required approvals |

100% is scoped acceptance, not equality to proprietary models. Adopt thresholds only after owner agrees the supported task and environment set. Track confidence intervals, task difficulty, failure categories and free quota limitations; passing 50 tasks once cannot establish a 99% rate. Measure unsupported identification ≥95%, cancellation no new side effects within a declared 10-second check boundary (already-started remote operations explicitly reconciled), p95 first progress ≤5s for accepted API tasks excluding external dispatch delay, and declared latency/quota budgets per workload. If free capacity cannot sustain these goals, narrow the supported SLA or approve an optional provider policy; never silently activate premium.

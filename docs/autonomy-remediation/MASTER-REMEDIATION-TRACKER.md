# Master remediation tracker

Baseline main:19c95923d12156688487fd8d4e1f6dd1c16eefa6. Audit archive verified against all eleven reports and61 unique canonical gaps. No improved autonomy score is assigned. No merge/deploy/release authorized.

Statuses: NOT STARTED / INVESTIGATING / IMPLEMENTING / TESTING / BLOCKED / VERIFIED / INTEGRATED. VERIFIED requires the original acceptance gate; local progress alone never closes live evidence requirements.

Counts: BLOCKED=9, INVESTIGATING=52

Machine-readable record: gaps.json. Regenerate with python docs/autonomy-remediation/update_tracker.py.

## Resume checkpoint

Read TEST-EVIDENCE.md and INTEGRATION-PLAN.md, fetch latest main/open PRs, inspect candidate branches, then continue the first unmet dependency. Preserve old failure evidence. Do not repeat validated tests unless code/environment changed.

## KF-AUDIT-001 — File-scope constraint blocks an otherwise passing candidate

Classification: BROKEN; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Source-quote schema is applied to a constraint whose proof is the changed-file inventory.

Required implementation: Type evidence as source, diff_scope, command, authority or publication; verify scope deterministically from exact base/candidate diff.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Replay #330: one allowed file passes scope proof; adding any second file fails; no model quote needed.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-002 — Passing suite can certify tests of copied logic

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Test citation and suite success do not establish execution of the production behavior.

Required implementation: Require production imports/calls plus independent negative controls or mutation tests for changed behavior.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Original #323 inline-copy test is rejected; a wrong production implementation makes the replacement test fail.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-003 — Workflow success differs from objective completion

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Workflow exit code reports controller execution rather than delivered objective state.

Required implementation: Emit separate controller, validation and objective conclusions with a terminal receipt consumed by UI and workflows.

Dependencies: KF-AUDIT-001

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Green workflow plus blocked review renders blocked, never completed, in API and UI.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-004 — Requirement extraction silently drops work after 30 entries

Classification: BROKEN; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Fixed prefix cap has no overflow failure or decomposition receipt.

Required implementation: Detect overflow, preserve all original requirements and page/decompose with stable IDs.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: 40 explicit requirements produce 40 tracked IDs or a visible nonterminal overflow; none disappear.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-005 — Sparse budget updates discard previously spent counters

Classification: BROKEN; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Dictionary rebuilt only from incoming keys.

Required implementation: Merge into prior totals monotonically, preserving omitted keys.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Persist calls=10 bytes=100 then calls=11; restart retains bytes=100 and calls=11.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-006 — Budget record input is not sanitized like saved input

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P2.

Root cause: Only loaded values filter types and nonnegative values; record accepts arbitrary mapping values.

Required implementation: Validate finite numeric nonnegative counters and string keys at both ingress points.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Reject booleans, strings, NaN, infinity, negative values and non-string keys without corrupting prior spend.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-007 — Patch mismatch and unchanged proposals recur across nominally distinct strategies

Classification: PARTIAL; status: **INVESTIGATING**; phase:D; priority:P1.

Root cause: Strategy labels do not demonstrate changed causal conditions.

Required implementation: Persist normalized failure family, source version, attempted hypothesis and evidence delta; prohibit repeat without new evidence.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Replay #322 emits no same-anchor edit against the same source after its first failure; later action reads exact lines or changes edit method.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-008 — Latest malformed-tool recovery lacks live acceptance evidence

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:D; priority:P1.

Root cause: Parser/cap improvement tested locally but the historical failed workflow was not repeated on current runtime.

Required implementation: Run isolated recorded-response replay and later an explicitly authorized live repair; retain stop reasons and candidate tests.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: A truncated reply, fenced object and singleton list recover and finish a genuine failing-import repair without changing task scope.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-009 — Recovery must reconcile closed drafts and obsolete goals before inference

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Saved authority/candidate state can outlive the actionable draft.

Required implementation: Reconcile issue, PR state, branch, candidate and already-shipped behavior before any generation; terminal superseded/cancelled outcome.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Closed #323 produces zero model/tool writes and a precise superseded or owner-decision receipt.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-010 — Multiple retry ceilings do not encode five meaningful strategies

Classification: PARTIAL; status: **INVESTIGATING**; phase:D; priority:P2.

Root cause: Proposal retries, sandbox attempts and continuations have different semantics and budgets.

Required implementation: Unify lifetime budget accounting; default at most five evidence-changing repair strategies, category-specific transient waits separate.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Exhaustion across restart preserves all budgets; 429 waits do not consume repair strategies; no repeated side effects.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-011 — Initial generation and sandbox repair remain separate execution protocols

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P1.

Root cause: Initial code is proposed from assembled context; dynamic tools exist in investigation and repair rather than one uniform loop.

Required implementation: Introduce typed action/observation runtime shared by planning, editing, tests and review; retain current adapters during migration.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: A task discovers an unplanned dependency, reads it, edits, tests and replans through one durable event contract.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-012 — Tool history is clipped rather than semantically compacted

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P2.

Root cause: Text tails can omit the original cause and prior ineffective strategies.

Required implementation: Keep immutable receipts externally; construct context from active goal, current evidence, failed hypotheses and retrievable result IDs.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: After >30k history the next action still respects first failure and can retrieve omitted output.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-013 — String find/replace is a fragile edit interface

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P1.

Root cause: Model must reproduce exact text from excerpts; no generalized semantic patch transaction.

Required implementation: Provide versioned line/unified-diff patches with expected file digest and explicit conflict observations; retain exact-match safe fallback.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Formatting and stale-source fault fixtures trigger reread/rebase, never repeated blind replacement or silent wrong-file writes.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-014 — Static planning limits narrow large-project reach

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P2.

Root cause: Bounded windows are necessary but coverage is not an exhaustive repository investigation.

Required implementation: Page file/symbol inventory and expose explicit coverage and subgoal expansion under lifetime budgets.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Target past path 700 and dependency past initial source list are found without raising all context caps.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-015 — General-purpose executor is not exposed through the development-only tool catalog

Classification: MISSING; status: **INVESTIGATING**; phase:F; priority:P1.

Root cause: Tools center on sandbox coding, curated docs and app/GitHub operations.

Required implementation: Add permission-scoped capability registry with shared execution receipt and artifact contracts.

Dependencies: KF-AUDIT-011

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: One supported task combines research, a file artifact and authorized application operation with verified receipts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-016 — NVIDIA priority routes fail in latest live task

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Eligibility and static strong tier do not guarantee useful compatible output.

Required implementation: Add fixture-backed normalization/parameter contracts, route quality health by role and small opt-in canaries; demote unusable routes without hiding errors.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Replay 200-empty, reasoning-only and first-byte timeout; fallback completes, attribution and cooldown reasons remain correct.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-017 — Conservative admission makes strong fallback routes unusable for ordinary prompts

Classification: PARTIAL; status: **INVESTIGATING**; phase:E; priority:P1.

Root cause: Input/output reservations and conservative token estimates exceed route limits.

Required implementation: Keep safe upper bounds but create route-specific compact prompts and output reserves; validate tokenizer estimates before policy changes.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: #330-shaped request admits an eligible compact Groq/Mistral route when within its real limits; oversized requests still fail safely.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-018 — Model routing is role-ranked policy, not measured task-quality optimization

Classification: PARTIAL; status: **INVESTIGATING**; phase:E; priority:P2.

Root cause: Strong/light metadata and route order lack independent task success calibration.

Required implementation: Track verified outcome by model/role/task class with uncertainty and quota-aware selection.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Held-out routing evaluation beats static ordering on completion or latency without paid spend or quality regression.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-019 — Full deployed provider activation and quota state unavailable

Classification: UNVERIFIED; status: **BLOCKED**; phase:A; priority:P1.

Root cause: Repo configuration cannot establish deployed permission, credentials or remaining quotas.

Required implementation: Publish authenticated sanitized effective-config and deployment/version receipt with no inference.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Owner supplies read-only capabilities/health snapshot covering every provider and policy/version fingerprint.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Production provider permission/configuration snapshot inaccessible.

## KF-AUDIT-020 — Native tool calling is not the active coding protocol

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P2.

Root cause: Application emulates tools with text JSON; native function schemas are not used here.

Required implementation: Retain portable JSON adapter; add tested native-tool adapter only for proven compatible models.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Both adapters pass identical validation/error/cancellation fixtures; unsupported route cannot receive native tool fields.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-021 — Paid-off default is implemented but current production setting is not audited

Classification: UNVERIFIED; status: **BLOCKED**; phase:A; priority:P1.

Root cause: Persisted owner settings and current account state are not accessible.

Required implementation: Expose sanitized premium enabled flag and reservations; assert default off and last-resort ordering in deployment smoke suite.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Fresh store is OFF; free exhaustion alone cannot charge when OFF; explicit ON obeys task/day caps.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Persisted production Premium setting inaccessible; defaults can be tested offline.

## KF-AUDIT-022 — Mutable issue comments are the durable control-plane storage

Classification: PARTIAL; status: **INVESTIGATING**; phase:C; priority:P1.

Root cause: Checkpoint writes, progress and archive rotation span GitHub API operations without a single atomic transaction.

Required implementation: Add append-only sequence/hash-linked event journal plus CAS state pointer; keep issue comments as export/projection initially.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Kill between each multipart write and pointer update: recover exact validated candidate or explicit incomplete state, never stale success.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-023 — Recent execution context is deliberately bounded and can lose causal history

Classification: PARTIAL; status: **INVESTIGATING**; phase:C; priority:P2.

Root cause: Compact active state is not a permanent evidence ledger.

Required implementation: Separate bounded prompt view from complete retained event and artifact storage with retention policy.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Old failed hypothesis remains retrievable after rotation and restart without entering every prompt.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-024 — Current engine-pin restart behavior not fault-tested end to end here

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:C; priority:P1.

Root cause: Many receipts/renewals guard runtime identity; local unit evidence is insufficient for real interruption coverage.

Required implementation: Create process-kill replay around engine renewal, sandbox save, publication and continuation dispatch.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: 20 injected interruption points resume on authorized engine/candidate with no budget reset or duplicate PR.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-025 — Project memory is a bounded index snapshot rather than durable project understanding

Classification: PARTIAL; status: **INVESTIGATING**; phase:E; priority:P2.

Root cause: Paths/top files and commit IDs do not preserve validated decisions and failure causality as retrievable knowledge.

Required implementation: Separate project facts, decisions and source citations from task journal; invalidate on relevant changes.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Yesterday task resumes with cited decisions and failed approaches; changed source invalidates stale facts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-026 — Cross-device sync, deletion and conflict handling lack live device evidence

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:E; priority:P1.

Root cause: Browser crypto/storage code and tests do not establish device retention or long-term deletion guarantees.

Required implementation: Specify retention and tombstone expiry; test concurrent offline edits, device restore and deletion propagation.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Two devices offline/online do not resurrect deleted chat; export and erase prove server/local removal within declared retention.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-027 — No general semantic task-context compaction service

Classification: PARTIAL; status: **INVESTIGATING**; phase:E; priority:P2.

Root cause: Context assembly is distributed across code paths with size limits.

Required implementation: Use evidence-aware summarization retaining goal, constraints, unresolved subgoals, receipts and retrieval IDs.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Long task exceeds context size then resumes with every constraint intact and no repeated failed strategy.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-028 — General web search and research are absent beyond curated documentation

Classification: MISSING; status: **INVESTIGATING**; phase:F; priority:P1.

Root cause: Allowed search APIs are MDN, npm and ReadTheDocs, not broad current-information research.

Required implementation: Add optional free-first search adapter with dated citations, source access receipts and explicit unavailable outcomes.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Five held-out research tasks cite fetched sources and distinguish inaccessible or conflicting evidence.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-029 — No agent-controlled browser session tools

Classification: MISSING; status: **INVESTIGATING**; phase:F; priority:P1.

Root cause: HTTP docs fetch and UI Playwright tests are not an autonomous browser capability.

Required implementation: Optional isolated Playwright/browser worker with per-domain grants, screenshot/DOM observations and approval-bound submit actions.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Navigate dynamic fixture, log in with delegated test credentials, extract data, stop before unauthorized external submit.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-030 — Document and spreadsheet workflows lack purpose-built adapters

Classification: MISSING; status: **INVESTIGATING**; phase:F; priority:P1.

Root cause: Attachments and generated source are not tested PDF/DOCX/XLSX operations.

Required implementation: Add sandbox file/artifact adapters, table parsing and deterministic output verification.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Round-trip fixtures preserve formulas, sheets, document structure and produce downloadable artifacts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-031 — General MCP/external connector runtime not found

Classification: MISSING; status: **INVESTIGATING**; phase:F; priority:P2.

Root cause: Integrations are bespoke; no discovered MCP lifecycle or permission registry.

Required implementation: Implement optional connector adapter with scoped grants, schemas, secret isolation and receipts; avoid mandatory service cost.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: One local fake MCP server supports discovery/call/cancel with denied tools never invoked.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-032 — Desktop/local-device execution is not an implemented agent surface

Classification: MISSING; status: **INVESTIGATING**; phase:G; priority:P2.

Root cause: Native app bridge is not a general desktop automation or local shell agent.

Required implementation: Optional signed local companion with explicit workspace/network grants; keep cloud-only use supported.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Local test workspace read/edit works; access outside approved root is refused and logged.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-033 — Sandbox language/dependency profiles are narrower than arbitrary projects

Classification: PARTIAL; status: **INVESTIGATING**; phase:C; priority:P2.

Root cause: Constrained Python/Node-oriented runners deliberately reject unsupported commands and installs.

Required implementation: Declare supported runtimes; add versioned image/profile adapters on demand with isolated installers.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Unsupported ecosystem identified before generation; supported pinned fixtures restore and test offline.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-034 — Real Docker isolation was not executed in this audit environment

Classification: UNVERIFIED; status: **BLOCKED**; phase:C; priority:P1.

Root cause: No local Docker daemon/client evidence; existing production receipts prove tests ran but not hostile escape resistance.

Required implementation: Run sandbox-selftest in disposable approved runner and adversarial network/env/host filesystem tests.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: No secrets, Docker socket, host files or network visible to test commands; time/memory/process limits enforced.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Docker CLI/daemon unavailable in this environment; real isolation test must run on supported disposable runner.

## KF-AUDIT-035 — Generated workflow proposals can execute before owner merge review

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P0.

Root cause: Draft status and no-auto-merge do not stop branch/workflow_dispatch execution with repository secrets.

Required implementation: Separate trusted orchestrator from candidate workflows; forbid secret-bearing execution from candidate refs until explicit workflow approval; use least-privilege installation tokens.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Malicious draft workflow attempting secret exfiltration never receives secrets or privileged token before explicit gate.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-036 — Persisted preferences contain historical authority broader than current owner policy

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Versioned natural-language instructions can outlive task-specific authorization.

Required implementation: Treat repository prose as untrusted preferences only; exact expiring grants in control plane govern consequential actions.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Historical auto-merge text cannot authorize a new task; policy contradictions surface as diagnostics.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-037 — Shared bearer credential persists in browser localStorage

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: Single-owner simplicity increases impact of browser script compromise/device extraction.

Required implementation: Use short-lived session credentials and secure native storage or HttpOnly session where feasible; device revocation and strong CSP.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Revoked device token fails; injected script cannot read long-lived privileged credential in browser test.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-038 — Prompt-injection defense not independently adversarially validated

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:H; priority:P1.

Root cause: Prompt warnings plus path guards do not demonstrate resistance across model output and privileged GitHub operations.

Required implementation: Add adversarial fixture corpus for repo docs, comments, web pages and test output with controller-side authority checks.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Zero unauthorized writes, paid calls, merge/deploy or secret disclosures in the security benchmark and fuzz cases.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-039 — Deployed secret scopes, branch protections and environment gates unavailable

Classification: UNVERIFIED; status: **BLOCKED**; phase:A; priority:P1.

Root cause: Workflow declarations do not establish actual PAT scope or production environment approval settings.

Required implementation: Collect read-only sanitized permission inventory and enforce environment approvals before deploy/release.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Owner verifies least privileges and deployment gate rejects unapproved release; audit record contains no values.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Current GitHub environment protections and actual credential scopes require read-only access evidence.

## KF-AUDIT-040 — Cancellation races across running tools and publication need proof

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:C; priority:P2.

Root cause: Checks exist but end-to-end cancellation during each side effect was not executed.

Required implementation: Use cancellation epoch on every tool/publish claim and actively terminate child sandbox execution.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Cancel at model wait, patch, test, push and dispatch boundaries; no later consequential action starts.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-041 — Retention and privacy boundaries differ across vault, issue journals and provider prompts

Classification: PARTIAL; status: **INVESTIGATING**; phase:E; priority:P2.

Root cause: Encrypted chat backup does not encrypt GitHub task evidence or provider-bound source.

Required implementation: Publish data-flow policy and per-tool redaction/retention controls; prohibit private context in public issues.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Privacy fixtures verify secret redaction and correct private-code provider restrictions; deletion procedure covers every store.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-042 — Task state can remain testing after runner has finished with incomplete review

Classification: BROKEN; status: **INVESTIGATING**; phase:A; priority:P1.

Root cause: No canonical terminal reconciliation updates every projection.

Required implementation: Finalize durable objective state even on review block, then publish UI projection with sequence and heartbeat.

Dependencies: KF-AUDIT-003

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: #330 replay ends blocked_verification with accurate finished time and resume action; no indefinite active timer.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-043 — Native composer keyboard failure remains open

Classification: PARTIAL; status: **BLOCKED**; phase:F; priority:P1.

Root cause: Existing layout test failed; no root cause confirmed in this audit.

Required implementation: Inspect native simulator artifact and bridge/layout geometry; repair without weakening keyboard assertions.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Same device/orientation reproducer passes composer-above-keyboard assertion and four other existing UI tests.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: macOS simulator/physical iPhone unavailable; fixture/source repair requires actual geometry evidence.

## KF-AUDIT-044 — Task progress is polling-based with freshness limits

Classification: PARTIAL; status: **INVESTIGATING**; phase:C; priority:P2.

Root cause: Progress comments and frontend timing can diverge after delays/offline periods.

Required implementation: Backend event sequence, heartbeat and terminal reconciliation; optional SSE transport, polling fallback.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Out-of-order/duplicate events never regress state; offline reconnect reflects terminal backend state within 15 seconds.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-045 — UI implementation relies on classic-script shared globals and mirrored bundles

Classification: PARTIAL; status: **INVESTIGATING**; phase:G; priority:P2.

Root cause: Load-order dependencies and generated copies increase integration risk.

Required implementation: Gradually introduce explicit modules/state contracts while preserving shared bundle checks.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Web/iOS generated assets match; initialization-order and restored-session tests pass after each module migration.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-046 — Apple-style refinement and real-device accessibility not assessed

Classification: UNVERIFIED; status: **BLOCKED**; phase:H; priority:P3.

Root cause: No interactive device session or visual/accessibility execution in this audit.

Required implementation: Run existing browser suite and targeted real-device keyboard, touch, VoiceOver and offline checks.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Document screenshots and accessibility results for agreed device sizes with no critical interaction blockers.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Real-device visual/accessibility session unavailable.

## KF-AUDIT-047 — No measured general-purpose 50-task autonomy benchmark

Classification: MISSING; status: **INVESTIGATING**; phase:H; priority:P1.

Root cause: Unit counts and prior simulation passes are not independent broad workload outcomes.

Required implementation: Implement the 50-task protocol in report 08 with hidden acceptance and task-level receipts.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: All tasks have actual results or unsupported outcomes; aggregate metrics computed from raw records.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-048 — Local passing suites leave important integrations skipped

Classification: PARTIAL; status: **INVESTIGATING**; phase:H; priority:P2.

Root cause: Optional infrastructure checks are not exercised by the local suite.

Required implementation: Report skips by capability; require dedicated integration gates with available infrastructure.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Critical integration gate cannot pass when all real runtime tests are skipped.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-049 — Dependency-map freshness is warning-only in CI

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P2.

Root cause: Stale context index may ship even when code imports change.

Required implementation: Generate deterministically and make freshness a required check or serve on-demand versioned index.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Import change without regenerated index fails check; index carries matching SHA.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-050 — Production SLOs, incidents and long-window objective success unavailable

Classification: UNVERIFIED; status: **BLOCKED**; phase:H; priority:P1.

Root cause: Workflow status cannot measure task completion, latency, availability or false success.

Required implementation: Instrument task objective outcomes, route health, queue latency, recoveries, false-success audits and versioned SLO reports.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: 30-day report has denominators, exclusions and incident causes; objective success is separately reported from run success.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: 30-day production SLO data unavailable; instrumentation can be implemented.

## KF-AUDIT-051 — Current browser/Worker runtime and native build not fully executed locally

Classification: UNVERIFIED; status: **BLOCKED**; phase:H; priority:P2.

Root cause: Syntax and dry-run do not establish interactive or runtime behavior.

Required implementation: Execute existing workerd recovery check, Chromium/WebKit and macOS native suite in isolated CI.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Exact-head receipts include browser, runtime and native results with artifact hashes and skips.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Browser/workerd/native runtime coverage must be collected separately.

## KF-AUDIT-052 — Deployed Worker SHA and dashboard-managed policy not independently matched

Classification: UNVERIFIED; status: **BLOCKED**; phase:A; priority:P1.

Root cause: Engine main SHA is known, deployed Worker version/config fingerprint is not.

Required implementation: Return build SHA and redacted effective policy hash in authenticated health responses; archive deploy receipt.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: A task receipt identifies engine, Worker, policy and candidate versions end to end.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Deployed Worker SHA and policy fingerprint unavailable.

## KF-AUDIT-053 — Push-to-main deployment couples code acceptance to production rollout

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P2.

Root cause: Main merges can deploy Worker without an independently confirmed owner deployment decision unless environment gates enforce it.

Required implementation: Require explicit release authorization or protected environment approval with exact artifact digest; keep dry-run CI separate.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Merge alone cannot deploy/release under current owner policy; approved exact build can roll back to prior version.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-054 — Background autonomy is constrained by Actions and expiring task authority

Classification: PARTIAL; status: **INVESTIGATING**; phase:G; priority:P2.

Root cause: Actions scheduling and finite grants are not a general durable calendar/reminder service.

Required implementation: Expose supported schedules and expiry; optional DO alarm/queue coordinator with idempotent leases and owner-approved job scope.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: A scheduled test job survives coordinator restart; expired authorization blocks side effects and asks renewal once.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-055 — Limited stage parallelism is not independent multi-agent execution

Classification: PARTIAL; status: **INVESTIGATING**; phase:G; priority:P2.

Root cause: Disjoint-file waves alone do not prove workspace isolation, semantic conflict resolution or aggregate budget safety.

Required implementation: Keep serial default; permit optional isolated researcher/test/reviewer workers with explicit read/write sets and reconciliation.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Parallel independent fixtures reconcile cleanly; overlapping edits serialize; one child failure cannot corrupt parent state.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-056 — README presents obsolete capability and permission restrictions as current

Classification: BROKEN; status: **INVESTIGATING**; phase:A; priority:P2.

Root cause: Append-only milestone documentation contains mutually incompatible descriptions.

Required implementation: Publish one versioned current capability table and move historical release descriptions to history.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Every current capability links to implementation and exact validation; unsupported claims are visibly labeled.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-057 — All historical branches and PR descriptions not exhaustively inspected

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:H; priority:P2.

Root cause: Large retained development history exceeds the inspected active surfaces; unassociated branches may contain material work.

Required implementation: Triage branch ancestry and last commit date, classify owner-active branches, inspect material divergences and archived PR context.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Every active divergent branch has owner/status, changed components and effect on audit; stale branches clearly excluded.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-058 — Task #330 test omits assertion for a required invalid key type

Classification: PARTIAL; status: **INVESTIGATING**; phase:A; priority:P2.

Root cause: Fixture includes key 123 but assertions only check string keys.

Required implementation: Add direct assertion against retained prior/totals keys and negative controls for each required invalid type.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Mutation that accepts non-string keys makes the new test fail while real implementation passes.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-059 — Multimodal understanding/output coverage is not demonstrated

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:F; priority:P2.

Root cause: Voice/media transport is not evidence of document/image reasoning across active free models.

Required implementation: Define supported MIME/capability routes and fixture-based grounding tests; reject unsupported formats accurately.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Image/audio fixtures yield verified grounded outputs on allowed models or explicit unsupported state without fabricated inspection.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-060 — Duplicated recovery and authority surfaces increase change risk

Classification: PARTIAL; status: **INVESTIGATING**; phase:B; priority:P2.

Root cause: Cross-language twins and legacy/current paths require synchronized contracts.

Required implementation: Keep platform adapters but share schemas, conformance fixtures and one transition/receipt specification.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Same adversarial and transition corpus yields equivalent decisions in Python, Worker and frontend.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

## KF-AUDIT-061 — Sample contains failed/cancelled runs but broad recovered outcomes are not independently graded

Classification: UNVERIFIED; status: **INVESTIGATING**; phase:H; priority:P2.

Root cause: Survivorship avoided in selection, but status-only records cannot prove task-level recovery or intervention counts.

Required implementation: Grade sampled objectives against immutable requests/artifacts; include tasks without PRs and all retry chains.

Dependencies: Foundation contracts

Branch: remediation/program; PR: not yet created.

Latest-state reconciliation: Current origin/main matches audit baseline 19c9592. No post-audit product fix is present; pending331 is test-only and unmerged.

Implementation: No fix claimed yet.

Required acceptance/tests: Random task sample reports first-attempt/recovery/human intervention with task denominator and missing-evidence count.

Actual results: Not measured for this remediation.

Regression coverage: Not yet added.

Final verification evidence: Not yet collected.

Remaining limitations: Acceptance and integration remain pending.

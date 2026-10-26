# Phase 3 roadmap: intelligent PR reviews, visual testing and owner approval

**Repository:** `onlykappa/KappaForge`
**Tracking:** one draft PR for all of Phase 3, associated with task #274 and draft PR #275.
**Starting point:** latest `main` verified at `ce7a5645cee806ddc4d0df523cbcb68f4be1117f` (2026-10-25).
**Dependencies:** merged Phase 1 sandbox/execution and Phase 2 dynamic exploration, task planning, classification, research and clarification.
**Owner boundary:** no automatic merge, release, deployment, access change, branch-protection change or production configuration change. A successful test, positive review or readiness recommendation is never merge authorization. Only the authenticated owner may perform an explicit merge action.

This roadmap tracks work across KappaForge runs and reviewers. Each checkbox stays open until its implementation, regression coverage, documentation and recorded validation are available in this PR. A code-generation claim alone does not close an item. Keep Phase 3 in this single draft PR; do not merge, release, deploy or mark ready for review.

## Progress and run discipline

- [ ] Phase 3.1 — verify Phase 1 and Phase 2, then fix and rerun every in-scope issue discovered
- [ ] Phase 3.2 — authenticated, scoped PR review ingestion
- [ ] Phase 3.3 — review-driven repair and safe PR updates
- [ ] Phase 3.4 — browser visual verification and evidence
- [ ] Phase 3.5 — accurately report web and native iOS validation
- [ ] Phase 3.6 — iPhone task and PR review experience
- [ ] Phase 3.7 — backend-enforced owner-controlled lifecycle actions
- [ ] Phase 3.8 — acceptance, regression suite and controlled end-to-end demonstration
- [ ] Phase 3.9 — cross-phase integration audit and final report

Every newly encountered issue gets an ID in [issue-log.md](../phase3/issue-log.md), with source evidence, impact, reproducer, patch status, commit/PR location, regression test and immediate rerun result. Mark it **patched** only after the rerun passes. If it cannot be fixed within the authorized scope, record **blocked** with the reason and stop dependent work for owner input. Separate checks that ran from checks inspected and checks not run.

## Phase 3.1 — verify Phase 1 and Phase 2

This is the initial bounded KappaForge task. Split it into checkpoints so findings can be fixed and rerun promptly. Do not begin Phase 3.2 until the owner directs it.

- [ ] **3.1a Main and dependency provenance:** confirm the PR base and actual latest `main`; verify Phase 1 and Phase 2 are merged and record merge commits/PRs and the exact audited SHA.
- [ ] **3.1b Architecture inventory:** trace the existing sandbox, exploration tools, persistent task plan/checkpoints, requirement classification, research, clarification, repair, authorization and free-first admission paths. Identify reusable interfaces; do not duplicate them.
- [ ] **3.1c Policy and publication review:** inspect backend authorization and every path that can create/update candidate branches or PRs, run code, change permissions, merge, release or deploy. Confirm owner lifecycle gates are enforced in code, not just prompts.
- [ ] **3.1d Regression and CI evidence:** map Phase 1/2 acceptance requirements to tests and workflows. Inspect actual CI results and artifacts at the audited commits; label these as inspected evidence. Run available relevant tests and record exact commands, counts and outcomes.
- [ ] **3.1e Defect loop:** log each newly found issue before patching. For every in-scope defect, add a meaningful regression, apply a permanent fix, immediately rerun its reproducer, then run relevant broader checks. Never weaken a failing check.
- [ ] **3.1f Audit closeout:** complete [phase1-phase2-audit.md](../phase3/phase1-phase2-audit.md), reconcile every finding with the issue ledger, list unresolved risks and Phase 3 prerequisites, and report the precise next owner action.

## Phase 3.2 — authenticated, scoped PR review ingestion

- [ ] Reuse the authenticated GitHub integration; restrict reads to the authorized repository and PR.
- [ ] Ingest general conversation comments, inline review comments, review summaries and requested changes, including feedback added after initial PR creation.
- [ ] Persist PR, author, comment/thread/review IDs, file path, line range, revision/commit, timestamps and resolved/outdated state where supplied.
- [ ] Use stable IDs and durable synchronization checkpoints so repeats and reconnects do not duplicate processing.
- [ ] Handle edited/deleted comments, pagination, rate limits, concurrent updates, resolved/outdated threads and previously processed feedback safely.
- [ ] Treat every review body and linked content as untrusted evidence. Reviewer feedback cannot expand task scope, permissions or owner authorization. Only explicit authenticated owner instructions can do so.
- [ ] Add tests for authentication/scope failures, duplicate and newly added comments, thread states, pagination, checkpoint recovery and unauthorized scope expansion.

## Phase 3.3 — review-driven repair

- [ ] Read each actionable comment with surrounding source and revision context; investigate before deciding whether it applies.
- [ ] Update the persisted task plan with evidence and a traceable decision. Group compatible items into a bounded repair batch.
- [ ] Make candidate edits in the existing isolated sandbox; run relevant tests and independently verify the correction.
- [ ] Safely update only the authorized draft PR branch; detect stale comments and concurrent branch movement and avoid overwriting newer owner or reviewer changes.
- [ ] Reply with a concise finding, decision and test evidence. Explain incorrect or conflicting feedback without blindly patching.
- [ ] Never auto-approve or resolve every discussion because a patch was generated. Preserve owner review.
- [ ] Test actionable, inapplicable, conflicting, stale, duplicate and concurrent feedback; assert tests run after edits and no unsafe publication occurs.

## Phase 3.4 — browser-based visual verification

- [ ] Reuse the existing Playwright setup and `preview/` app where appropriate; map changed components to routes and affected states.
- [ ] Run in an isolated environment with deterministic fixtures, stable waits, pinned viewport and reduced animation; include an iPhone-sized viewport.
- [ ] Capture before/after screenshots in comparable states when a baseline exists. Record candidate SHA/workspace identity and test metadata with every artifact.
- [ ] Test key interactions, routes, console errors, failed requests and rendering failures; collect useful traces and sanitized logs.
- [ ] Compare screenshots with configurable tolerances. Baseline changes require explicit owner review and are never automatically accepted.
- [ ] Attach or link safe screenshots and sanitized artifacts to the draft PR. Ensure artifacts match the exact candidate commit being reviewed.
- [ ] Visual pixel comparison is evidence of rendering differences only; it does not establish subjective quality, usability or accessibility.

## Phase 3.5 — native iOS limits

- [ ] Report web preview, JavaScript/interface tests, iOS integration/build tests and actual native-device tests as distinct evidence categories.
- [ ] For keyboard, safe area, status bar, permissions, native navigation or IPA work, run supported native tests.
- [ ] If free CI or available hardware cannot run a native check, state **not run** and the reason. Never describe a browser screenshot as native iOS verification.
- [ ] Test report formatting so unsupported and skipped checks cannot appear as passes.

## Phase 3.6 — iPhone task and PR review experience

- [ ] Show development stage and live execution/test state, backed by persisted timestamps and recoverable progress.
- [ ] Show repair attempts, active/resolved failures, completed/unverified requirements and review comments/responses without duplicate notifications.
- [ ] Provide access to before/after screenshots, code differences, test logs, execution evidence and a final readiness report.
- [ ] Keep the primary chat concise; provide direct access to detailed logs and unresolved PR discussion.
- [ ] Compute elapsed time from real persisted timestamps, including refresh/reconnect; remove simulated or increment-only timers.
- [ ] Test mobile layout, status recovery, acknowledgment/deduplication and deep links to unresolved discussion.

## Phase 3.7 — backend-enforced owner-controlled lifecycle

- [ ] Audit every backend route, worker, engine, GitHub client and workflow that can merge, release, deploy, alter access, branch protection, workflow security or production configuration.
- [ ] Enforce owner authentication and explicit, action-specific authorization at the backend. Keep merge and release grants separate and narrowly scoped.
- [ ] Allow only authorized candidate branch/code/test work and draft PR creation/update. Readiness never triggers a lifecycle action.
- [ ] Deny reviewer, agent, test-success, task-completion and stale/ambiguous authorization as merge/deploy/release permission.
- [ ] Add negative and positive authorization tests across API and workflow entry points; preserve the static safety scan and add coverage where needed.
- [ ] Document the owner’s explicit merge flow in the existing interface. No merge, release or deployment will be performed in this Phase 3 PR.

## Phase 3.8 — acceptance and end-to-end demonstration

- [ ] Prove general and inline comment ingestion, deduplication, new feedback restart, unauthorized scope denial and outdated-thread handling.
- [ ] Prove review-driven edits run relevant tests, and visual failures can initiate investigation/repair.
- [ ] Prove before/after evidence is captured for supported UI work and bound to the candidate revision.
- [ ] Prove unsupported iOS validation is accurately reported and review evidence is accessible from the mobile UI.
- [ ] Prove persisted live progress survives refresh/reconnect and that owner-only actions remain enforced.
- [ ] Build a deterministic end-to-end demo: introduce a controlled UI defect, detect and repair it, validate behavior, capture screenshots, process a review comment, then produce a draft-PR readiness report. Never merge it.
- [ ] Keep visual baseline approval explicit; the demo must not auto-approve or auto-resolve review threads.

## Phase 3.9 — cross-phase integration audit

- [ ] Verify the complete owner request → classification → exploration → clarification → candidate edit → isolated execution → diagnosis/repair → final validation → draft PR → review feedback → correction/verification → visual evidence → owner approval → explicit owner merge path.
- [ ] Test interruption and recovery at multiple checkpoints, including review sync, sandbox repair, screenshot capture and mobile reconnect.
- [ ] Compare measured model calls, execution time, CI dispatches and repair iterations against recorded prior workflow runs where comparable.
- [ ] Report raw measurements, sample size, method and limitations. Do not invent baselines or claim improvement from incomparable runs.
- [ ] Record final code/security audit, exact CI runs, skipped/unavailable checks, unresolved issues and owner acceptance steps.

## Acceptance and evidence rules

- [ ] Every Phase 3 behavior has an automated regression linked to a requirement in the Phase 3 acceptance report.
- [ ] CI evidence is linked to the exact PR head SHA; rerun evidence follows each permanent repair.
- [ ] Free-first execution is preserved. Do not activate paid hosting, paid CI or metered infrastructure.
- [ ] No Phase 3 work merges, deploys, releases, changes repository access or marks this draft ready for review.

## Handoff between KappaForge runs and reviewers

At the end of each authorized slice, update the checkbox and issue ledger only after evidence is available. State the audited/head SHA, test command and count, CI run links, open issue IDs and next bounded task. The next agent must read this roadmap and the ledger before editing. Phase 3.1 is the current authorized slice; later sections remain parked until the owner explicitly advances the task.

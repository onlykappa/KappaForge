# Direct Phase 3 delivery

The owner switched implementation to direct Codex work on 2026-10-29. Run40970125368 was cancelled and control319 was closed. No autonomous coding worker or scheduled progress watch is started by this delivery. Original314/315 checkpoints, failed proposals, counters and immutable candidates are retained; this implementation does not complete315's historical machine record.

All changes remain in draft312. Main, frozen delivery bases and candidate PR320 remain unchanged. No merge, deployment, release, readiness action, provider setting or task limit is changed.

## Implemented interfaces

| Area | Behavior and validation |
| --- | --- |
| 3.2 ingestion | Journal.ingest_reviews joins complete REST inventories with authenticated GraphQL thread and nested-comment pagination. It records stable identities, revisions, provenance and actual resolved/outdated state. GraphQL POST is admitted only within the exact controller-selected read; arbitrary queries and lifecycle mutations remain denied. |
| 3.2 recovery | Two complete stable scans precede atomic inbox persistence. Malformed/partial/duplicate inventories, head/scope changes, rate limits, cancellation and interrupted writes retain the old snapshot. Existing source and durable-write failure tests remain enforced. |
| 3.3 decisions | review_repair.prepare investigates feedback against current source and the original owner goal through the existing independent finding verifier. Decisions and evidence are stored in hashed journal blobs; duplicates reuse decisions, edited feedback gets a new identity, and unresolved decisions remain pending. Stale, resolved, deleted, oversized and out-of-scope observations cannot start edits. |
| 3.3 correction | An existing authorized Fix may process confirmed feedback even when previous checks pass. Feedback is never owner guidance. The existing sandbox/full-final regression, original-requirement review, fast-forward publication and owner scope remain mandatory. The actual defect is independently rechecked after edits; changed feedback/head or a no-op correction blocks publication. |
| 3.3 reporting | Bot-owned stable reply receipts prevent duplicate reports, including recovery after an ambiguous POST. A published correction is reported with its candidate and pending independent checks; no thread is automatically resolved or approved. |
| 3.4 browser evidence | The existing Playwright regression matrix captures desktop and390px phone states, screenshots, traces, bounded diagnostics and a source/workspace manifest. Web CI checks out the PR head explicitly. Comparison references are read-only, tolerances are validated, differences fail the check, and no baseline approval/update operation exists. |
| 3.4 repair signal | browser_build observes only the exact candidate/branch's browser job. A completed browser failure can enter the existing isolated repair path for UI work. It cannot authorize a new worker, broaden the task or bypass its expiry. |
| 3.5 evidence categories | Review responses/cards distinguish browser interactions, pixel comparison, iOS simulator and physical-device execution. Skipped/neutral checks cannot supply a passing test receipt. A successful no-tests workflow is displayed as tests not run, retaining the existing explicit-owner manual-review policy for such external projects. |
| 3.6 owner review | Dashboard and Reviews use one detailed development-PR card. Feedback is escaped, discussion/artifact links are restricted to the owned GitHub namespace, and screenshots/traces/source identity are reachable on phones. Existing persisted progress, elapsed-time, refresh/reconnect, task acknowledgment and deduplication suites remain. |
| 3.7 lifecycle | No new lifecycle operation is introduced. App merges additionally require the exact candidate's browser job to pass before any readiness/merge mutation. Owner authentication, action-specific consent, expiry/replay, reviewed-head binding and independent sandbox/native gates remain. |

## Acceptance and inspection boundaries

tests/test_phase3_acceptance.py drives the real ingestion, source verifier, repair controller, final regression and draft publisher against a controlled HTML button defect and an injected GitHub transport. It asserts no code publication before validation, retains original tests and confirms no lifecycle mutation. The local Docker boundary is explicitly simulated; a separate class runs the actual fixture tests in real Docker on the standard GitHub sandbox runner. No live model or real GitHub publication is used by this test.

The browser matrix exercises actual owner review controls, phone layout, escaped feedback and native/not-run wording. A controlled DOM perturbation is compared against its original and restored screenshots. This proves pixel detection/recovery, not subjective design quality or baseline approval.

The combined demonstration exports the same source-repair/test/decision receipts to tools/phase3-visual-demo.cjs. It renders the actual before/after HTML with page JavaScript disabled and remote requests blocked, detects the original color defect against the explicit fixture contract, verifies the source correction on desktop/phone, and produces a linked readiness report. Its source, review and draft-publication boundaries are deterministic fixtures, not live GitHub mutations or inference. CI refuses a simulated Docker export; the local explicit simulation reports realDocker=false. The screenshot utility decodes/compares pixels inside a separate browser context and returns only metrics, avoiding multi-megabyte pixel-array transport through Playwright. The source fixture's DOM snapshots are disabled; trace actions/screenshots and the exact HTML remain available. The app's ordinary browser traces retain DOM snapshots.

Physical iPhone testing is not available locally. Browser/WebKit captures cannot substitute for it; UI cards explicitly report not run. WebKit installation in the managed workspace returned a domain-policy403, so local browser runs use the installed Chromium with both desktop and phone viewports. Remote WebKit/native evidence must be read from the new commit's CI, never inherited from784b638.

This delivery does not implement review-triggered wakeups, authorize new tasks or reopen319. Scope/expiry checks apply to future engine use; revoked or exhausted historical grants are not reused for live acceptance.

## Evidence ledger

- Initial full Python discovery after ingestion/decision integration:1,388 run OK,32 skipped.
- Expanded source with browser observation and controlled draft publication:1,392 run OK,33 skipped (including the real-Docker acceptance class).
- Final full Python discovery including base-retarget and64-bit identity regressions:1,394 run OK,33 skipped. Final full Node/Worker run:910 passed, zero failures/skips. Ten structural rules, source scan (15 existing warnings, zero errors), web/bundle, dependency-map and free execution policy checks pass.
- Full Node/Worker run:910 passed, zero failures/skips before the final no-tests wording assertion; the final repeat is recorded with delivery.
- Desktop and phone-sized Chromium regression matrix passed after the shared Reviews-card correction. Controlled pixel experiments and exact-source remote CI are recorded separately after completion.
- Combined local simulated-source/Docker boundary plus actual Chromium rendering passed for desktop and phone: original visual defect detected, corrected source matches the explicit contract, zero lifecycle mutations and no baseline approval. Real Docker/native/WebKit proof remains a remote CI requirement.
- A read-only live GraphQL request against312 validated the actual query schema (zero inline threads on that PR, not live task ingestion). GitHub introspection confirmed fullDatabaseId is BigInt while databaseId is deprecated Int. The64-bit regression and base-retargeting regression failed before their corrections;39 final review-focused tests passed with one real-Docker skip.
- Ten structural rules passed. The source scan's new child-process error was corrected by keeping Git identity execution in the trusted test harness; visual capture executes no commands. No rule, assertion or safety check was weakened.
- Required baseline Node tests and scripts/check-web.py passed. The reviewed execution policy and dependency map are regenerated; no secret binding or workflow write permission is added. CI changes are an exact-head checkout, expanded artifact upload and a real-Docker Phase3 test step under existing read-only permissions.

The phase roadmap remains the completion authority. Implemented code and local passing tests are not a claim that all Phase3 acceptance, native verification or cross-phase audit work is complete.

## Retained autonomous outcome

After cancellation,315's authenticated checkpoint eb8d5b6c5784b64c698405476de289fde2ccf7d59c44c06ab29bf5df66293cae retained35 model calls,0 generation edits,3 tested versions and21 controller actions. Independent inspection of patch3a7354e122177fa7c840b1f98e2b8feb23339b0ab6070f83c74912a95de92eee found the same duplicate-insertion fixture, with comment ID999 replacing2, and redundant production parentheses. Its latest Python run still failed that test. No candidate PR/branch was published. This history remains evidence of a failed proposal, not a direct-delivery acceptance receipt.

## Native-reporting handoff (2026-10-30)

The native-reporting follow-up previously held only in the workspace is now included on fix/308-phase3-followups for another agent to continue. engine/native_evidence.py validates exact candidate identity and reconciled Xcode test counts; zero/all-skipped discovery cannot pass, and simulator success never establishes physical-device execution. scripts/native-evidence.py writes a normalized receipt and exits unsuccessfully for unknown, empty or failed evidence. ios-build.yml extracts the xcresulttool summary after successful test execution and uploads both raw and normalized evidence. The review card links the candidate's non-expired native evidence artifact. Generated web copies, dependency map and the reviewed workflow manifest are synchronized. No permissions, credentials or lifecycle authorization changed.

Validation: the focused native parser tests, review-card/artifact tests, required baseline Node suites, ten structural rules, source scan, web/bundle, workflow-policy and dependency-map checks pass. Full Python discovery: 1,398 tests run OK, 33 skipped. Required baseline Node/evidence suites: 288 passed; final focused review-card/artifact run: 10 passed. Native execution and the actual xcresulttool JSON schema still require this commit's macOS CI; synthetic parser fixtures are not native execution proof. Inspect those logs/artifacts before claiming delivered native counts.

Next agent: fetch this branch, inspect the native CI result and exact summary schema, then continue the remaining Phase 3 acceptance/lifecycle audit described above. The lifecycle workflow audit has not been implemented: existing main-push deployment/release behavior still needs review against action-specific owner authorization. Keep PR312 draft and unmerged; do not deploy, release, reopen319, restart KappaForge, reset counters or enable monitoring. This handoff is not a claim that task315 or all of Phase3 completed.

## Native CI result for 1ecd2f6 and follow-up

Native run 41064105732 failed: four of five simulator UI tests passed and `testComposerRemainsBelowHeaderWhenKeyboardOpens` failed its keyboard-geometry assertions, the intermittent failure already tracked as P3-092 (still open; the preceding head b0e6827 passed native). The new `xcresulttool`/receipt step never ran because the test command aborted the shell first, so no `native-validation-evidence` artifact exists for that run and the real summary schema is still unobserved. The workflow now records the test exit status, writes the receipt and uploads it even when tests fail, then exits with the test failure (or with a non-passing receipt). The count check also accepts Xcode's separate `expectedFailures` bucket. These changes are validated only locally (1,399 Python tests OK, 38 skipped here; manifest and dependency-map checks pass); the real summary format and receipt are not confirmed until native CI runs this commit. P3-092 is not fixed by this change.

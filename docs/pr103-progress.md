# PR103: Live task progress

Last updated: 2026-10-18 (native screenshot verification in progress)

## Scope and isolation
Base: `22871b42f36f4a13ba06c6f8e7a485229051cd47`; branch: `feat/pr103-live-task-progress`. Draft only. No merge or release. GitHub returned 404 for both PR and issue 102 at investigation time; do not alter any concurrent task.

## Acceptance and current status
- [x] Root cause verified and documented.
- [x] Durable structured progress model and real runner execution events.
- [x] Reference timeline, truthful progress bar, queued/active timers and findings.
- [x] Failure, retry, blocked, cancellation and stale states.
- [x] Reconnect, restart, bounded requests and concurrent-task isolation.
- [x] Native web bundle synchronized and simulator app compiled.
- [x] Local regression checks and latest CI unit/browser checks pass.
- [x] Browser screenshots inspected against reference; these are labeled fixture replays.
- [ ] Actual native simulator progress screenshots captured and inspected.
- [ ] Latest native UI tests/device build fully verified.
- [x] Runner-to-poll-to-render fixture evidence recorded.
- [ ] Production backend task end-to-end test. This draft is not deployed to main; no production task was dispatched against unmerged code.
- [x] Feature checkpoints and progress log committed to draft PR after each implemented feature.

## Investigation
Read KAPPA.md and owner preferences. Existing `engine/developer.py::Progress` edits one bot comment. `preview/app-tasks.js` polls issue comments and `preview/core.js` recognizes progress headings. Existing UI tests already expect timelines, staged bars and findings. Missing-card root cause not yet established. Investigate submission tracking and renderer before changing CSS.

## Evidence and limitations
Reference images inspected in conversation. Direct GitHub git clone is unavailable in this environment; authenticated connector reads work. Source is being materialized through that connector. No tests or native build claimed yet.

## Checkpoints
Initial progress log only. Implementation pending.

## Resume
Finish source retrieval, inspect `preview/ui.js` renderTaskActivity, task submission in app-main.js and agent-work.js, and establish baseline tests. Add structured progress with compatibility for existing comments, then save each verified feature with this log.

## Feature 1 checkpoint: persisted client progress and launch visibility
Status: implemented; focused regression verification passed. Actual draft PR number is **102**, assigned by GitHub; PR/issue 102 did not exist before creation. Requested branch/log names retain pr103.

Verified causes: (1) `launchJob` previously saved a tracking record but inserted no progress message until a bot report arrived; (2) `runChatAction` ignored a false planner result, leaving the model's plan without an execution error; (3) comments were read only from the first 100 entries; (4) old progress comments were processed before retry timestamp checks; (5) task polling used a dashboard helper that could silently return cached data on failed refresh; (6) the 10-second timer cleared a failed request's backoff. All are corrected in the client checkpoint.

Changed: preview/task-progress.js, app-tasks.js, ui.js, design.css, index.html and generated native counterparts; tests/task-progress.test.mjs and tests/task-tracking.test.mjs. Versioned snapshots reject duplicate/delayed revisions and mismatched identities; queued/active timing is timestamp-based. Cards begin at confirmed dispatch and remain in the initiating chat. Live reference renderer implemented, awaiting browser screenshot validation.

Validation: 20 focused Node tests passed (task-progress, task-tracking, chat-activity-ui, task-autostart). `python scripts/check-web.py` passed syntax/configuration/bundle checks. Initial local source materialization added an extra terminal newline; corrected to exact baseline bytes before checks. No production end-to-end or native simulator claim.

Next: emit structured snapshots from real Python Progress transitions; add runner event tests, terminal state timing and stale indicators; run full baseline suite and mobile browser tests. Baseline Python suite output is being reviewed separately.


## Feature 2 checkpoint: real runner execution snapshots
Status: implemented and focused contract checks passed. `engine/developer.py::Progress` now publishes versioned JSON snapshots inside its existing edited bot comment. Actual transitions carry stable executed-step IDs, stable pending IDs, per-attempt identity, monotonic revisions, start/end timestamps, explicit failure and testing status, and measured implementation-stage units. Human-readable checklist compatibility is preserved. Raw model design reasoning is no longer copied into the live progress feed. Failed dispatch is blocked, not reported as completed.

Verification: 44 existing developer tests and 3 new runner wire-contract tests passed; 20 focused frontend tests and scripts/check-web.py passed. Snapshot tests verify real Progress calls, failure time freezing, JSON escaping, stable IDs and revision order. Terminal client timing now freezes on test/terminal lifecycle events.

Feature 1 remote commit: `6ee18ff789dd346a1e0e42ab86f764a18782c764`. Feature 2 commit is the commit containing this checkpoint.

Next: review all full-suite results after exact baseline restoration, exercise the real UI in an available browser, add structured-card assertions and connection isolation coverage, and document native/production integration limits. Browser preflight: runtime Playwright exists but its default Chromium and WebKit binaries are absent. Locate an installed browser before attempting screenshots.

## Feature 3 checkpoint: concurrent recovery and lifecycle verification
Status: implemented; 23 focused client tests and 138 required Node/intelligence tests pass locally after regenerating the native bundle. Existing test harnesses were updated to load the new progress dependency.

Per-task polling now isolates failures and backoff, uses uncached authoritative reads for PR state, and preserves the newest lifecycle report against older progress updates. Finished and cancelled clocks stop; stale connections stop decorative activity animation. Resolved findings can display a Verified badge. Details expansion and reading position survive refresh.

Added browser replay coverage in tests/web-regression.cjs with a clearly labeled deterministic fixture generated through the real Python Progress writer (tests/fixtures/task-progress-events.py). This exercises GitHub-shaped comment polling, measured units, failure, collapse persistence and restart using the actual shared interface, and captures queued/running/middle/failed screenshots. It does not claim to be a live production task. Browser replay execution is pending CI because local browser binaries are unavailable and the download returned an invalid ZIP.

Remote feature 2 commit: `f7af9015054ae0f850d7248da17d9a43f546090f`. All 153 Python tests passed locally and GitHub's unit job passed. The previous web CI failed on a missing dependency in an old test VM; that harness is corrected in this checkpoint. Native CI reached simulator compilation after passing bundle and contract checks.

Next: inspect the latest CI web/native runs; retrieve screenshots and visually compare the reference; fix any observed browser or native regression; synchronize final acceptance status and exact remaining production verification limits. No merge or release.

## Feature 4 checkpoint: screenshot review and final timer fixes
Browser replay passed in desktop Chromium and mobile Safari on commit `997491c5b237843a4f869095bfab005188e2c260`: https://github.com/onlykappa/KappaForge/actions/runs/39163299803 . Retrieved artifact 12150180422 and inspected mobile progress-middle screenshot against the attached reference. Connected steps, purple current ring, green checkmarks, dark bordered cards, timestamp durations and measured purple bar render in the actual application. Fixture labels remain explicit. Split result titles and supporting detail to match the reference hierarchy more closely. Browser fixture now includes two labeled findings to verify the findings card alongside live progress.

Review fixes: failed independent-test reports freeze timers even while the task remains open for a retry; a later real running update unfreezes the task; final reports no longer retain queued semantics. The freshness ticker now pauses decorative activity when data becomes stale. New progress/tracking tests are imported by the standard intelligence test entrypoint, so CI cannot omit them. Dependency map regenerated.

Local final verification before this visual refinement: npm test 175/175 and required Node/intelligence suite 148/148 passed. Full Python suite 153/153 passed. check-web and dependency-map checks passed. Latest screenshot/detail refinements require the next CI run. Native run 39163299925 compiled simulator successfully and is running launch/keyboard tests; full native completion remains pending.

Next: verify final CI commit, inspect refreshed mobile findings screenshot and native build artifacts, update this log's acceptance checklist accurately. Draft only.

## Feature 5 checkpoint: native simulator screenshot scenarios
User requested actual simulator screenshots to review without installing another IPA. Added Debug-simulator-only ProgressFixture.swift and XCTest scenarios for queued, running (timeline/findings/bar), and failed states. These invoke the real persisted progress model, production renderer, WKWebView and native UITextView composer. They contain explicitly labeled deterministic data and do not start a development task. Release/iPhone builds cannot compile the fixture implementation. XCTest saves screenshots as retained attachments, exported by the existing iOS workflow.

Also retained findings across subsequent snapshots, avoided duplicate findings cards in task reports, and bounded each progress request with an abort timeout so a hung network request cannot block other tracked tasks indefinitely. Added behavioral coverage for persistence of findings and aborted reads.

Status: local web/configuration/bundle checks and npm tests passed; Swift compilation and actual simulator screenshots are pending the next native CI build. Do not claim the screenshots exist until XCTest and artifact retrieval succeed.

Next: wait for native CI, inspect any compile/test failure, download retained PR103 progress screenshot attachments, display actual images to the user, then synchronize final checklist.

## Verification candidate
Code candidate: `3aca42aa337248f9249d1eafc0c362b8c1d3686a`. Latest CI unit and browser jobs pass: https://github.com/onlykappa/KappaForge/actions/runs/39163713570 . Native screenshot build: https://github.com/onlykappa/KappaForge/actions/runs/39163713559 . It compiled the Debug simulator application including the new fixture and is running native UI tests. Local result: 178 Node tests and 153 Python tests pass. Native screenshot and full device packaging results are still pending.

## Native screenshot inspection follow-up
Native run 39163713559 passed simulator compilation and all three UI tests, including queued/running/failed screenshot scenarios. Retrieved artifact 12149822050 and inspected all three actual iPhone 16 Pro Max simulator captures. The running screenshot shows the reference timeline, severity findings with resolution status, determinate purple bar and native composer. Inspection exposed near-bottom auto-scroll pulling the card heading under the sticky header. Tightened the progress mutation observer threshold from 200px to 32px to avoid scrolling a reader who is above the bottom.

The screenshot fixture now identifies test data in the card title, uses the full available viewport, and exercises real keyboard show/dismiss before capture. Added a keyboard-open running capture. This is a visual verification refinement; all earlier screenshots remain actual native captures, not mockups. Updated candidate and refreshed screenshots remain pending the next CI run.

## Recapture candidate
`51d530626cb7ee28b876a17ff5aebf87a8ccb93a`: latest browser and unit jobs pass (run 39164348896). Native app compiled successfully and is running the expanded keyboard/screenshot UI scenarios (run 39164348877). Prior candidate 3aca42a completed the full native simulator/device build successfully, with release jobs skipped. No merge or release occurred.

## Final native visual corrections
Run 39164348877 passed the expanded native UI tests and exported four actual captures, including keyboard-open. Inspection showed the active card still being pulled beneath the sticky header by a second near-bottom threshold in captureInterfaceScroll (the mutation observer threshold had already been narrowed). Tightened the render-state threshold to the same 32px. The test fixture now suppresses live polling of the unrelated issue number used as test data; prior captures truthfully showed a reconnect warning from that fixture request, not a production execution failure.

Queued/failed native captures also exposed WebKit not painting the complete fixed composer on short chats. Promoted the whole composer to an isolated compositing layer; this keeps its border, controls and native input anchor together. This correction requires refreshed actual native images, not a claim of a passing screenshot from earlier code. Final code and screenshots are pending the next CI run.

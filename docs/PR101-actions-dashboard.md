# PR #101 handoff: live GitHub Actions dashboard

## Goal
Make the Dashboard a live view of GitHub Actions: current build status, latest
builds per workflow, and a run page that shows jobs, steps, durations, attempts,
annotations and parsed logs the way GitHub does. Updates are pushed from the
Worker over a streamed connection instead of the 90-second poll.

## Branch and commit
- Branch: `feat/pr101-actions-live-dashboard`
- Last pushed commit SHA: see the PR's commit list (this file is updated with each milestone).

## Plan and status
Status keys: `[x]` done and tested, `[~]` in progress, `[ ]` not started.

1. [x] **Actions service** (`chat-backend/src/actions.js`): list runs, run detail
   (jobs, steps, attempts, artifacts, annotations), job logs. Normalised fields only.
2. [x] **Shared rules** (`preview/actions-core.js`, imported by the Worker like
   `intent-guard.js`): normalisation, step progress, log parser, run reconciliation.
3. [x] **Log parser** (`engine/actions_log.py` + JS twin in `actions-core.js`):
   sections, `##[error]`/`::error` annotations, failure and success signals,
   "Step 2/5: Linting". Both are checked against the same fixtures in `tests/fixtures/actions-logs/`.
4. [x] **Credential scoping**: `/actions` Worker endpoint is read-only, repo
   allowlisted, integer ids only, strips signed/download URLs, redacts token-like
   strings in logs, prefers a read-only `GITHUB_ACTIONS_READ_TOKEN` secret.
5. [x] **Live bridge**: `/actions` `stream` op returns Server-Sent Events. The Worker
   polls GitHub with ETags (304s are free), emits only changes, ends after ~55s so the
   client reconnects. Client falls back to polling when streaming fails.
6. [x] **Workflow Monitor** (`preview/app-state.js`): holds runs, applies stream
   events, reconnects with backoff, caches last snapshot, drops ghost runs.
7. [x] **Status Card + run view** (`preview/ui.js`): status card with progress bar,
   run page with jobs, steps, durations, attempts, annotations, parsed log.
8. [x] **Dashboard view state** (`preview/app-dashboard.js`): overview ↔ run detail
   ↔ chat without losing conversation, composer draft or scroll.
9. [x] **Post-run verification** (`scripts/verify-actions-state.mjs`): compares a
   saved monitor snapshot against the GitHub API and reports stale/ghost/missing runs.
10. [x] Tests, `python scripts/bundle-web.py`, docs, deploy path filters.

### Round 2: match the GitHub mobile job screen (owner's screenshot)
11. [x] **Per-step logs**: the parser splits logs at "Run …" groups, "Post job cleanup." and "Complete job";
    each section keeps its last 150 lines (`log: [{n, text, kind}]`). `KappaActions.stepSections(steps, sections)`
    maps steps to sections (by order when counts match, else by name). Checked on the real
    "iOS build and release / native" job's step list (`tests/fixtures/actions-logs/ios-native-job.*`).
12. [x] **Re-run / Cancel**: `POST /actions/control` `{repo, runId, action: rerun|rerun-failed|cancel, confirmed}`.
    It is in `writePaths`, so it needs a confirmed owner authorization (`userAuthorizedFetch`), and uses `GITHUB_JOB_TOKEN`.
13. [x] **Three-level UI**: run page → job page ("Workflow / job", "Failed after 8m 5s", step rows with
    icon, monospace name, duration, chevron) → step log page; floating Re-run menu.
    `ui.js`: `ghHeader`, `ghRow`, `runView`, `jobView`, `stepView`, `rerunMenu`, `runSummary`.
    `app-dashboard.js`: `dashboardState.mode` is overview|run|job|step (+ `jobId`, `step`), `showDashboard`,
    `openJob`, `openStep`, `dashboardBack` (one level up), `runControl`. Browser smoke on a phone walked
    run → job → step → back, and Re-run went through `/authorize` then `/actions/control`.

### Round 3: live task progress in chat (owner's bug-audit mockup)
Why it did not look like the mockup: `renderTaskActivity` looked for stage lines ("Reading project files",
"Step 2 of 5") that the agent never wrote. The agent edits one "KappaForge is working on it" comment.
14. [x] **Agent checklist** (`engine/developer.py` `Progress`, `took`):
    - `✅ done · 24s`, `⏳ current · started 2026-10-18 18:02:11 UTC`, `❌ failed`, `◻ upcoming`;
    - `ahead=[…]` phases, advanced with `phase=True` in the develop and fix flows; nothing is promised after a failure.
15. [x] **Audit findings** (`engine/full_reader.py`): the prompt asks for `#### Findings` lines `- [High] title (path)`.
    `KappaJobs.conciseReport` keeps up to 40 finding lines.
16. [x] **Chat cards**:
    - `core.js`: `KappaJobs.progressSteps`, `stageProgress`, `findings`.
    - `ui.js`:
      - `renderTaskActivity` draws a timeline: check + time, glowing ring + live timer, grey upcoming, red ✕;
      - planned stages fold into one "Writing the change" row;
      - `stepSeconds`, `taskTimeline` and `elapsedSince` sit below `renderTaskActivity`; `findingsCard` draws "Issues found (N)".
    - `app-dashboard.js`: the one-second timer also runs in chat.
17. [x] **Guard**: `scripts/check-web.py` now fails when two preview scripts declare the same global name.
    It would have caught the bug the browser regression found here: `ui.js` `issuesCard` replaced the one in
    `settings.js`, so the Settings check never finished. Mine is named `findingsCard`.

## Tests performed
Baseline on `main` @ 6e80959: `python -m unittest discover -s tests` 145 OK,
`npm test` 137 pass, `python scripts/check-web.py` passed.

After this PR (local): `python -m unittest discover -s tests` 148 OK, `npm test` 154 pass,
`python scripts/check-web.py` passed, `python3 scripts/dependency-map.py --check` current.
`npm run test:web` desktop (Chromium) PASS locally; the CI WebKit pass also passed (see CI verification below).
Browser smoke (Chromium, 1280 and 390 wide, mocked `/actions` stream): overview, run page, parsed log,
no horizontal overflow, composer draft and run page kept across Chat ↔ Dashboard, no page errors.
Live checks against the real GitHub API: `scripts/verify-actions-state.mjs` passes a correct snapshot and
reports a real stale run, a confirmed ghost (404) and a missing run. The log parser was checked on a real
failed `iOS build and release` job log; that check added the XCTest `Test Case '…' failed` pattern.

### CI verification: passed (2026-10-18)
Verified against GitHub Actions for commit `fa4454a2141ad2fbd0c73527fb36d4bf6b13e211`, matching the owner's success screenshot.

- [x] [iOS build and release #148](https://github.com/onlykappa/KappaForge/actions/runs/39153838383): **success**.
  The `native` job passed in 8m 46s, including the native update contract, source/bundle verification,
  simulator build and bundled-launch verification, keyboard screenshot export, unsigned iPhone build,
  IPA package verification and artifact uploads.
- [x] [KappaForge tests #437](https://github.com/onlykappa/KappaForge/actions/runs/39153838355): **success**.
  Both `unit` and `web` jobs passed, including `npm test`, dependency-map validation and
  `npm run test:web` after installing Chromium and WebKit. The previously pending CI WebKit check is complete.
- The `release`, `agent-report` and `sandbox` jobs in run #148 were **skipped**, not failed.
  This records successful PR validation; it does not establish release publication or physical-device acceptance.

### Milestone log
- M4 (CI verification, 2026-10-18): iOS run #148 and test run #437 passed on `fa4454a`; native and WebKit verification are complete. Evidence is linked above.
- M1 (backend): `chat-backend/src/actions.js`, `preview/actions-core.js`, `engine/actions_log.py`,
  `/actions` route in `index.js`, fixtures + `tests/actions.test.mjs` + `tests/test_actions_log.py`.
  `/actions` body: `{op:"snapshot"|"run"|"log"|"stream", repo, runId?, jobId?, attempt?}`.
  Stream packets (`data:` JSON): `snapshot`, `runs` (`changed`, `removed`), `run` (detail), `ping`, `error`, `end`.

- M3: `scripts/verify-actions-state.mjs` (`verify`, `describe`, `--worker URL` with `KAPPA_ACCESS_TOKEN`),
  Dashboard → "Copy state for verification" exports the snapshot it checks. Refresh restarts the stream instead
  of racing it with a poll; a malformed poll answer never wipes the list. Docs: `chat-backend/README.md`, `KAPPA.md`.
- M2 (frontend): Workflow Monitor at the end of `preview/app-state.js` (`workflowMonitor`, `monitorApply`,
  `monitorStream`, `monitorPoll`, `monitorWatchRun`, `monitorRunDetail`, `monitorJobLog`, `monitorExport`);
  renderers at the end of `preview/ui.js` (`statusCard`, `runView`, `jobLogView`); dashboard state manager and
  Builds panel in `preview/app-dashboard.js` (`dashboardState`, `openRun`, `closeRun`, `buildsPanel`, `runPage`);
  `viewScroll` + `rememberScroll` in `app-state.js` keep chat and dashboard scroll; styles at the end of
  `preview/design.css`; tests in `tests/actions-ui.test.mjs`. The old dashboard "Agent activity" feed was replaced
  by the Builds panel; `refreshActivity` now feeds the monitor.

## Known issues
- Logs are only available after a job finishes (GitHub API limitation); the run view shows live step
  progress from the jobs API until then.
- Optional Worker secret `GITHUB_ACTIONS_READ_TOKEN` (fine-grained, Actions: read) is not configured yet;
  the Worker falls back to `GITHUB_JOB_TOKEN`.

## Next task
All planned implementation items, including round 3, and CI verification are complete.
PR #101 remains open and draft at this verification point. Merge/release and physical-device acceptance
remain separate steps; no release was published by PR run #148.

Possible follow-ups, not started: using `engine/actions_log.headline` in
`engine/developer.py` repair reports, and a live-build chip in the chat header.
Re-run / Cancel is already implemented and tested (item 12), so it is not an outstanding follow-up.

## Safety notes
No tokens or secrets are stored in this file, the PR, or the browser.

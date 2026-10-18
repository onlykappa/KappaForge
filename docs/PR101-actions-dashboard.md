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

## Tests performed
Baseline on `main` @ 6e80959: `python -m unittest discover -s tests` 145 OK,
`npm test` 137 pass, `python scripts/check-web.py` passed.

After this PR (local): `python -m unittest discover -s tests` 148 OK, `npm test` 154 pass,
`python scripts/check-web.py` passed, `python3 scripts/dependency-map.py --check` current.
`npm run test:web` desktop (Chromium) PASS; the mobile-Safari pass needs WebKit, which only CI installs.
Browser smoke (Chromium, 1280 and 390 wide, mocked `/actions` stream): overview, run page, parsed log,
no horizontal overflow, composer draft and run page kept across Chat ↔ Dashboard, no page errors.
Live checks against the real GitHub API: `scripts/verify-actions-state.mjs` passes a correct snapshot and
reports a real stale run, a confirmed ghost (404) and a missing run. The log parser was checked on a real
failed `iOS build and release` job log; that check added the XCTest `Test Case '…' failed` pattern.

### Milestone log
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
All planned items are done. Watch CI on the PR (the `web` job runs the WebKit pass that could not run locally).
Possible follow-ups, not started: a Re-run button (needs a write path through the authorized `/decisions`
flow), using `engine/actions_log.headline` in `engine/developer.py` repair reports, and a live-build chip in
the chat header.

## Safety notes
No tokens or secrets are stored in this file, the PR, or the browser.

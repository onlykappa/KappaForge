# Live task progress in chat, round 2 (follow-up to PR #101)

## Goal
Upgrade the chat's task progress card (built in PR #101, round 3) from a timeline into a full live
task panel: overall progress and time, live validation from GitHub Actions, files and model, actions
(Review PR, Retry, Guidance, Copy, Cancel), stall and fix-attempt signals, notifications and a
dashboard panel. Everything shown comes from data the app already has; nothing is invented.

## Branch and commit
- Branch: `feat/pr101-actions-live-dashboard`, restarted from `main` @ 22871b4 (PR #101 squash-merged).
- Last pushed commit: see the PR's commit list.

## Plan and status
Status keys: `[x]` done and tested, `[~]` in progress, `[ ]` not started.

1. [x] **Header**: ring with steps done (`4/7`), total time so far (live), and "usually ~6m" from this
   device's own past task durations (`kappaforge.taskDurations.v1`, last 10 per mode, median).
2. [x] **Live validation rows**: after the draft PR, "Sandbox tests" and "iOS build" rows from the
   Workflow Monitor (runs titled `Sandbox validation kappa/dev-N @ sha` / `iOS build kappa/dev-N @ sha`),
   with the current step ("Step 3/7: npm test") and a bar; tap opens the run page. Without Actions data
   the tests row falls back to the task's own lifecycle (testing / tests passed / tests failed).
   The monitor keeps streaming in Chat while a tracked task is being validated.
3. [x] **Files and model**: backticked paths in a step become chips ("+4 more"); the agent's
   "Wrote the change" and "Pushed fix" lines are reworded so files and model parse cleanly.
4. [x] **Actions row**:
   - Review PR (opens the review card on the Dashboard);
   - Retry (confirmed, `/retry` via the owner authorization path);
   - Send guidance (confirmed, `/guidance`);
   - Copy summary;
   - Cancel (existing).
5. [x] **Stalled banner**: `KappaJobs.stalled` (15 min without an update) shows a warning with Retry.
6. [x] **Fix attempts**: "Fix 2 of 3" badge when the checklist is a repair round.
7. [x] **Collapse memory**: finished cards fold to one line (ring, tag, time); the owner's open/closed
   choice is saved on the message.
8. [x] **Notifications**: toast when a task finishes its checklist, needs attention, or its tests pass/fail.
9. [x] **Dashboard "Agent tasks" panel**: running and recently finished tasks with a mini bar and the
   current step; tapping opens the chat at that card.
10. [x] **Accessibility**: polite live region announcing step changes; ring and bars labelled.
11. [x] Tests (parsers, card, actions, monitor-in-chat, durations), browser check on a phone (dark/light),
    bundle sync, docs.

### Where it lives
- `core.js` `KappaJobs`:
  - `taskModel` (rows, counts, seconds, since, fix, pr, model; stages folded);
  - `chips`, `recordDuration`, `typicalDuration`, `taskSummaryText`, `seconds`, `clock`.
- `ui.js` `renderTaskActivity(m,i)`: ring, total time (`data-since` + `data-base`), meta line, stalled notice, file chips,
  validation rows (`data-run`), the actions row, and `m.collapsed`.
- `app-tasks.js`:
  - `taskValidation`, `tasksValidating`;
  - `taskProgressChanged` (announce, toasts, durations), `announceTask`, `taskTypicalSeconds`;
  - `taskRetry`, `taskGuide`, `taskCopy`, `taskReview`.
- `app-dashboard.js`:
  - `agentTasksPanel`, `taskProgressMessage`, `openTaskInChat`;
  - chat keeps the monitor while a task validates;
  - card bindings; the ticker adds `data-base`.
- `app-state.js`: `monitorShown`; `refreshActiveDetails` also fetches task runs in chat.
- `engine/developer.py`: "Wrote the change with <model>: N files …" and "Pushed fix N of M: …".

## Tests performed
- Baseline on `main` @ 22871b4: `npm test` 164 pass, Python suite OK.
- After this round:
  - `npm test` 172 pass (new `tests/task-panel.test.mjs`); all Node test files 266 pass; Python OK;
  - `check-web` (including the duplicate-global guard) passed; dependency map current;
  - `npm run test:web` desktop PASS.
- Browser check on a phone (390px), dark and light, against a faked GitHub API through the app's real code:
  - live Sandbox tests row (Step 3/5: npm test) and the finished iOS build in the card; ring 7/8; live totals;
  - "usually ~6m 35s" median; the fold choice kept across reload;
  - the dashboard Agent tasks panel opens the right card, and the test row opens its run page;
  - no page errors, no overflow.

## Next task
All items are done. Watch CI on the PR.

## Safety notes
Retry and guidance go through the existing confirmed owner-authorization path; no new write endpoints.

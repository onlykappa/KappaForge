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

1. [ ] **Header**: ring with steps done (`4/7`), total time so far (live), and "usually ~6m" from this
   device's own past task durations (`kappaforge.taskDurations.v1`, last 10 per mode, median).
2. [ ] **Live validation rows**: after the draft PR, "Sandbox tests" and "iOS build" rows from the
   Workflow Monitor (runs titled `Sandbox validation kappa/dev-N @ sha` / `iOS build kappa/dev-N @ sha`),
   with the current step ("Step 3/7: npm test") and a bar; tap opens the run page. Without Actions data
   the tests row falls back to the task's own lifecycle (testing / tests passed / tests failed).
   The monitor keeps streaming in Chat while a tracked task is being validated.
3. [ ] **Files and model**: backticked paths in a step become chips ("+4 more"); the agent's
   "Wrote the change" and "Pushed fix" lines are reworded so files and model parse cleanly.
4. [ ] **Actions row**:
   - Review PR (opens the review card on the Dashboard);
   - Retry (confirmed, `/retry` via the owner authorization path);
   - Send guidance (confirmed, `/guidance`);
   - Copy summary;
   - Cancel (existing).
5. [ ] **Stalled banner**: `KappaJobs.stalled` (15 min without an update) shows a warning with Retry.
6. [ ] **Fix attempts**: "Fix 2 of 3" badge when the checklist is a repair round.
7. [ ] **Collapse memory**: finished cards fold to one line (ring, tag, time); the owner's open/closed
   choice is saved on the message.
8. [ ] **Notifications**: toast when a task finishes its checklist, needs attention, or its tests pass/fail.
9. [ ] **Dashboard "Agent tasks" panel**: running and recently finished tasks with a mini bar and the
   current step; tapping opens the chat at that card.
10. [ ] **Accessibility**: polite live region announcing step changes; ring and bars labelled.
11. [ ] Tests (parsers, card, actions, monitor-in-chat, durations), browser check on a phone (dark/light),
    bundle sync, docs.

## Tests performed
Baseline on `main` @ 22871b4: to be recorded with the first code commit.

## Next task
The first unchecked item above.

## Safety notes
Retry and guidance go through the existing confirmed owner-authorization path; no new write endpoints.

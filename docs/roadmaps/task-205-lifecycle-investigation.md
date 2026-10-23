# Task #205: failure analysis and implementation roadmap

Status: investigation only. This draft adds documentation; it does not change application code, workflows, permissions, task #205, or PR #206. Implementation requires a later development request. Evidence was inspected on 2026-10-23.

Branch baseline: main at `71cddc0f74737518210cf7fae930f1d11379c516`, after PR #203 merged with all checks passing. Incident source links intentionally refer to the older revision that executed task #205.

## Findings

The PR step was not skipped. [Draft PR #206](https://github.com/onlykappa/KappaForge/pull/206) was created at **14:00:47 UTC**, before the screenshot's sandbox and native runs were dispatched at **14:14:31** and **14:14:35**. It remains a draft with unfinished work. The current implementation creates a draft after its first validated source stage, rather than before any source work. A literal requirement to open an empty draft first is therefore not implemented.

The iOS job was automatic validation of app-related changes, not evidence that the agent independently chose to ship an iOS release. The native run ultimately passed; its release job was skipped. The actual sandbox failure was a generated authorization regression. Recovery subsequently treated an already-created PR as an unmet code requirement, produced unnecessary PR-creation scripts, and attempted to add a protected workflow. The edit guard correctly rejected that proposal and stopped recovery.

There are multiple distinct failures here. A passing iOS build cannot establish that the audit was complete, that chat still worked, or that all owner requirements were satisfied.

## Evidence and chronology

All times below are UTC on 2026-10-23 (subtract seven hours for the phone's Pacific time). Git commit timestamps establish saved checkpoints; journal event times establish recovery events. Mutable issue comments are snapshots, not an append-only execution trace.

| Time | Confirmed event | Evidence |
| --- | --- | --- |
| 13:58:35 | Owner requested a fresh draft PR, a full bug audit, fixes, and notification when ready for review. | [Task #205](https://github.com/onlykappa/KappaForge/issues/205) |
| 14:00:43 | First source checkpoint saved. It added `/chat` and `/capabilities` to `writePaths`. | [f2d6711](https://github.com/onlykappa/KappaForge/commit/f2d67111e4e94689b124d30a92cd984aed5dc90f) |
| 14:00:47 | Draft PR #206 created from `kappa/dev-205`. | [PR #206](https://github.com/onlykappa/KappaForge/pull/206) |
| 14:01–14:06 | Repeated malformed JSON, duplicate import, ambiguous anchors, and missing-current-context rejections. Several stages were saved. | [Recovery journal](https://github.com/onlykappa/KappaForge/issues/205#issuecomment-6366619876) |
| 14:06:40 | Gateway returned an unclassified HTTP 503; continuation was queued with the candidate saved. This is not proof that a particular provider exhausted quota. | Recovery journal |
| 14:10:59 | Recovery dispatch requested; runner acknowledged around 14:11:23. | [Dispatch observation](https://github.com/onlykappa/KappaForge/issues/205#issuecomment-6366874063), [acknowledgement](https://github.com/onlykappa/KappaForge/issues/205#issuecomment-6366882215) |
| 14:11:32 | Recovery recorded “Tests failed or original requirements remain unmet.” This message alone does not prove tests failed: the code also repairs unfinished requirements without a failed check. | Recovery journal; `developer.fix_pull_request()` |
| 14:11:54–14:13:58 | Recovery saved additional checkpoints, including placeholder audit and PR-creation scripts. Last saved candidate: `a77ee2f73a05e8150959e1d5610c021a43e1c6dd`. | [Candidate](https://github.com/onlykappa/KappaForge/commit/a77ee2f73a05e8150959e1d5610c021a43e1c6dd) |
| 14:14:31 | Sandbox validation dispatched for that candidate. | [Run 39967941929](https://github.com/onlykappa/KappaForge/actions/runs/39967941929) |
| 14:14:35 | iOS validation dispatched for the same candidate, using the trusted workflow on main. | [Run 39967950210](https://github.com/onlykappa/KappaForge/actions/runs/39967950210) |
| 14:14:51 | Sandbox Node tests finished with 30 failures. Many expected ordinary chat responses but received 403. Python tests and syntax checks had passed. | [Sandbox job](https://github.com/onlykappa/KappaForge/actions/runs/39967941929/job/120462651162) |
| 14:16:06–14:16:10 | The next repair proposed `.github/workflows/open-draft-pr.yml`; the protected-path guard rejected it. Journal classified the result as authorization/stop. | [Recovery run](https://github.com/onlykappa/KappaForge/actions/runs/39968007488), [failure report](https://github.com/onlykappa/KappaForge/issues/205#issuecomment-6366985115) |
| 14:25:32 | Native run completed successfully; simulator UI tests and unsigned IPA build passed. Release was skipped. | Native run; [task result](https://github.com/onlykappa/KappaForge/issues/205#issuecomment-6367176981) |

## Exact logic behind the failures

### 1. An authorization set was mistaken for a route allowlist

The first generated change extended `chat-backend/src/intent-guard.js`:

```js
const writePaths = new Set([
  '/jobs', '/retry', '/guidance', '/decisions', '/undo', '/actions/control',
  '/chat', '/capabilities'
]);
export const needsAuthorization = path => writePaths.has(path);
```

This is an execution-authorization set, not the Worker's HTTP route registry. In `chat-backend/src/index.js`, `needsAuthorization(executionPath)` calls `authorize(..., true)` before dispatching the request. `authorize()` rejects a request without an operation scope ID and conversation ID with `User authorization is required`; the handler converts that exception to HTTP 403.

Normal authenticated chat does not carry a development-task operation authorization. Consequently the new entries stopped chat before inference or its tools ran. The PR's explanation claimed this would prevent 404 errors, but the source and observed 403s contradict that claim. No extra Cloudflare permission is needed to explain these test failures.

**Read-only reproduction:** extracted immutable baseline `053bcc9d6b046fd065edd053dd51e8c45d692a65` and candidate `a77ee2f...` into separate disposable directories outside the working repository, then ran:

```text
node --test tests/chat-tiers.test.mjs tests/free-route-policy.test.mjs
```

Baseline: **22 passed, 0 failed**. Candidate: **17 passed, 5 failed**, including 403 instead of 200/503. The candidate's sandbox log independently reports 30 failures across its larger selection. No production requests, credentials, or repository source edits were used for this reproduction. Some sandbox tests are included more than once through imported suites; 30 failed assertions should not be represented as 30 separate root causes.

### 2. The reviewer can only prove source behavior, but is asked to prove external actions

`engine/developer.py:checkpoint()` opens a draft using GitHub's API after the first validated stage and saves its URL in the recovery journal. Both the journal and actual PR show that happened.

However, `check_the_work()` retains every owner requirement and forwards them to `engine/verify.py:model_review()`. `review_prompt()` tells the model to decide **every** requirement from current source/diff and demands an existing source path plus literal source quote for every `met:true` result. It does not accept a trusted GitHub PR receipt as the evidence type for “open a fresh PR” or “keep it as a draft.”

This creates an evidence mismatch: an external orchestration action has already happened, while the source reviewer looks for repository code implementing that action. The saved review explicitly says that `scripts/open-pr.js` is not invoked and recommends a CI workflow or hook to run it. The next failed proposal targets `open-draft-pr.yml`.

The observed sequence strongly supports that causal link. Raw model reasoning is not available, so the exact internal reason for choosing that filename remains an inference. The model's public proposal, review text, candidate contents, and guard result are observable.

The repair prompt compounds the problem by saying to fix every self-review finding in the real code paths. Review claims must remain hypotheses; a model recommendation to create automation must not become new owner authorization or override known PR lifecycle facts.

There is also a concrete prompt mismatch: `fix_pull_request()` permits repair when requirements are unfinished even without a failed check, but `revise_branch()` begins with “The independent checks FAILED for this change” unconditionally. A requirements-only continuation can therefore receive a false premise that tests failed. Pass the actual trigger and exact failed assertions instead of a generic failure statement.

### 3. A placeholder audit became a substitute for actual investigation

The candidate's `scripts/audit.js` counts preview JavaScript files and lines, then unconditionally reports that no major bugs were detected. That cannot establish a full audit. `scripts/open-pr.js` independently posts another PR despite the engine already owning draft creation. Neither script is necessary to fix the observed chat regression.

The review correctly rejected the placeholder audit and incomplete work, but mixed those valid findings with the false “no PR exists” finding. Repair therefore chased a combination of genuine defects and an orchestration misunderstanding.

Both generated `.js` scripts also use CommonJS `require`, while the repository's `package.json` declares `"type": "module"`. Running `node scripts/audit.js` in the disposable candidate snapshot fails immediately with `ReferenceError: require is not defined in ES module scope`. The PR script has the same module-format defect; it was inspected but not executed, to avoid any PR-creation side effect. Adding a workflow to run these scripts would not fix that failure or establish audit completion.

### 4. “Validated stage” does not mean all independent tests passed

Saved checkpoints contain proposals that passed the engine's edit/syntax checks. They can precede the full external sandbox and native workflows. PR #206's original checkpoint body explicitly marks completion unverified. The first authorization regression was therefore saved to a draft without establishing functional correctness.

Do not remove early checkpoints: they preserved recoverable work during the gateway outage. Instead distinguish **edit validated**, **behavior validated**, and **owner requirements complete** in both state and language.

### 5. iOS validation is triggered by changed paths and PR events

`engine/developer.py:dispatch_tests()` dispatches sandbox validation and then calls `engine/native_build.py:needed()`. Native validation is selected for this repository when changed paths begin with `ios/`, `preview/`, `scripts/`, `config/`, or the native workflow path. The task changed preview code and scripts, so it qualified without a separate request to implement iOS features.

Additionally, `.github/workflows/ios-build.yml` has a `pull_request` trigger filtered to app/build paths. Opening or updating a draft with such files can start native validation before the full audit finishes. The screenshot's specific run was a `workflow_dispatch` after PR creation, not a release.

The native workflow compiles the simulator app, launches it, runs UI tests, builds an unsigned iPhone app, and packages an IPA. Its release job requires a **push to main**. This dispatched task run did not satisfy that condition. Preserve that separation.

`candidate_sha` is used in naming/matching; checkout uses the branch input. Investigate the branch-movement window and whether every dispatch proves its actual checkout SHA. This report does not establish that a checkout mismatch occurred in task #205.

### 6. Recovery can stop while previously dispatched validation continues

`developer.fix_pull_request()` acts on unfinished requirements or a completed failed check; it deliberately does not wait for an unrelated in-flight native check. That avoids stranding a repair behind a slow native job. It also permits the exact screenshot combination: sandbox failed, repair blocked, native build still running.

`developer.check_path()` rejects `.github/` changes. `recovery.diagnose()` maps protected-path errors to authorization/stop, and the journal becomes `blocked_authorization`. That stop was the correct response to the proposed edit. The generic advice to “provide missing access” is misleading for this deterministic code policy: supplying Cloudflare keys would not make the proposed edit correct.

### 7. The card combines separate state streams

`preview/task-progress.js` stores attempt IDs, revisions and timing. `preview/ui.js:renderExecutionActivity()` combines the current attempt's steps with `taskValidation(job)` rows, counts both in the denominator, and renders the recovery error alongside them. Thus “0 of 3 steps” is not necessarily the original three-stage plan: the newer blocked recovery snapshot can contain one step, plus two validation rows. An in-progress iOS row does not prove that the failed repair is still executing.

The screenshot's 11 seconds, queued time, and native elapsed time represent different scopes. Reconstructing every displayed duration requires the phone's persisted task/cache state at capture time; server snapshots alone cannot prove those exact values. A future UI should label attempt time, total task time, and validation time separately and retain a visible “Draft #206 created” milestone across retries.

There is a related contract to investigate: `preview/app-tasks.js:taskValidation()` always creates sandbox and native rows, and `updateTaskVerification()` requires both to be done. The engine dispatches native only for selected paths. That can leave a task with no native-relevant changes waiting for an unnecessary check. It is not the cause of #205's sandbox failure, because this task did have native-relevant changes and its native run passed. Future verification should use the task's trusted required-check manifest rather than a hardcoded two-check assumption.

## What remains uncertain

- Why the initial model invented a chat allowlist bug without a failing baseline assertion. The proposal's explanation is available; internal reasoning is not.
- Which prompts and context windows drove each intermediate change. The journal has context hashes and gateway summaries, not every full serialized request.
- Whether native validation was redundantly triggered by both PR events and explicit dispatch for every candidate. Inspect all events and actual checkout SHAs before introducing deduplication.
- The phone's complete cached snapshot at 07:16–07:17. Reproduce the UI with saved server fixtures; do not infer exact timing or ordering solely from screenshots.
- The broad audit requested in #205 remains unfinished. This lifecycle investigation does not validate or repair PR #206.
- PR #203 addresses the missing-current-context and output-limit fallback issues seen earlier; those changes do not resolve the lifecycle evidence mismatch described here. Reproduction should start from main after #203, then replay the old saved evidence.

## Implementation roadmap

Implement in small, reviewable stages. Do not start by increasing retry budgets or relaxing protected paths.

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P0: deterministic replay | Capture sanitized task, authorization identity, original requirement IDs, journal revisions, PR metadata, candidate SHA, workflow event/ref and actual checkout SHA. Create immutable fixtures for this failure sequence. | One replay produces the observed PR, sandbox failure, blocked repair, and late native success in the correct order without real inference or GitHub writes. |
| P0: separate evidence types | Represent code requirements, external lifecycle actions, and validation requirements separately. Preserve every original ask. Resolve PR-created/draft facts through trusted API receipts bound to repository/task/branch, not source quotes. | An existing correct draft satisfies the lifecycle requirement; a wrong-repository, closed, non-draft, unrelated or stale PR does not. Source claims cannot forge a receipt. |
| P0: stop repair scope drift | Reconcile review claims against trusted orchestration facts before producing a repair prompt. Keep genuine code defects actionable. Avoid generating PR-creation automation to satisfy a current task's lifecycle milestone. | The #205 replay never creates `scripts/open-pr.js` or proposes `open-draft-pr.yml`; a real placeholder audit is still rejected. Protected-path tests remain enforced. |
| P0: reproduce and repair the actual regression | Run baseline/candidate tests, trace the authorization consumer, and repair only the erroneous behavior under a later authorized implementation request. Keep normal chat authentication and task-operation authorization intact. | Normal chat and capabilities work under their existing contracts; jobs/retry/guidance and other writes still reject missing, replayed, expired, cancelled and cross-conversation authorization. |
| P1: define PR-first contract | Decide whether “open a fresh draft first” means before code generation, or immediately after the first safe checkpoint. If literal PR-first is required, use a minimal task-owned plan commit as the PR seed rather than a fake application change. Announce the actual receipt. | Failure to create the draft is surfaced as its own orchestration failure; no build is described as proof a PR was created. Retries reuse the same verified draft. |
| P1: validation orchestration | Inspect native/sandbox trigger overlap; deduplicate by task, candidate, validation kind and actual checkout SHA where appropriate. Pin the candidate, preserve trusted workflow execution, keep releases restricted, and define handling of older in-flight jobs after a terminal stop. Derive required checks from a trusted manifest shared by the engine and UI. | Branch movement, duplicate delivery, out-of-order completions and a late native success cannot validate a different head or restart blocked recovery. Documentation-only tasks do not select native validation through explicit path routing and do not wait forever for an unnecessary native result. |
| P1: audit evidence | Require real baseline checks, reproducible findings and affected producer/consumer paths. Reject counters, blanket no-bug claims and speculative fixes as audit completion evidence. | A line-count-only script fails completion review; a real defect includes its reproduction and a meaningful regression check. |
| P1: user-visible truth | Persist the PR-created milestone; label attempt/total/validation timing; distinguish policy rejection, missing context, provider unavailability and actual access errors. Say recovery was requested until the runner acknowledges it. | Fixtures cover blocked repair with native still running, late native success with unmet requirements, missing access, and provider waiting. No “ready” or “fixing” claim is inferred solely from successful dispatch or passing compilation. |
| P2: bounded rollout | Test with mocked providers and GitHub transports first; then one explicitly authorized draft-only canary. Keep original authorization expiry, candidate checks, checkpoint continuity, operation receipts and denial paths. | Existing Python, Node, web, structural and relevant native checks pass. Canary reports exact lifecycle events and leaves the draft unmerged. |

### Required replay cases

1. PR exists and is draft while source reviewer says no PR exists: correct the evidence mismatch without editing application code for that lifecycle fact.
2. Draft creation fails or times out after a request: reconcile by branch/task identity before retrying, avoiding duplicate PRs.
3. Candidate changes while a validation job is queued: actual checkout and completion must stay bound to the intended SHA.
4. Sandbox fails while native runs; recovery then hits a protected path: keep the task blocked and show the native job independently.
5. Native later passes but audit requirements remain open: never mark the whole task ready.
6. Provider outage between checkpoints: resume the same task, requirements and draft without repeating external actions.
7. Missing-current-context rejection: reload required candidate sources using #203's behavior; retain all edit guards.
8. Model fabricates a route defect or source evidence: deterministic reproduction and current source disprove it before repair.
9. Replayed/stale notifications, cancellation and expired authorization: no extra writes, recovery dispatches, inference or releases.
10. Read-only investigation: report and roadmap only; no automatic development or native build caused by the investigation itself.

## Prompt for the later implementation task

> Fix the task lifecycle and recovery defects documented in `docs/roadmaps/task-205-lifecycle-investigation.md`. Start from main containing PR #203. Keep the work in this draft and do not merge or release it. First reproduce task #205 using sanitized saved evidence and mocked GitHub/provider transports. Preserve the original owner requirements, authorization scope/expiry, protected-path guard, source-read guard, candidate checks and secret-free validation.
>
> Separate code evidence from trusted external-action receipts. An actual draft PR created for this task must satisfy “open a fresh PR” and “keep it as a draft”; do not write scripts or workflows merely to simulate those actions in source. Reconcile incorrect reviewer claims before repair while retaining genuine findings. Prove the actual `/chat` authorization regression with a baseline/candidate test, then repair it without weakening authorization for write operations.
>
> Make the PR-first ordering explicit and visible. Inspect native validation triggers and candidate checkout binding; prevent duplicate or stale results from changing the wrong task state. Preserve native validation for real app changes and existing release gates. Keep blocked repair, in-flight checks, successful checks and owner-task completion as separate facts. Replace placeholder audit claims with reproducible findings. Add the replay cases from the roadmap, run applicable repository checks, and report the causal chain, remaining limitations and draft PR link. Do not edit PR #206 or retry task #205 unless separately authorized.

## Validation of this investigation

Reviewed the three supplied screenshots, task #205 comments/journal, PR #206 metadata and immutable candidate diff, sandbox failure logs, recovery rejection logs, native run/job outcomes, and the relevant engine/Worker/UI/workflow paths. Reproduced five candidate failures against a passing 22-test baseline using disposable source snapshots. No production behavior was changed by this investigation.

## Source map

Permalinks below use the immutable main revision that executed task #205. #203 changes context/fallback handling; verify symbols again before implementation.

- [`engine/developer.py` — `def dispatch_tests`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/developer.py#L178)
- [`engine/developer.py` — `def check_the_work`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/developer.py#L1502)
- [`engine/developer.py` — `def checkpoint(`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/developer.py#L1696)
- [`engine/developer.py` — `def check_path`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/developer.py#L63)
- [`engine/verify.py` — `def review_prompt`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/verify.py#L332)
- [`engine/verify.py` — `def model_review`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/verify.py#L415)
- [`engine/native_build.py` — `def needed`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/native_build.py#L14)
- [`engine/native_build.py` — `def dispatch`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/native_build.py#L22)
- [`chat-backend/src/intent-guard.js` — `const writePaths`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/chat-backend/src/intent-guard.js#L4)
- [`chat-backend/src/intent-guard.js` — `export async function authorize`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/chat-backend/src/intent-guard.js#L73)
- [`chat-backend/src/index.js` — `if(needsAuthorization(executionPath)`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/chat-backend/src/index.js#L453)
- [`preview/app-tasks.js` — `function taskValidation`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/preview/app-tasks.js#L499)
- [`preview/app-tasks.js` — `function updateTaskVerification`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/preview/app-tasks.js#L518)
- [`preview/ui.js` — `function renderExecutionActivity`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/preview/ui.js#L102)
- [`preview/task-progress.js` — `function timing`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/preview/task-progress.js#L45)
- [`.github/workflows/ios-build.yml`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/.github/workflows/ios-build.yml)
- [`.github/workflows/sandbox-tests.yml`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/.github/workflows/sandbox-tests.yml)
- [`engine/developer.py` — `def fix_pull_request`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/developer.py#L1986)
- [`engine/recovery.py` — `def diagnose`](https://github.com/onlykappa/KappaForge/blob/053bcc9d6b046fd065edd053dd51e8c45d692a65/engine/recovery.py#L72)

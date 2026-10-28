# Phase 3.1c, job 4 — owner-task intake

Source inspection and local test execution at PR #279 head `f5501afe417a63c4ebc089954d99968ef4e55bb0`, recorded 2026-10-28 UTC. No issue was created or labeled and no agent task was dispatched for this check.

## Entry point and authority

- [.github/workflows/task-intake.yml](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/.github/workflows/task-intake.yml) listens only for issue `opened` and `labeled` events. Its job requires issue author `onlykappa`; a label event must add `kappa-task`. This checks the issue author, not that every event actor is the owner.
- The job has `contents:read`, `issues:read` and `actions:write`, a three-minute timeout and a task-number concurrency group with cancellation disabled. It checks out the issue event's repository revision and runs the fixed `scripts/task_intake.py` entry point. Issue text is not interpolated into shell commands.
- [eligible](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/scripts/task_intake.py#L31) refuses PR objects, closed/non-owner issues, a missing task label, chat-dispatched tasks and requests without the root repository/develop-mode declarations. It then constructs the production `ExecutionScope`; invalid, expired or restricted authority is refused. A task label alone is not the execution grant.
- Excluding `Approved from KappaForge Chat.` avoids redispatching work already launched by the app's separate authorization path. The intake's only mutation is a fixed `agent.yml` workflow dispatch on `main`, with the numeric issue number as its sole input. It does not select candidate workflows, alter permissions, publish code, merge or deploy.

## Deduplication and bounds

`already_dispatched` reads at most ten pages of 100 agent workflow-dispatch runs. An exact task-title prefix plus a run timestamp at or after issue creation prevents another intake dispatch. Exhausting the supported inspection window raises instead of assuming no prior run. Per-task workflow serialization and agent concurrency provide separate overlap controls.

This is bounded history deduplication, not a durable compare-and-set around GitHub's dispatch API. The source/test inspection does not establish atomic exactly-once delivery under every remote listing delay or ambiguous network outcome.

## Executed verification and limits

```sh
python -m unittest tests.test_task_intake -v
```

Result: five passed, zero failures/skips. Cases cover open/label eligibility; non-owner, app-created, closed, foreign-repository, wrong-mode and PR refusal; expiry; dispatch to the fixed trusted ref; and suppression when a prior task run exists. The test clock is frozen for its fresh-task fixture and explicitly advanced for the expiry refusal; production deadlines are unchanged.

The workflow and script are part of #279's unmerged changes and are absent from the observed main snapshot. This audit therefore does not claim a live issue-event intake demonstration on deployed main. Its permission declaration remains part of the existing #279 review. Other recovery-wake, cancellation, Actions-control and retry/guidance paths still require their complete source traces before 3.1c closeout.

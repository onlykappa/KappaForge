# Development recovery

Development runs retain their original owner task, authorization digest, target
repository and candidate SHA throughout recovery. No model response, error log or
checkpoint can broaden that scope. This extends PR #137's malformed-output fix.

## Failure and strategy

The deterministic classifier separates malformed JSON, truncation, invalid
schemas, edit-anchor mismatches, missing context, syntax errors, behavioral test
failures, provider outages, rate limits, model deadlines, task deadlines and
access/authorization failures. The journal records the original diagnostic and
model, strategy, outcome, next action and candidate commit. Secrets matching
credential environment variables are redacted; raw responses are not stored.

Generation requests structured JSON from providers supporting it. A malformed
answer gets one short serialization-only repair per generation round. Every
response still passes normal scope, exact-match, schema and syntax checks.
Unsuccessful large proposals get a compact route (80,000 context characters,
8,192 output tokens). If that fails, a live recovery journal permits one replan
into at most three smaller implementation stages per run, without recursive
replanning. Validated stages are checkpointed; missing work stays incomplete.

Unread-file failures load source at the immutable candidate SHA. Repeated
proposal detection includes the actual source evidence, so a proposal previously
rejected for missing context can be validated after that context is loaded.
Unchanged rejected proposals and twice-failing models are remembered across runs.

## Durable checkpoints

The engine updates a task-bound `KAPPA_RECOVERY_V1` comment created by the trusted
GitHub Actions bot. The parser requires the dedicated heading, matching task,
repository, authorization identity and issue-body digest. Embedded markers in
model reports or comments from other authors cannot queue work.

Code stays on `kappa/dev-N`, never in the journal. Initial implementation and
repair stages save syntax-validated candidates before further model review.
Checkpoint PR descriptions remain incomplete until all requirements are reviewed
and independent tests are dispatched. Schema/syntax validation is not behavioral
verification. The requirement catalog survives review rounds and continuations.

Continuation checks the saved branch head before generating or pushing. A changed
head blocks the continuation and preserves the newer work. Updates never force a
branch. A saved branch without a PR can acquire its original draft only when the
journal identifies that exact checkpoint; a closed saved PR is not reopened.

## Continuation queue

`.github/workflows/recovery.yml` scans authorized development tasks every 15
minutes. GitHub schedule delays are possible. Transient exhaustion waits at least
five minutes before eligibility. A model deadline (four minutes per routing call)
is separate from the task generation deadline (five hours and fifty minutes).
An interrupted completed worker can resume its saved candidate; active workers
and explicitly cancelled runs are not restarted.

Each continuation reserves an immutable task/authorization/sequence ref. Dispatch
state is persisted before delivery, and the existing per-task Actions concurrency
queue serializes workers. A continuation token is consumed once. Lost dispatch
acknowledgements retry the same token after twenty minutes, at most three
deliveries. Reservation-before-state crashes can be reconciled after that delay.
There are at most three automatic continuations and forty recovery events per
unchanged task authorization. Near-expiry tasks block rather than queue work
that cannot be authorized. Closure, expiry or a changed task revokes execution.

A continuation reuses the existing draft. If only independent-test dispatch was
interrupted, it dispatches tests for the exact saved SHA rather than regenerating
code. Existing exact-SHA sandbox and native checks still gate review/merge.
No queue path merges or releases anything.

## App visibility

Snapshots expose recovering, waiting, blocked, failed and independently ready
states. They include the real error/model, next action, saved commit and
continuation eligibility. Waiting is not reported as stalled execution. Known
authorization expiry displays a block and a request to renew authorization.
The shared preview scripts are bundled into iOS; these new status displays need
an updated app build. The server-side recovery behavior does not require an IPA.

## Validation and limits

Deterministic failure injection reproduces task #130's two malformed responses
followed by routing timeout, then a valid compact proposal. The controlled test
runs its generated behavioral assertion before and after the implementation,
saves the candidate through the real commit path, queues continuation, and
restores the same candidate and requirements. Additional tests exercise the real
runner's one-time resume path, real repair/checkpoint/test dispatch, missing
context, smaller-stage replanning, dispatch acknowledgement loss, abandoned
reservations, delivery caps, cancellation, expiry and concurrent branch changes.
UI tests load the production normalizer and renderer.

These tests fake network and provider responses. They do not establish live
provider availability or demonstrate production GitHub scheduling before merge.
Automatic scheduled continuation currently supports development tasks targeting
KappaForge itself. Cross-repository tasks report a block because the queue's
repository-scoped token has no authority to resume other repositories. Source
checks and model review cannot prove arbitrary program correctness; independent
behavioral tests and native checks remain necessary. The weather feature in
PR #133 is not declared fixed or complete by this engine change.

# Persistent development recovery

The development engine retains the owner's unchanged task, repository,
authorization identity and candidate SHA throughout repair and continuation.
Models, logs, checkpoints and project registration cannot grant execution scope.
PR #138 extends #137 and fixes the seven failure paths reproduced in the audit.

## Root causes and changes

| Original failure | Root cause | Current behavior |
| --- | --- | --- |
| Checkpoint fails around 19 entries | Entry count ignored serialized size | Count and complete UTF-8 payload budgets, archive-before-replace, transactional rollback |
| Repeated discovery 403 | Discovery bypassed route health | Shared discovery/execution health, permanent credential/access blocks and healthy alternatives |
| False authorization failure at 40 retries | Retry cap raised `PermissionError` | Typed local exhaustion, durable cumulative budgets and bounded continuation |
| Three continuations used during cooldown | Scheduler ignored provider eligibility | Earliest retry survives generation wrappers and restarts; waiting scans do not dispatch |
| Repeated old proposals | Rotating history held rejection memory | Separate task/project/candidate failure ledger with evidence-bound fingerprints |
| Unexpected JSON crashes | Nested provider data was trusted | Typed envelope validation for discovery, completions, metadata and tool-call envelopes; controlled stream errors |
| Other projects cannot continue | Repository name used as access policy | Trusted project registration, exact-project credential preflight and task-scoped branch permissions |

## Storage and migration

The active `KAPPA_RECOVERY_V1` checkpoint remains a trusted GitHub Actions bot
comment with its original heading. Its task, project, authorization and task-body
digest must match. Existing checkpoints are read without resetting candidates,
continuations or task data. Legacy budgets are initialized once from retained
rejection counts and known model events; these are lower-bound estimates because
old versions did not persist exact call counters. New-format counters are exact
and never reset on restart. Legacy derived requirement catalogs are retained for
audit; canonical requirements are rebuilt from the unchanged owner task.

GitHub issue comment bodies have a 65,536-character ceiling. The implementation
uses a conservative 60,000 UTF-8 byte budget for the **complete body**, including
heading, visible state, delimiters and JSON. Forty events is a separate maximum.
History rotates when either budget requires it. Archives are split into bounded
fragments, with content-derived IDs, sequence numbers and structured summaries.
Unicode and JSON escaping are included in final payload measurements.

Archives are written before replacement. GitHub's individual comment PATCH is the
replacement boundary; task workflow concurrency serializes workers. A failed
archive, compaction or replacement restores the last committed in-memory state
and leaves the previous remote checkpoint valid. A lost acknowledgement can
produce duplicate archive fragments, identified by the same archive ID; it does
not remove the old checkpoint. This is not a multi-comment database transaction.

Large active requirement catalogs can use a separately validated
`KAPPA_REQUIREMENTS_V1` comment, referenced from the checkpoint. Exact requirements
are rehydrated before execution. Missing references stop safely. Raw model
outputs do not enter the checkpoint. Candidate source lives in Git commits and
large run diagnostics remain in GitHub Actions logs; secrets matching credential
environment values are redacted from stored failure records and generation
validation diagnostics.

Failure intelligence uses separate bounded `KAPPA_FAILURES_V1` comment shards.
These retain task, project, branch, candidate, operation, model/provider, error,
strategy, fingerprint, files, attempts, expiry and outcome. Rotating display
history never deletes these records. Rejection fingerprints bind canonical
proposals to the candidate and source evidence. New source permits reconsideration
without erasing prior evidence. Model avoidance also considers the context budget;
a large-output rejection does not permanently exclude a model from compact work.
Transient failure records expire for avoidance, while unresolved edits stay
identifiable through their authorization lifetime. Existing rejected keys migrate
on resumption. Historical comments and ledger records are not deleted.

## Coordinated budgets and state

`engine/reliability.py` owns typed policy failures, response validation, budget
charging and execution-state transition rules. `engine/recovery.py` owns durable
state and queue delivery. `engine/runner.py` applies the shared health policy to
provider requests; `engine/intent_guard.py` still authorizes every GitHub mutation.

Budgets are distinct and bounded:

- Five edit recovery attempts per generation round and forty per worker run.
- A default cumulative 120 edit recoveries, 160 model-routing calls and 12 repair cycles per task
  authorization, configurable per trusted project. Debits precede work and survive
  restarts and candidate changes. A routing call can contain bounded provider
  attempts, so 160 is not a promise of 160 HTTP requests.
- At most three automatic continuation deliveries per task authorization, with
  the existing atomic reservation, one-time token consumption and per-task Actions
  concurrency. Ambiguous delivery retries use the same token, at most three times.
- Four minutes per model routing call and five hours fifty minutes per worker's
  model work. Authorization expiry remains independently enforced.

Local retry exhaustion is a recoverable typed error, not an access failure.
The old three-fix PR counter remains only for legacy execution without a journal.
Journal-backed tasks use the durable repair-cycle budget and switch to compact
proposals after three cycles instead of silently stopping.
Cumulative exhaustion is explicitly terminal and preserves evidence. Repeating
restarts cannot reset cumulative counters. Only source/context changes allow
reconsideration of an otherwise equivalent failed operation; they do not grant
new permissions or reset the cumulative budget.

Durable execution states are `queued`, `running`, `recovering`,
`waiting_for_provider`, `validating`, `completed`, `blocked_authorization`,
`failed_terminal`, `cancelled`, and `paused`. Their transitions are validated.
Existing app status names remain as wire aliases, with the canonical state in
recovery metadata and specific explanatory text. Completion still requires
independent exact-candidate checks and original requirement review. A moved branch
blocks completion and preserves newer commits; it is never force-updated.

## Provider health

Provider and model health are independent and project-scoped. Identity includes a
credential fingerprint and endpoint, never the credential value. Health is
persisted in the task journal and restored on worker restart.

- HTTP 401 is credential authentication failure; HTTP 402 requires quota/access
  configuration. Both block the key's routes.
- Discovery HTTP 403 blocks that key's discovery and routes. A model-specific 403
  blocks that model, preserving other models and providers. These are not assumed
  transient and are not automatically retried on a timer.
- HTTP 404 marks the unsupported model unavailable.
- Rate limits, server errors, timeouts and invalid envelopes open temporary
  circuits with bounded exponential backoff. `Retry-After` seconds or HTTP dates
  are respected; daily quota indications retain their next-day eligibility.
- A due circuit permits a controlled half-open probe. Success closes it; failure
  extends backoff. A healthy provider remains eligible while another waits.
- Final request-size/schema rejections are fingerprinted separately. An identical
  rejected request is skipped, while a smaller request remains eligible immediately.

Changing a credential or endpoint creates a new configuration identity. For a
legitimate permission fix using the same key, the owner can update the trusted
project's `providerConfigRevision` to explicitly authorize re-verification. The
engine never increments that revision, rotates identities to evade restrictions,
or fabricates permissions. Provider errors cannot authorize GitHub writes.

## Durable cooldown-aware scheduling

`.github/workflows/recovery.yml` runs server-side every fifteen minutes, subject to
GitHub scheduling delays. Neither the app nor a personal device must stay online.
`nextAt` is at least five minutes away and at least thirty seconds after the
provider's earliest eligible retry. This timestamp survives serialization, error
wrapping, process restart and interrupted-worker reconciliation. Waiting queue
scans do not reserve a continuation or consume one of the three deliveries.
Healthy alternatives are tried before exhausted routing is deferred.

Waiting defaults to six hours per recovery episode, bounded by authorization
expiry with a twenty-minute safety reserve. A validated new candidate is meaningful
progress and starts a new episode; cumulative task budgets remain. A deadline,
missing scheduling infrastructure or unavailable project access produces a
truthful paused/blocked state with the exact action needed to resume.

Atomic refs reserve task/authorization/sequence IDs. Dispatch state is saved before
delivery and continuation tokens are consumed once. Active workers are not
restarted; explicit cancellation stops automatic resumption. A branch saved before
its PR was created can recover that original draft. Closed PRs are not reopened,
and test-dispatch-only interruptions resume checks rather than regenerating code.

## Registered projects and access

`config/projects.json` registers KappaForge, OmniPC and Apk-revival independently.
Each entry has enabled state, branch policy, credential environment name, waiting
limit, budgets and release restriction. Optional `providers` narrows the owner's
approved free code providers, and `providerConfigRevision` controls intentional
health re-verification. Registration is capability configuration, not permission
to start tasks. An open, unexpired owner task must name that exact repository.

KappaForge uses its existing repository-scoped Actions token. External projects
require `KAPPA_CODER_TOKEN` with access to **that project**. Before queueing or
resuming, the engine checks exact repository identity and write permission using
the configured credential. Missing registration, access or permitted branch blocks
execution. Scheduler access is explicitly wired to the same existing secret; no
new credential is created or expanded by this change.

Task histories and failure ledgers match project and task digest. Branch writes
retain task-specific names and cannot target another project or main. Candidate
code still runs in the existing isolated, credential-free project test job.
Deployment, administration, destructive actions and release permissions are not
inferred from project registration. No queue path merges or releases a PR.

## Defensive API and stream handling

Provider responses must have valid object/list shapes and string fields before
nested access. Invalid JSON, nulls, arrays, malformed metadata, empty candidates,
invalid tool-call envelopes and truncated completions become typed provider
failures. Healthy alternatives can answer. Tools are not executed merely because
a model returned a tool-call envelope.

The Worker adapters apply shape validation to chat and stream chunks. The existing
incremental wire reader handles split bytes and incomplete frames. Stream errors
preserve already emitted text, record one failed attempt and emit a controlled
error; requests are never replayed after visible output. Output-limit truncation
is not reported as verified completion. These backend changes require deployment,
not a new native app installation.

## Validation and remaining limits

Deterministic tests cover all seven audited failures, including hundreds of Unicode
history entries, rollback, catalog references, persistent failure fingerprints,
HTTP classifications, discovery quarantine, key changes, controlled probes,
backoff, former retry boundaries, cumulative counters, cooldown scheduling,
deadlines, authorized external-project resumption, denied access, project
isolation, malformed responses, request shrinking, and truncated streaming.
Existing tests retain cancellation, authorization expiry, stale edits, duplicate
paths, interrupted dispatch and concurrent branch protection.

The controlled end-to-end fixture reproduces two malformed proposals followed by
a routing deadline, generates a valid change, runs its real behavioral assertion
before and after implementation, checkpoints through the real commit path and
resumes that exact candidate without duplicating its PR. API boundaries are faked;
this is not a successful live weather run or proof of live external token access.

GitHub API availability and scheduling are external dependencies. Comments are a
bounded storage backend, not an unlimited database; inspection remains bounded to
2,000 comments per task. Irreducible execution-critical state beyond supported
storage must pause with the previous valid checkpoint. No system can prevent
providers from denying access or guarantee arbitrary generated program correctness.
PR #133 and task #130 are neither restarted nor declared complete by these tests.

The dependency map now dictionary-encodes paths as schema 3 to retain every real
import/test edge within the existing 6,000-character chat allowance. The Worker
reads it as context text, so no client migration or native dependency changes.

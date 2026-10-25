# Phase 1 Step 7: free execution admission

`engine/infrastructure.py` admits only the existing public KappaForge Actions workflows and runner-local Docker.
It has no provisioning, subscription, spending-limit, hosting or billing-write API. Existing zero-dollar inference
guards remain in place; this change does not enable premium rescue or add a model route.

## Before allocating independent checks

Every engine GitHub workflow dispatch passes the existing owner/task permission guard, then a separate cost guard.
The guard reads the current execution repository and workflow metadata, resolves the reviewed ref, fetches the workflow
at that exact revision, compares it with this engine's checked-in workflow and rechecks that the ref did not move.
It accepts only the existing agent, sandbox, project-test, review-graph and native-iOS workflows, with their literal
`ubuntu-latest` or `macos-15` jobs. Dynamic runners, larger/self-hosted runners, reusable job workflows, added job
services/containers and unreviewed workflow/ref changes stop the dispatch before its POST. Existing task/branch/input
restrictions and GitHub's actual token write-permission checks still apply.

The execution repository must currently be public, enabled and unarchived. Private-repository minute balances are
not treated as a safe reservation: concurrent jobs can exhaust them and become billable. Unknown or inaccessible
metadata stops admission instead of guessing that capacity is free. This also stops automatic recovery from
allocating another job when the execution repository no longer satisfies the policy.

The free classification follows GitHub's documentation for
[standard public runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
and [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Queued jobs are not proof that a runner is available. No code changes account billing settings or buys capacity to
resolve a queue or an API failure. The existing workflows remain reviewed code; this is not a sandbox for arbitrary
new workflow programs or third-party actions. It cannot make GitHub ref/visibility changes atomic with dispatch.

## Jobs the chat Worker starts

The Cloudflare Worker (`chat-backend/src/free-execution.js`) starts and re-runs Actions jobs without the engine:
task launch and retry, owner guidance, Fix it, Run tests, Validate, Undo's test run, the durable recovery wake-up
and the Actions panel re-run buttons. Each one now reads live metadata first and dispatches nothing unless:

- the repository is the active, unarchived, public `onlykappa/KappaForge` (or, for a re-run, the public owner
  repository the run belongs to);
- a dispatched workflow is in the same reviewed allowlist the engine uses (read from
  `config/execution-infrastructure.json`) and GitHub reports it enabled; a dispatch always targets `main`;
- every job of a run to be re-run reports exactly one standard GitHub-hosted label. Larger runners (custom names,
  `*-large`, `*-xlarge`) are billed even on public repositories, and self-hosted machines are not a reviewed sandbox.

A refusal returns HTTP 409 with `code: execution_resource` and the failed condition. A request that would start more
than one workflow checks all of them before the first dispatch, and task launch checks before creating the issue or
debiting the daily run budget, so a refusal leaves nothing behind. Cancelling a run allocates nothing and needs no check.

The recovery wake-up treats a policy refusal as a stop, not a delivery failure: the queued row is marked
`free_execution_unavailable` with the reason (shown by its status), and no further delivery is attempted. Scheduling
recovery again after correcting the condition rechecks it. A GitHub outage (network error, HTTP 5xx or 429) still
dispatches nothing; it takes the existing bounded retry and counts toward the three-delivery limit.

The engine applies the same rule to re-runs: `authorize_dispatch` refuses the run and job re-run endpoints, because a
re-run repeats the original run's runners and ref, which admission cannot pin. The engine only dispatches.

## Every workflow's runners

Most workflows are not dispatched by KappaForge at all; they run on push, pull request or schedule. CI
(`python3 scripts/execution-policy.py --check` in the tests workflow) now also checks every workflow file, so no
job anywhere can move onto billed capacity unnoticed. Each job must declare exactly one literal standard
GitHub-hosted label; a larger runner, an expression, a list or group, or a reusable workflow job fails the check.

## Before sandbox execution

The agent code job runs a non-allocating preflight before model work; its existing `actions: write` permission lets
it read its own runner metadata. Each sandbox preparation/command, including
one with a cached image, rechecks the current repository and the actual running job in the current run attempt.
The job must be a GitHub-hosted Linux job with the standard `ubuntu-latest` label, matched by its runner identity.
An already completed command restored from its exact receipt needs no infrastructure allocation or repeated command.

Docker is forced to `unix:///var/run/docker.sock`. A remote/custom `DOCKER_HOST` or context is rejected. The CLI uses
an empty temporary configuration and receives neither the runner's home nor Docker/BuildKit environment settings,
so configured credential helpers, remote contexts and builders cannot silently select another service.

Admission reads the live local daemon report, available host memory and free disk at the daemon's storage location.
It requires a Linux daemon with memory, swap, CPU quota, PID and seccomp enforcement. Requests must stay within the
existing profile ceilings: 2 CPUs, 2 GiB memory, 256 PIDs, 1 GiB workspace, 512 MiB temporary space, 900 seconds and
200,000 output bytes. Before image preparation it requires 4 GiB free disk; subsequent operations require 1 GiB.
Available memory must exceed the profile's limit by at least 512 MiB. These checks measure current headroom; they do
not reserve it. Existing Docker hard limits, per-command deadlines, network policy and cleanup still apply.

## Failure and recovery

Denied admission raises a terminal `execution_resource` error with the failed condition and a concrete next action:
restore read/daemon permissions, use the existing standard runner, wait for capacity, restore required isolation
controls or remove a remote Docker configuration. The controller preserves its exact candidate checkpoint and marks
execution/final validation blocked. It does not invoke a repair model to fix infrastructure or automatically retry
with different hosting. A later authorized retry rechecks the original workspace and current infrastructure.

Paid features are never a fallback. Free model routes keep the existing $0 inference guard; the owner-approved premium
smoke test runs only from a branch the engine's scope cannot write. Cloudflare and GitHub plans, spending limits and
billing settings are never read or changed by code; activating paid capacity remains a manual owner decision.

Only bounded, nonsecret admission evidence (repository/run/job, label, timestamps and numeric resource measurements)
is retained. Tokens remain in the privileged engine and never reach a container. GitHub failures report their class,
not response bodies or private credential/environment values. No production model or hosting activation is required
to test rejection paths.

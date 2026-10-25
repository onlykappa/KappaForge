# Gateway resource recovery — P3-014

Run [40236351384](https://github.com/onlykappa/KappaForge/actions/runs/40236351384) received platform error 1102 during finding verification. [Cloudflare documents](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/) this as Worker CPU/memory exhaustion. The response has no profile identifying the expensive operation. A smaller request may reduce work; it is not proof of an optimized Worker or a guarantee against platform failures.

The confirmed controller defect was that only code generation handled the existing `shrink_context` signal. Verification treated it as a provider outage, handed off the task, and could reconstruct the same expensive request. The handoff itself now uses the correctly pinned engine, as demonstrated by run [40237385743](https://github.com/onlykappa/KappaForge/actions/runs/40237385743).

## Recovery contract

- Name the error `worker_resource_limit`; do not report it as exhausted provider quota.
- Save a task-local prompt envelope at two thirds of the failed request's UTF-16 character count, including the task-state/role envelope. Persist it in the existing journal; every later prompt fit check observes it.
- Rebuild scope, requirement and finding prompts by reducing source/diff context. Never cut the completed prompt, owner request or findings list. Partial evidence stays partial and all existing literal-evidence and owner-goal checks remain required.
- Allow at most three resource reductions per review controller. Calls still cross the existing model-call, identity and deadline boundaries; this grants no additional inference budget or provider access.
- Fail closed if the fixed instructions cannot fit or bounded adaptation is exhausted. Report the review as unverified and stop identical automatic continuations. Further gateway diagnostics or a separately authorized infrastructure correction may be necessary.
- Apply the learned envelope across recovery; do not confuse it with a model context window or verified provider capacity. It is a conservative task-local response to an observed failure.

## Evidence and limits

The new regression module tests recovery in each review path, durable envelope selection, bounded exhaustion, exact owner/finding retention, insufficient fixed context, ordinary outages, pinned terminal errors, invented evidence and candidate movement. The original source/finding-count/shape gates remain in place. Counts and commands are recorded in the [issue ledger](issue-log.md).

No Worker deployment, paid hosting, paid inference or plan change is included. No production CPU/memory measurement or permanently eliminated platform error is claimed. The live retry must establish whether this adaptation clears the observed blocker. Phase 3.1 remains incomplete until its actual audit evidence is saved, validated and reviewed.

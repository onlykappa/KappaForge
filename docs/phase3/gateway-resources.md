# Gateway resource recovery — P3-014

Run [40236351384](https://github.com/onlykappa/KappaForge/actions/runs/40236351384) received platform error 1102 during finding verification. [Cloudflare documents](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/) this as Worker CPU/memory exhaustion. The response has no profile identifying the expensive operation. A smaller request may reduce work; it is not proof of an optimized Worker or a guarantee against platform failures.

The confirmed controller defect was that only code generation handled the existing `shrink_context` signal. Verification treated it as a provider outage, handed off the task, and could reconstruct the same expensive request. The handoff itself now uses the correctly pinned engine, as demonstrated by run [40237385743](https://github.com/onlykappa/KappaForge/actions/runs/40237385743).

## Recovery contract

- Name the error `worker_resource_limit`; do not report it as exhausted provider quota.
- Save a task-local, routing-role-specific prompt envelope at two thirds of the failed request's UTF-16 character count, including the task-state/role envelope. Persist it in the existing journal; later fit checks for that role observe it. An observed verifier envelope is not a proven coding limit.
- Rebuild scope, requirement and finding prompts by reducing source/diff context. Never cut the completed prompt, owner request or findings list. Partial evidence stays partial and all existing literal-evidence and owner-goal checks remain required.
- Allow at most three resource reductions per review controller. Calls still cross the existing model-call, identity and deadline boundaries; this grants no additional inference budget or provider access.
- Fail closed if the fixed instructions cannot fit or bounded adaptation is exhausted. Report the review as unverified and stop identical automatic continuations. Further gateway diagnostics or a separately authorized infrastructure correction may be necessary.
- Apply the learned envelope across recovery; do not confuse it with a model context window or verified provider capacity. It is a conservative task-local response to an observed failure.

## Evidence and limits

The new regression module tests recovery in each review path, durable envelope selection, bounded exhaustion, exact owner/finding retention, insufficient fixed context, ordinary outages, pinned terminal errors, invented evidence and candidate movement. The original source/finding-count/shape gates remain in place. Counts and commands are recorded in the [issue ledger](issue-log.md).

No Worker deployment, paid hosting, paid inference or plan change is included. No production CPU/memory measurement or permanently eliminated platform error is claimed. The live retry must establish whether this adaptation clears the observed blocker. Phase 3.1 remains incomplete until its actual audit evidence is saved, validated and reviewed.

## Hard request cap and capacity diagnostic — P3-016

The engine now enforces 20,000 UTF-16 characters per complete request, including added task-state context, on integrated and direct routes. Advisory project guidance and source context are reduced before this boundary; fixed owner instructions that cannot fit cause a local refusal without inference. Production requests keep this cap regardless of diagnostic outcomes.

The manual `prompt-probe` action uses the existing authenticated gateway, the approved free Groq provider, and synthetic prompts from 20,000 through 50,000 characters in 5,000-character steps. It isolates diagnostic execution from task classification and leaves 65 seconds between samples. It stops on the first failure, retaining allowlisted failure metadata; other sizes are NOT RUN. Generated text, credentials and route identifiers are omitted. Its process-local engine-cap override is restored after execution and does not alter deployed policy.

Successful samples establish only that those particular requests passed. They do not establish a universal character maximum, a stable route, or representative source-code token density. A non-resource failure is inconclusive about Cloudflare CPU. The existing Groq free-request envelope is 8,000 estimated tokens; with a 64-token response and 256-token guard reserve, the router estimate can admit up to 26,880 prompt characters before this configured budget rejects larger samples. Per-model limits can tighten this further. The probe does not raise or bypass those limits.

Initial live [run 40264719610](https://github.com/onlykappa/KappaForge/actions/runs/40264719610) on `50bd96b`: 20,000 passed, 25,000 returned `free_route_unavailable`, and later samples did not run. That version lacked detailed failure output, so cooldown, truncation or another upstream failure cannot be distinguished retrospectively. Follow-up results belong in the issue ledger.

Corrective [run 40265304398](https://github.com/onlykappa/KappaForge/actions/runs/40265304398) at `9490364`: 20,000 and 25,000 passed; 30,000 was refused by the gateway's configured context guard (HTTP 413, attempted=false). The job stopped with exit 1. Larger sizes did not run because the same free-token budget excludes them. All task jobs were skipped. This supports the existing 20,000 engine cap for the tested sample and confirms isolation; it does not prove future task success or a Cloudflare CPU maximum.

## Fitting structured finding reviews — P3-018

Live run `40266931947` showed that a request below the 20,000-character cap can still receive 1102. Its learned 12,720-character verifier envelope could not fit the original fixed payload, which duplicated owner text in a requirement list. The verifier now carries the complete owner request once and maps requirement IDs to exact Unicode-character spans. Full engine-side owner/source proof checks remain unchanged; request references do not grant authority.

The orchestrator subdivides a resource-blocked four-finding batch into two, then one, over the same owner/candidate/source snapshot. It never raises the saved envelope, discards a finding, returns partial authorization after a later failure, or sends an available-source-free batch to manufacture a fit. A single finding that cannot fit still stops. The existing direct-pass 12-finding limit, 96-finding total limit, durable model-call budget and freshness checks remain. This controller correction does not establish the production Worker's CPU hot spot or guarantee that subsequent requests will pass.

## Smaller-load trial — P3-015

Run [40238533997](https://github.com/onlykappa/KappaForge/actions/runs/40238533997) recovered from 1102: its finding request shrank from 37,671 to 24,708 characters, and four subsequent verifier requests succeeded. The next repair stopped before inference because the task-global hint incorrectly capped its fixed project/owner instructions. No audit commit was saved.

The owner requested smaller batches and a measured trial before choosing a sweet spot:

| Allocation | Previous | Trial |
| --- | --- | --- |
| Findings per orchestrated verification call | Up to 12 | Up to 4 |
| Output tokens for four-finding verification | 3,500 ceiling | 1,600 ceiling |
| Source characters for four-finding verification | 14,000 ceiling | 9,000 ceiling, reduced further if necessary |
| Confirmed targets per repair round | Entire confirmed list | Up to 3 |
| Focused repair source/file characters | General generation allocation | 20,000 / 6,000 ceilings |
| Focused repair output tokens | General generation allocation | 4,096 ceiling, including fallback |

Fixed owner/project instructions remain verbatim; source allocation is not total request length. All 96 permitted findings can still be assessed in at most 24 four-finding calls instead of eight twelve-finding calls. Existing total model-call budgets and deadlines still apply. A failed/stale verification batch cannot return partial repair authorization.

Deferred repair claims remain in the open-problem list even when a reviewer omits them. The next repair must reverify current evidence. Successful source proposals pass through the existing checkpoint callback and final validation/publication gates. Queue IDs are diagnostic, not reusable edit permission. This does not claim unvalidated interrupted proposals were published or all findings fit the remaining durable budget.

Legacy global envelopes migrate only when recorded 1102 evidence identifies their role; migration is saved before history eviction. Without provenance the old restriction stays conservative. No hard request/context, platform or provider limit is raised.

Compare actual calls, token usage, elapsed execution, resource errors, request sizes and saved/validated progress on the next run. Smaller requests may increase total calls. No sweet spot or overall usage reduction is proven yet. Model settings remain as selected by the owner; a concurrent model change also prevents attributing differences solely to batching.

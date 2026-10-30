# Owner decision register

Audit snapshot: 2026-10-30 UTC. Default branch `main`, commit `19c95923d12156688487fd8d4e1f6dd1c16eefa6`. Documentation-only branch `audit/autonomy-2026-10-30`. No inference requests, workflow dispatches, merges, releases, deployments or production configuration changes were made by this audit.

Evidence labels: VERIFIED = directly observed implementation or execution (the evidence specifies which); PARTIAL = implementation exists with material limits; BROKEN = observed failure or deterministic incorrect behavior; MISSING = no implementation found in the inspected execution surfaces; UNVERIFIED = insufficient execution/access evidence; NOT APPLICABLE = outside the declared supported scope. Source verification is not production verification.

This register proposes choices for later implementation. No choice below is needed to read or accept the audit; none grants authority to execute fixes, dispatch live tasks or spend money.

| ID | Decision | Recommended default | Tradeoff / owner action | Blocks |
|---|---|---|---|---|
| D01 | Supported vNext product scope and acceptance thresholds | First reliable coding/docs/files; add browser/office only after serial gates | Approve task classes and milestone thresholds in07; broad scope costs more evaluation | Final100% definition, F/H |
| D02 | Five meaningfully different recovery strategies | Default5 causal strategies; transient waits separate; tighter authority/unsafe stops | Confirm per-category time/request budgets, not unlimited retries | D |
| D03 | Durable event journal home | Reuse existing Cloudflare DO storage; issue comments become export/projection | Atomic sequencing versus implementation/migration effort; optional object storage only if needed | C |
| D04 | Compute | Existing ephemeral Actions/Docker first; no always-on server | Cold-start/time limits; approve optional browser/remote compute only after workload need and cost estimate | C/F |
| D05 | Model cost policy | Free first; premium OFF by default; paid OpenRouter only explicitly enabled last resort | Quality/availability/context limits remain real; do not promise flagship outcomes on exhausted free routes | E/H |
| D06 | Privileged workflow changes | Draft edits may be proposed; execution with secrets requires explicit workflow approval | No-merge alone is insufficient protection; validate trusted orchestration before candidate refs | A/035 |
| D07 | Merge/deploy/release | Keep exact owner approval for each consequential operation | Historical repository prose does not supersede current request; verify protected environment gates | A/036,039,053 |
| D08 | Browser/app/local access | Optional adapters, per-domain/workspace/service grants, read-only first | Local files require companion; web login requires delegated test credentials; no unrestricted Worker shell | F/G |
| D09 | Retention | Proposed90d detailed execution receipts,30d bulk logs, owner-controlled chat, explicit erase | Project decisions retained until deletion; GitHub public task privacy is separate from vault encryption | C/E |
| D10 | Current production evidence | Owner provides sanitized effective provider permissions, Worker SHA/policy hash, environment approvals and token scope descriptions | No secret values needed; can be gathered with read-only endpoints/settings |019,021,039,052 |
| D11 | Independent evaluation execution | Approve a finite free-live request/time budget and disposable accounts after offline harness passes | No inference was initiated by this audit; no paid activation implied | H |
| D12 | Real device/native acceptance | Run existing simulator and physical iPhone keyboard/accessibility cases | Linux cannot establish actual iOS UI behavior; preserve existing failing assertion |043,046,051 |
| D13 | Parallel execution | Defer beyond read-only research/test roles until serial reliability proven | More workers multiply quota use and reconciliation risk; no reason for a default swarm | G |
| D14 | Active branch ownership | Triage six open PRs and273 retained branches; mark obsolete baselines | Avoid continuing closed/superseded goals and calling duplicate patches progress |009,057 |

Owner review should approve a concrete implementation scope/PR plan next, not blanket production authorization. The critical foundation can be built and tested without buying infrastructure or enabling paid models. Costs cannot be assumed zero merely because Actions/model tiers are called free; account quotas and pricing must be verified before a sustained benchmark.

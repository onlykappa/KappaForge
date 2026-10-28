# Phase 3.1c — recovery and task controls

Source inspection recorded 2026-10-28 UTC. The inspected backend files are identical at PR #279's frozen `f5501afe417a63c4ebc089954d99968ef4e55bb0` and accumulator baseline `a81709303ec30089ae95bba38b300e2735955788`. Corrections below are delivered through #309, leaving #279 unchanged. All new reproductions use fake external transport; no live task, cancellation, merge or deployment was requested.

## Recovery delivery

`index.js` authenticates `/router/recovery` with ROUTER_ACCESS_TOKEN, separately from the owner chat credential. Its input selects only a positive task number and status inspection, never an arbitrary workflow or ref. `recovery-wake.js` requires an open owner-authored, labelled issue, develop mode and a valid repository descriptor. Chat authorization must be unexpired, uncancelled and bound to that issue through the authorization store. Direct GitHub tasks retain the original issue deadline.

Journal inspection is bounded to ten pages of 100 comments. Only bot checkpoints with matching task, repository, authorization identity and exact body digest (or their explicit renewal link) qualify. An unmatched conflicting checkpoint is refused. Only waiting, dispatching, running and recovering states qualify; completed and engine-pinned states do not fall back to an older engine.

Delivery preserves cooldowns, checks active runs, limits the queue to 32 entries and the waiting window to six hours or scope expiry, and allows at most three delivery/GitHub failures. A delivery is debited before HTTP dispatch. Admission checks public active repositories and reviewed standard hosted capacity. Dispatch selects fixed recovery.yml on main with only the issue number. The Python controller still enforces the saved scope, candidate and continuation authority. A dispatch acknowledgement is not proof that execution started. Existing premium billing alarms are preserved; these paths do not activate premium capacity.

The inspected recovery.yml has bounded runtime and global recovery-dispatch concurrency without cancellation. Main is the normal source; its explicit owner/task-branch exception is checked separately. The scanner runs engine.recovery and does not execute candidate code. The five-minute schedule is best-effort. No workflow was changed in this repair.

## Retry and guidance

Owner access authentication and immutable path/payload/conversation claims precede `/jobs/retry` and guidance operations. `agent-work.js` checks a positive task number, owner/open/label eligibility and its repository. Fresh renewal preserves original mode, repository, text and restrictions, binds the grant to that issue and keeps allowMerge false. Expired authority requires a fresh owner grant. Guidance is bounded to 1,500 characters and posted under a fixed prefix; it does not rewrite the original scope. Existing PRs enter the fix path; tasks without a PR join eligible recovery or dispatch a fixed main workflow. API acceptance alone does not prove a worker started.

P3-057: renewing a directly created GitHub task omitted its `github-task:N` checkpoint identity. The new cross-language regression runs production JavaScript renewal and production Python Scope/Journal restoration. Before repair the direct-task case fails with a changed-scope refusal. Renewal now links that identity and the exact previous body digest; existing chat identities are preserved. Tests retain candidate, events, continuation state and nonzero model/edit/fix budgets, and deny missing fresh authority.

P3-058: wake delivery matched header spelling more narrowly than the Python engine. Header names now match case-insensitively, while mode and registered repository values remain case-sensitive. Ambiguous descriptors are rejected. Mixed-case direct/chat renewal and wake tests initially failed; after repair they pass alongside duplicate-mode, wrong-value and foreign-repository refusal controls.

## Cancellation

The Worker persists revocation before delivering the remote stop. Conversation-bound lookup and capability validation remain required. `task-cancellation.js` closes the task and inspects at most three pages of 100 runs, using exact task-title boundaries and an agent/recovery workflow allowlist. A cancellation request or HTTP acknowledgement is not termination. Termination requires a complete, nonempty observed set whose runs are all completed; evidence explicitly says observed runners only. This does not identify every unrelated scheduled process.

P3-059: filtering by a newly issued grant's timestamp omitted older active attempts of the same task and could falsely report termination. Removing that time filter retains the stable task identity, workflow allowlist and bounded inspection. The regression initially reports termination with an old agent still active; after repair it requests that run's cancellation and waits for completion, excluding another task and unidentified scheduled runs.

P3-060: an explicit second cancel was always treated as read-only replay, including after failed delivery or revocation persisted before a receipt. Explicit cancel now retries only failed or unconfirmed delivery. Status polling remains externally read-only, acknowledged stops are not blindly repeated, and cancelled grants cannot execute jobs. Stateful Worker/store regressions initially fail after HTTP 503 and cover the interrupted-delivery case; both pass after repair. Partial remote failures remain recorded rather than restoring execution authority. A follow-up regression reproduced successful status polling erasing a prior delivery failure and suppressing retry; polling now retains deduplicated errors until explicit stop delivery is retried.

## Actions controls

`/actions/control` requires owner authentication and a claimed, confirmed user-control request. `actions.js` restricts controls to fixed run endpoints, validates numeric run identity and owned repository, and requires the job token for writes. Reruns require active public repository metadata and complete job inspection with recognized standard hosted runner labels. Cancellation allocates no capacity. HTTP 202 means requested, not started or stopped. These checks do not establish separate future Phase 3.7 release grants or validate the semantics of every owner workflow.

## Executed verification and remaining work

Immediate focused verification: 98 Python tests passed, zero skips; 146 Node tests passed, zero skips. The Python subset covers renewal, journal recovery, Phase 2 audit repairs and intent guards. The Node subset covers recovery wake, task management, Actions, intent guards, capability registry and free execution.

Final broader commands:

```sh
PATH=/workspace/kappaforge-venv/bin:$PATH python -m unittest discover -s tests
npm test
ast-grep test --skip-snapshot-tests
python scripts/execution-policy.py --check
python scripts/dependency-map.py --check
```

Full Python discovery: 1,164 run, OK, 31 skipped. Full Node suite: 880 passed, zero failures/skips. Ten structural-rule tests, source scan, execution-policy, dependency-map and whitespace checks passed. Source-scan warnings remain inspection evidence, not security clearance. The follow-up cancellation/status regression also passed within a fresh full Node run (880 passed, zero skips); the Python source is unchanged by that follow-up. Delivery CI is pending on the committed repair head; local tests do not demonstrate production credential distribution or a live owner interaction.

This completes the bounded source traces of the recovery-wake, retry/guidance, cancellation and Actions backend paths. Remaining workflow mutation inventory, combined-delivery validation, finding reconciliation and #308's automated source-proof acceptance still prevent Phase 3.1 closeout. No Phase 3.2 work or owner acceptance is claimed.

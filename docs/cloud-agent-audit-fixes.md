# Cloud agent audit fixes

The 2026-10-19 audit covered the agent, its workflows and the Worker at `28f5450`.
These fixes change server behavior; no bundled web assets or native files change.

| Audit finding | Change | Regression coverage |
| --- | --- | --- |
| Incomplete PRs could merge | Both promotion paths reject incomplete requirement verdicts, including older drafts | Python completion gate and Worker merge tests |
| Self-review forgot unresolved work | Keep failed stages and previous review findings through unavailable reviews; require a nonempty review and a regression test before completion | Python review outage and unrelated-change test |
| Cancelling a joined task stopped nothing | Bind each duplicate submission's authorization to the existing task; compare complete request text | Worker duplicate and cancel integration |
| Passing but unfinished PRs could not be fixed | Expose Fix it for incomplete requirements; recheck the task and persist a fresh verdict before rerunning CI | Worker eligibility and Python requirement-repair integration |
| Long edit diagnostics missed the mismatch | Locate the differing region beyond a shared prefix and encourage small exact anchors | Python 4,000-character edit regression |
| Expired retries reported false starts | Renew original task scope only from the fresh user capability, reset merge authority, and bind cancellation before dispatch | Worker expiry renewal integration |
| Invalid provider JSON stopped fallback | Record the failed attempt and try the next route; malformed planner JSON also retries | Worker malformed JSON and invalid-shape tests |
| Chat reported old tests on revised PRs | Require the current commit SHA and trusted dispatched workflow identity | Worker old/current SHA comparison |
| Invalid planner title called a missing helper | Derive a fallback title from the actual request | Worker empty-title integration |
| All-blank messages crashed validation | Reject an empty filtered conversation and invalid root JSON | Worker input validation |
| Continuous audits read without authentication | Bind source reads to the repository's authorized read token | Python authenticated source-read test |
| Audits restarted when main changed | Resume the original immutable checkpoint commit | Python moving-main audit integration |
| Project map evidence used a mutable branch | Read every source file at the reported SHA | Python map snapshot test |
| Activity updates kept stale timestamps | Advance updatedAt for live model/recovery events without ending the current step | Python activity timestamp test |
| Legacy repair rejected large allowlisted source | Use bounded exact edits and syntax validation, pin source, retain the path allowlist and dispatch independent tests | Python large-source repair and unauthorized-path test |

Verification verdicts use a backward-compatible `KAPPA_REVIEW_V1` marker on the
PR. A missing model review is incomplete verification. Existing legacy incomplete
titles remain blocked until a new review is saved. Fresh retries preserve the
original repository, mode and task text; renewal does not grant automatic merge.

A running agent retains its checked-out engine. Deploying the Worker does not
rewrite that checkout or clear the app's conversations, settings or task history.
A subsequent run uses the merged engine. Existing incomplete PRs can use Fix it
when their checks stop running; a failed task without a PR can be retried. Resetting
or deleting a task is not required to obtain these fixes.

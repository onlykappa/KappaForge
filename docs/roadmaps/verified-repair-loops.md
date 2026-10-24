# Verify findings before repair and stop stagnant repair loops

Owner requested a separate PR while reviewing #223. This branch is stacked on
`fix/task-221-goal-scope`; #223 is not modified or merged by this work.

## Scope

- Independently try to disprove model/repair findings before they can cause edits.
- Classify each as confirmed, rejected or needing validation. Check literal current
  source evidence and relevance to the unchanged owner request. Missing proof must
  not become a coding task, and rejected claims must not mark requirements complete.
- Fingerprint actual repair source/evidence, detect repeated and alternating
  attempts, and allow one bounded independent loop review. CI waits are excluded.
- Bind decisions to task, goal and candidate; reject stale results. Preserve the
  existing model-call, recovery and authorization budgets.
- Persist bounded diagnostic hashes/decisions rather than source or reusable
  edit permission. Surface the distinction in shared task state.

## References

Architecture patterns only; no upstream implementation is vendored:

- [Cloudflare finding validation](https://github.com/cloudflare/security-audit-skill)
- [Cindy loop guard](https://github.com/makecindy/cindy/blob/main/packages/maker-core/src/agents/shared/loop-guard.ts)
- [Cindy loop review](https://github.com/makecindy/cindy/blob/main/packages/maker-core/src/agents/shared/tool-loop-review.ts)

## Verification plan

Exercise invented/out-of-goal findings, real defects, missing/malformed evidence,
stale candidate/goal results, repeated and alternating repair cycles, genuine
source progress, loop-review failure, bounded continuation and recovery restore.
Run the existing full task/lifecycle simulations and Python/Node suites. Do not
execute third-party target code or add Cloudflare/Cindy runtime dependencies.

## Delivered behavior

`engine/repair_guard.py` supplies a fresh verification call before source repairs
driven by review findings or failed-check diagnostics. A confirmation needs an
exact owner-request fragment, current-source quotes, and an in-goal decision.
Unknown, missing, malformed and foreign decisions cannot authorize edits. Rejected
findings may trigger one new requirement review, but never mark a requirement met
on their own. If only part of a batch is confirmed, only that subset reaches the
coding prompt. Literal comment goals retain #223's stronger deterministic guard.

The loop monitor hashes source and finding evidence, independent of commit SHA
churn or finding prose. Three identical attempts or an alternating four-attempt
cycle trigger one fresh review. Continuing requires a concrete different approach
that is forwarded to generation; repeating the same evidence again stops. Ordinary
CI polling, waiting and pre-verification provider outages create no repair attempt.
The existing deadline, model-call, edit and authorization limits still apply.

Candidate/goal/source movement invalidates late results. Same-task recovery can
restore bounded loop hashes and the spent review allowance. Saved finding decisions
are diagnostics only and are never reused as edit permission. Persistent metadata
does not include source quotes or free-form model reasoning; the live task packet
labels finding/loop assessments as model judgments rather than completion facts.

This implements source-backed semantic verification, not a general proof that a
finding is correct. Independent tests and owner review remain required. A verifier
that cannot establish evidence can leave a legitimate repair incomplete rather than
guessing; its diagnostics explain that distinction.

Local validation: all 580 Python tests passed with five existing Docker/tooling
skips; all 822 Node tests passed. Nineteen new regressions exercise the guard and its
real shared inference boundary, plus the existing end-to-end recovery simulations.

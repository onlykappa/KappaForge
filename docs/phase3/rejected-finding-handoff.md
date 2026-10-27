# Preserve source-bound rejections across review stages

Run [40468208341](https://github.com/onlykappa/KappaForge/actions/runs/40468208341)
finished its code job successfully with 11 gateway calls (ten verification, one
review), but PR #284 still reported incomplete requirements. Its source head was
unchanged. Green execution did not establish checkpoint completion.

The repair verifier disproved old provenance findings, then discarded those
decisions when handing the unchanged candidate to the whole-task reviewer.
Separately, the historical UNFINISHED list retained disproved claims whenever
another requirement remained unresolved. This caused repeated verification and
stale problem lists.

An all-rejected, no-failed-CI repair pass now carries its current owner/candidate/
source stamp and sanitized rejection feedback into whole-task review. The stamp
must still match; edits cannot reuse these earlier decisions. Only exact rejected
claim IDs, whose full original claim was shown, are retired from historical unfinished problems. Current review
findings, original requirements and unresolved process gaps remain active.
Changed source or newly read dependencies invalidate retirement and feedback.
No rejection directly marks an owner requirement met: fresh requirement review
and all mandatory validation still decide completion.

The same controlled replay on main
`bea4888df10e8d49dab58d71b532bcd92afb532f` and the patch exercises actual finding
verification, review and inference-boundary code with scripted responses:

| Handoff workload | Baseline | Patch |
| --- | ---: | ---: |
| Gateway adapter calls | 4 | 2 |
| Verification calls | 2 | 1 |
| Whole-task review calls | 2 | 1 |
| Review completed | Yes | Yes |

This is a replay with zero live HTTP calls, not a claim that the production
checkpoint completed. Regressions also preserve a different unmet requirement
and process gap while removing a rejected historical claim, reject stale source
stamps, and retain current-source evidence checks. Effort/provider/Worker limits
and cumulative counters do not change. Output PR #284 stays draft and task #282
stays restricted to checkpoint 3.1a.

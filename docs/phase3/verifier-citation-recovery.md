# Verifier citation recovery — task #282

Run [40439475656](https://github.com/onlykappa/KappaForge/actions/runs/40439475656)
stopped in repair finding verification, before generation. Both saved decisions
were downgraded to `needs_validation` with `no_literal_source_evidence` and
`evidence:lines_not_shown`. This was not a gateway CPU failure. Candidate
`b3271f17237320bf6859f902e6e69f7c3029dada` was retained; no new document was published.

The old diagnostic groups invalid, oversized and omitted citation ranges under
the same code, and does not retain raw citations. It cannot establish which range
each model supplied. Code inspection and regression tests establish two recovery
gaps: malformed line ranges did not receive the protocol retry used for malformed
citation objects, and real omitted spans could be reread for confirmations but
not rejections. Also, disproving every old finding still caused a terminal repair
error instead of a fresh review of the unchanged candidate.

Recovery now uses the existing three-attempt protocol bound for invalid ranges,
skips failed model routes, and keeps usable decisions. A valid omitted span can
trigger one reread from the same immutable source for either verdict. The prompt
specifies inclusive `[start,end]` or `[single_line]`, with at most eight consecutive
shown lines. No source, prompt, provider or gateway budget is increased.

When all findings are rejected and there are no failed CI jobs, generation is
skipped and the existing whole-task requirement review runs on the unchanged
candidate. Rejection does not prove completion. Explicit uncertainty, missing
literal evidence, failed CI, final publication provenance checks and draft status
remain enforced. Task #282 stays within checkpoint 3.1a.

Regression coverage exercises invalid-range fallback, rereading a real omitted
span for rejection, bounded exhaustion, unchanged-source review, and blocking
uncertain findings. `engine/validate_change.py` is absent in this repository;
the available regression suites and independent CI checks are used instead.

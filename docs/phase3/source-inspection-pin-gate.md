# Source-inspection commit-pin gate

Task #301 explicitly requests commit-pinned GitHub source links. After the
sandbox/recovery repairs, [run 40546605724](https://github.com/onlykappa/KappaForge/actions/runs/40546605724)
opened draft [PR #304](https://github.com/onlykappa/KappaForge/pull/304), head
`f1b77839b1206fc3249e5a7457892bb7b9a06d15`. Its report marked 9/9 requirements met,
but the exact document still cited `/blob/main/` and invented line ranges. It
also contained claims that need factual correction, including that read-only
modes cannot read GitHub contents. `guard_request()` returns early for GET/HEAD;
that claim is not supported by the current source. Passing execution and sandbox
tests do not establish document accuracy. Keep the output draft.

The deterministic provenance gate recognized only `/commit/` URLs. The source
citation collector recognized only `/blob/<40-hex>/` URLs, silently ignoring
mutable branch references. Therefore neither deterministic gate rejected these
links, even though the task explicitly required immutable citations.

For the narrow explicit source-inspection task with that owner instruction,
pre-review and final publication checks now reject mutable or abbreviated source
refs and resolve full blob commit SHAs through the existing same-repository
GitHub commit API. Blob and commit refs share deduplication and the existing
32-reference bound. Missing/unavailable/mismatched commits remain unverified.
Unrelated documentation retains its existing link policy. No arbitrary URLs are
fetched and no new provider calls are needed for this gate.

Generation also receives the controller's actual source snapshot SHA and the
instruction to use immutable file links and avoid invented line numbers. This is
advisory; it cannot override the final deterministic check. Existing literal
source checks still assess current factual descriptions. Commit existence does
not independently establish the truth of every claim or historical file content.

Measured live execution after PR #303: 8 gateway calls (1 code, 6 whole-task
reviews, 1 finding verification), 11 attempted provider routes; lifetime calls
34 to 42. Earlier run 40534090256 used 26 gateway calls (2 code, 6 review,
12 finding verification, 6 light), with 39 provider attempts. This is a measured
execution improvement, not fulfilled work: the false completion report above is
why publication evidence still needs repair. No counters, mandatory tests,
provider limits, Worker settings, or effort bounds are reset or raised.

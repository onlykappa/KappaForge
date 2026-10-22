# Task #191: investigate and repair the failed autonomous weather mission

This draft focuses on the failures exposed by task #191. It is separate from
PR #194's OpenRouter/premium work. Keep this PR a draft; do not merge, deploy,
release, spend provider credits, or restart task #191 as part of this investigation.
Record evidence and test results here so another developer can continue.

## Evidence inspected

- [Original task and bot progress/failure ledger](https://github.com/onlykappa/KappaForge/issues/191).
- [Incomplete weather checkpoint, PR #192](https://github.com/onlykappa/KappaForge/pull/192),
  candidate `3d9ef29b2125c2976501633bb7f129b9514178b7`.
- [Failed workflow](https://github.com/onlykappa/KappaForge/actions/runs/39805542149),
  code job `119917745997`, and the owner's screenshot of repair round 2.
- Baseline for this repair: main `677a4f8579204ddce4432062b8eb97363b99b9dc`.

## Findings

1. **Confirmed false authorization failure.** `EditMismatch` embeds an 80-character
   source excerpt. The missing route-list anchor includes `/authorization`.
   `recovery.diagnose()` searched the entire exception string for that word before
   checking for an edit mismatch. It persisted `blocked_authorization` for a
   recoverable proposal error. A subsequent unread-file error attempted
   `blocked_authorization -> recovering`; terminal error reporting then attempted
   `blocked_authorization -> failed_terminal`. Both transitions were rejected,
   obscuring the original error. Keep the state-machine protections intact.
2. **Confirmed ineffective model switch.** The activity says it is switching away
   from `ollama:gpt-oss:120b`, but subsequent gateway evidence selects it again.
   `run_model(..., skip=...)` passes exclusions only to the direct-provider path;
   `run_integrated_router()` has no skip argument. The integrated gateway needs
   an explicit, validated exclusion contract; retries must remain within the
   owner's allowed providers and any pinned route restrictions.
3. **Confirmed incomplete weather implementation.** PR #192 adds two duplicate
   `/weather` handlers and no app/tool integration. The handlers appear immediately
   after pathname parsing, before the normal app authentication/path handling.
   The review's claim that the allowlist alone makes the route unreachable is an
   unverified hypothesis: test the actual request path and authentication boundary
   rather than copying that claim into a repair. Review request-method checks too.
4. **Confirmed inadequate weather test.** `tests/weather.test.mjs` in #192 uses
   `test` and `expect` without importing a Node test runner/assertions, makes a live
   network call with an empty environment, and is absent from the root npm test
   command. Its existence is not proof of passing tests or working chat weather.
5. **Unverified completion.** The self-review reports “Requirement review
   unavailable.” The draft description nevertheless says weather is functional
   and verified. The progress card also marks “Found 3 problems” as a successful
   step while PROGRESS.md retains an earlier saved-stage status after the crash.
   Preserve the original requirements and distinguish saved code, unresolved
   findings, verified behavior, and workflow failure.

## Ordered repair plan

- [x] 1. Read the task, screenshot, trusted failure ledger, saved PR and run logs;
  identify the causal chain before changing recovery behavior.
- [x] 2. Classify edit mismatches and unread-source errors by internal exception
  type before examining source-bearing text. Use that diagnosis consistently for
  generation hard stops. Preserve exact unique matching, protected-path checks,
  authorization expiry, read-before-write and bounded retry budgets.
- [x] 3. Regress missing/ambiguous anchors containing authorization/security words,
  persistence/reload, an unread-file failure followed by a valid retry, and genuine
  authorization failures. No provider credentials or live inference are needed.
- [ ] 4. Implement and test model exclusions through Python -> gateway -> route
  selection. Cover repeated rejected proposals, all routes excluded, pinned
  routes, request validation, and honest reporting when no alternative exists.
- [ ] 5. Investigate every task #191 requirement against the saved candidate.
  Record a requirement/evidence matrix. Reproduce duplicate handlers, actual
  routing/auth behavior, test discovery, unavailable requirement review, and stale
  failure/progress summaries. Fix each confirmed cause and add behavioral tests.
- [ ] 6. Complete weather through the real app/tool path, reconciling PR #192
  rather than merging a duplicate partial implementation. Cover explicit city
  before saved location, no assumed GPS/default city, C/F units, finite/ranged
  coordinates, current/hourly/daily data, local timestamps, bounded cache,
  timeouts, upstream failures, invalid cities and graceful responses. Authenticate
  the endpoint and reject unsupported methods before any external request.
- [ ] 7. Integrate weather tests into CI using the existing Node runner and
  assertions. Test discovery/invocation and natural-language output through the
  same execution path as the app; separate deterministic tests from live checks.
- [ ] 8. Fix failure reporting to retain the original cause, saved draft/SHA and
  next action, and finish the progress note when the worker exits. Keep “review
  unavailable” incomplete; never describe a saved stage as a completed feature.
- [ ] 9. Run full independent validation and record exact results/limitations.
  When explicitly authorized to perform live verification, demonstrate Spokane
  Valley weather from a successful real API response through the actual tool
  path. Do not claim deployment, live success or task completion from mocked tests.

## Validation and handoff

Baseline edit recovery: 6 tests passed; baseline journal: 49 passed. The repair
adds regression coverage and must retain those checks. Run the full Python suite,
`npm test`, `python scripts/check-web.py`, and agent preflight. Check the dependency
map after moving exception classes. The policy references `engine/validate_change.py`,
but that file does not exist on this baseline; report its absence, do not invent
a successful validator result. CI provides verification on Linux independently
of this Windows development environment.

This initial patch repairs the false authorization classification and records the
remaining investigation. It does not complete weather, migrate old blocked
journals, relax the state machine, or restart the existing task. Any recovery of
old state must revalidate current owner authorization and the exact candidate;
never blanket-convert blocked tasks to runnable ones.

### Initial patch results (Windows, 2026-10-22)

- New tests reproduced the failure using the unmodified baseline classifier;
  the replay produced false authorization classifications and an invalid state
  transition. The real authorization-denial regression still passed.
- Updated journal suite: 52 passed. Full JavaScript suite: 465 passed.
- Full Python suite: 441 run, 437 passed, 3 skipped (real ast-grep unavailable),
  1 failed: existing `test_the_map_ranks_kappaforge_itself_sensibly` constructs
  Windows backslash paths but expects slash paths. No assertion was weakened.
- Web checks passed using the bundled Python as `python3` and UTF-8 mode for
  subprocesses. Agent preflight, dependency map generation/check and diff checks
  passed. Local checkout line endings were normalized to Git's LF content for
  byte-sensitive tests; no source-content change was needed for those tests.
- `engine/validate_change.py` is absent; no validator success or live task/weather
  verification is claimed. Linux CI results must be reviewed before promotion.

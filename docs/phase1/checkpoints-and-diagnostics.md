# Phase 1 Steps 5 and 6: checkpoints and execution diagnostics

The existing task recovery journal remains the authority and continuation queue. No new service or intermediate
candidate commit is required. Uncommitted source, completed generation stages and sandbox execution state are stored
in immutable fragments on the authorized task's existing GitHub issue. The journal publishes a hash and comment-ID
receipt only after every fragment is stored. A failed write retains the last published receipt and stops further work.

## Preserved state

- The original task and requirements, task authorization digest, repository, and original base revision.
- The selected generation plan and sources' fingerprint, completed stages (including stages needing no edit), exact
  candidate file contents and deletions, and the current workspace fingerprint.
- Commands, profiles, real start/finish timestamps, exit status, measured test counts and bounded output.
- Meaningful repair attempts, changed paths, rationale, patch/error fingerprints, previous actions, action budget,
  and the current stage, including the separate final regression stage.
- Provider responses/failures and token counts when the provider supplies them. Missing counts remain unknown;
  model-call budgets, routing history and gateway evidence continue to use their existing journal records.

Patch and metadata blobs are capped at 2 MB each and split into 40,000-character base64 fragments. The cache retains
at most 128 commands and at most 4,000 characters per output stream, with parsed test counts preserved independently
of clipped logs. The task card retains a shorter bounded diagnostic history. Exact candidate code is never silently
truncated or redacted: a credential-bearing candidate is blocked before checkpointing or execution.

## Resume checks and necessary repeated work

Recovery accepts only the Actions bot's fragments referenced by the trusted journal. It verifies hashes, task/repository
authority, the task text, base SHA, fetched base tree, candidate contents, toolchain versions and original test commands
before another candidate command. Changed source, authority, a missing fragment or a corrupt receipt blocks execution.
An explicit owner renewal may reuse the original execution checkpoint only when its existing scope-renewal mechanism
authorizes that identity and the task/execution contract still matches. Generation-plan input changes require review.

The development path reuses its saved plan and completed generation stages, and skips generation/review when a
candidate has already reached sandbox validation. The PR repair path likewise resumes an uncommitted repair without
charging another fix cycle or requesting another proposal. Completed commands are reused only for their exact workspace,
phase, arguments and profile. Candidate checks and final regression checks have distinct cache keys. A partially
finished suite resumes its unfinished commands; a completed final regression needs no further sandbox execution.

A new runner must recreate dependency volumes because those volumes belong to the previous isolated session. That
setup is reported explicitly. A command whose completion was never observed may run again; it has no success receipt.
Provider quota failures, interruptions and temporary infrastructure outages return to the existing bounded recovery
queue without discarding progress. Cancellation, authorization expiry and other existing safety budgets still stop it.

The first publication commit has a durable receipt before the branch moves. Lost branch-update acknowledgments can
reuse only that exact commit and its authorized parent. PR creation checks the current branch and returned PR head;
concurrent changes stop publication with the saved evidence intact. Independent post-publication CI retains the
existing exact-commit dispatch and recovery behavior.

## Task interface and privacy

The existing progress comment carries an optional execution snapshot. Browser and bundled iOS task cards show the
current command, real elapsed time, passed/failed/skipped/blocked outcomes, counts, error category and evidence,
candidate attempt changes and rationale, final regression status and bounded logs. Reused command results are labeled.
The browser clock updates elapsed time from server timestamps; it never invents progress or an ETA. Recovery and the
workflow failure finalizer freeze interrupted command timers and mark completion as unobserved.

Diagnostics remove secret-shaped values, sensitive/private runner environment values, credential-bearing URLs and
authorization headers before persistence or rendering. The sandbox receives its existing fixed nonsecret environment,
and candidate commands retain all existing policy, network and resource restrictions. Private target code cannot be
stored on a public task tracker: that case stops and requires a private checkpoint location. No live provider calls
are needed for the regression tests.

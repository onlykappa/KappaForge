# Durable review ingestion — direct continuation

The owner asked to resume after task314 exhausted its sandbox allowance. Work continues directly in draft312; task314,315 and queue319 are not reset, restarted or marked successful. Their original source, checkpoints and accounting remain evidence. This implementation replaces the rejected in-memory-only design; it does not publish or approve that proposal.

## Interface and boundaries

`Journal.ingest_reviews(pr_number)` uses the existing authenticated target reader and owner-task scope. The journal must already bind the exact GitHub PR URL, repository, task digest and full candidate SHA. Both the live active scope and journal scope are checked against the owner issue before every target read. PR metadata must confirm an open draft on `kappa/dev-<task>`, with matching head/base repository and candidate SHA. A foreign PR, changed/closed/expired task, moved branch or missing active authority is refused before persistence. Private feedback cannot be stored on a public task tracker; existing execution storage policy applies.

The interface fetches conversation comments, inline review comments and review summaries/requested changes. Identities include repository, PR, source kind and GitHub ID. Stored evidence includes author IDs/login/type, body, supplied timestamps, commit/review/reply/thread IDs, file/line ranges, side, original location, state, and resolution/outdated fields where returned. REST does not expose every thread's state: absence stays unknown. No resolved/outdated state is inferred from a commit mismatch.

Every feedback body, URL and file location remains untrusted evidence. Content is redacted through existing checkpoint sanitization. Links are never followed, bodies never become owner guidance, and no source edit, reply, resolve/approve, merge, release or deployment is performed by ingestion.

## Synchronization and recovery

Two complete bounded scans must agree before the inbox is published. Each endpoint is paginated with100 items per page, at most20 pages; incomplete, malformed or duplicate inventories fail closed. PR head and owner authority are checked again. This detects observed pagination/feedback races; the API has no atomic multi-endpoint snapshot, so feedback arriving after the scan is picked up next time.

New/edited feedback updates the snapshot. Missing feedback becomes a tombstone only after both complete inventories agree; reappearing IDs revive without duplication. Unchanged snapshots produce no new persistence writes. Candidate SHA and inbox revision identify the observed snapshot; a revision is evidence storage, never an execution or completion receipt.

The inbox lives in the existing hashed bot-comment blob store, with a small `reviewInbox` receipt in the durable journal. Scope/repository/PR/ID integrity is checked on reload. Existing rotating comment slots preserve the last committed generation while new fragments are written. API errors, rate limits, interrupted writes, owner cancellation and observed head movement retain the previous committed inbox. Existing two-megabyte checkpoint limits apply; oversized evidence is refused rather than silently trimmed into a complete inventory.

This first interface uses stable complete rescans rather than a timestamp-only API cursor: same-timestamp edits, removed comments and reopened feedback remain visible. It does not claim an exactly-once downstream repair queue. Repair consumption, processed decisions, automatic review-triggered wakeups and richer GraphQL thread state remain subsequent integration work. The API is exposed on the real Journal; it is not yet invoked automatically by the repair workflow.

## Validation

- 12 behavioral tests cover all three categories, durable reload/idempotence, new/edited/deleted/reappearing IDs, supplied/unknown thread states, pagination, corrupt/foreign receipts, scope/auth denial, untrusted links, API401/429, incomplete inventories, concurrent feedback/head changes, cancellation and storage interruption/retry.
- 119 focused ingestion/journal/task-state tests pass with proper ContextVar cleanup.
- Full Python discovery:1,340 run OK,31 skipped; ten structural rules and policy/map/source checks pass. New-head remote CI is pending and recorded separately in the PR. No live ingestion on task314 is claimed: it never published an authorized candidate PR.

## The stopped automatic task

The separate five-attempt sandbox guard counts tested candidate versions, including the initial candidate. It is an internal bounded repair session, not a provider quota or billing allowance. The outer queue has three launch attempts. KappaForge's project-level model-call/edit/fix-cycle counters have no configured ceiling; this does not remove the controller's local safety bounds. No such limit was changed for this direct continuation.

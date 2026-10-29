# Durable review ingestion — direct continuation

The owner asked to resume after task314 exhausted its sandbox allowance. Work continues directly in draft312; task314,315 and queue319 are not reset, restarted or marked successful. Their original source, checkpoints and accounting remain evidence. This implementation replaces the rejected in-memory-only design; it does not publish or approve that proposal.

## Interface and boundaries

`Journal.ingest_reviews(pr_number)` uses the existing authenticated target reader and owner-task scope. The journal must already bind the exact GitHub PR URL, repository, task digest and full candidate SHA. Both the live active scope and journal scope are checked against the owner issue before every target read. PR metadata must confirm an open draft on `kappa/dev-<task>`, with matching head/base repository and candidate SHA. A foreign PR, changed/closed/expired task, moved branch or missing active authority is refused before persistence. Private feedback cannot be stored on a public task tracker; existing execution storage policy applies.

The interface fetches conversation comments, inline review comments and review summaries/requested changes. Identities include repository, PR, source kind and GitHub ID. Stored evidence includes author IDs/login/type (unknown for explicit null/deleted authors), body, supplied timestamps, commit/review/reply/thread IDs, file/line ranges, side, original location, state, and resolution/outdated fields where returned. REST does not expose every thread's state: absence stays unknown. No resolved/outdated state is inferred from a commit mismatch.

Every feedback body, URL and file location remains untrusted evidence. Content is redacted through existing checkpoint sanitization. Links are never followed, bodies never become owner guidance, and no source edit, reply, resolve/approve, merge, release or deployment is performed by ingestion.

## Synchronization and recovery

Two complete bounded scans must agree before the inbox is published. Each endpoint is paginated with100 items per page, at most20 pages; incomplete, malformed or duplicate inventories fail closed. PR head and owner authority are checked again. This detects observed pagination/feedback races; the API has no atomic multi-endpoint snapshot, so feedback arriving after the scan is picked up next time.

New/edited feedback updates the snapshot. Missing feedback becomes a tombstone only after both complete inventories agree; reappearing IDs revive without duplication. Unchanged snapshots produce no new persistence writes. Candidate SHA and inbox revision identify the observed snapshot; a revision is evidence storage, never an execution or completion receipt.

The inbox lives in the existing hashed bot-comment blob store, with a small `reviewInbox` receipt in the durable journal. Scope/repository/PR/ID integrity is checked on reload. Existing rotating comment slots preserve the last committed generation while new fragments are written. API errors, rate limits, interrupted writes, owner cancellation and observed head movement retain the previous committed inbox. Existing two-megabyte checkpoint limits apply; oversized evidence is refused rather than silently trimmed into a complete inventory.

This interface uses stable complete rescans rather than a timestamp-only API cursor: same-timestamp edits, removed comments and reopened feedback remain visible. It does not claim an exactly-once downstream repair queue. Repair consumption, processed decisions, automatic review-triggered wakeups and richer GraphQL thread state remain subsequent integration work.

### Owner Fix integration

For an existing journal that already names its authorized draft PR, fix_pull_request now calls Journal.ingest_reviews after discovering that PR and before check polling, task-state rebinding, repair planning or model calls. Existing scope/candidate checks must pass; a moved head, expired/revoked owner scope, incomplete scan, API failure or persistence failure propagates to the existing recovery boundary. It never continues planning with a falsely complete snapshot. The last committed inbox is preserved after an interrupted sync.

This is evidence collection on an already authorized Fix, not a new dispatch or a review-triggered repair. Pending checks with no existing repair reason still do not start generation. Feedback is not appended to owner guidance or used as permission; source repair consumption remains Phase3.3 work. A legacy journal with no saved PR is left unbound and follows the old Fix path: the discovered PR is never automatically adopted. Existing callers without a journal also keep their old behavior. No new action, grant, worker, scope, counter reset or lifecycle operation is introduced.

Four real-Journal runtime regressions cover durable collection during pending checks without model/sandbox work or budget debit, changed-candidate denial before any check/planning mutation, rate-limit failure preserving the old inbox, and non-adoption of a legacy unbound journal. The related135-test ingestion/runtime/Fix/journal/task-state set passes. After isolating a stale progress reporter in the existing recovery fixture (P3-116), the four-test formerly failing order and broader56-test repair/recovery set pass. Final full Python discovery:1,352 run OK (32 skipped);10 structural rules, source/map/policy and whitespace checks pass. Remote exact-head runtime CI remains pending.

## Validation

- 13 behavioral tests cover all three categories, durable reload/idempotence, new/edited/deleted/reappearing IDs, supplied/unknown thread states, pagination, corrupt/foreign receipts, scope/auth denial, untrusted links, API401/429, incomplete inventories, concurrent feedback/head changes, cancellation and storage interruption/retry.
- 120 focused ingestion/journal/task-state tests pass with proper ContextVar cleanup.
- Latest engine follow-up full Python discovery:1,348 run OK,32 skipped; ten structural rules and policy/map/source checks pass. Prior feature candidate94da2aa passed remote Python1329 run (32 skips), web, Worker and structure in40899169255. Corrected deleted-author source d561a8a passed remote1330 Python tests (32 skips), web, Worker, structure and graph in40902062899/40902062920. Engine ac74407 passed1348 Python tests (33 skips), web, Worker, structure, Docker40902043850 and native40902044077 (five UI tests). Fresh runtime-integration head CI is pending separately. No live ingestion on task314 is claimed: its exhausted saved journal has not adopted the independently reviewed manual candidate PR320.

## The stopped automatic task

The separate sandbox guard counts tested candidate versions, including the initial candidate. The owner subsequently authorized increasing it from5 to10 and retrying the retained314 work (P3-109). It is an internal bounded repair session, not a provider quota or billing allowance. The owner subsequently raised the outer queue allowance3→10 and model repair actions20→100 (P3-111), retaining spent counters. Read-only investigation was also expanded to its validated maxima after preflight found the output allowance exhausted. KappaForge's project-level model-call/edit/fix-cycle counters have no configured ceiling; this does not remove the controller's local safety bounds. No limit changed for the direct inbox implementation; later explicit owner requests expand the tested-candidate and exhausted action/launch allowances. Existing counters remain spent.

## Error-driven repair capacity follow-up

The owner subsequently requested more useful repair capacity and different ideas. P3-117 raises the candidate ceiling10→20 total while retaining the original ten spent versions; actions100, queue launches10 and all other ceilings remain unchanged. The controller records evidence-bound causal plans and outcomes, requires a new plan for recurring named-test failures, rejects normalized identical strategy relabeling and permits a different recorded intervention to test the same error. This is mechanical discipline, not a semantic novelty guarantee. All source scope, final validation and publication checks remain.

A source-cited hypothesis cannot authorize another repository, test weakening, lifecycle operations or task completion. No queue restart/adoption has occurred:314's journal still names its historical proposal rather than manual PR320. That handoff must be validated separately before a worker can safely continue. Scheduled automation remains off.

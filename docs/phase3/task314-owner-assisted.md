# Task314 owner-assisted corrected candidate

Owner requested fixing the known failures before another run. This candidate starts from the original immutable task base5b462fa77b6bd9971ebeb2403135f0bef653ca9a, not from a new grant or reset task. The exhausted automated proposal and its55 model calls/6 generation edits,30 repair actions and10 failed candidate records remain untouched. This is a separately reviewable owner-assisted correction, not a claim that the failed controller passed.

## Corrections

- Replace the generated in-memory Record.feedback design with Journal.ingest_reviews and an authenticated durable inbox. Both the active task and saved journal scope must match the exact PR/repository/branch/candidate; re-read owner authority before each target request.
- Store all three source categories with repository/PR/type/ID-qualified identities and supplied author, file/line, commit/review/thread and timestamp metadata. Review bodies and links remain untrusted evidence and cannot grant source/lifecycle authority. Unknown REST thread state stays unknown.
- Complete bounded stable scans handle pagination, duplicates, new/edited/removed/reappearing feedback, cancellation, branch movement, API errors/rate limits and interrupted storage. A new snapshot never replaces the last committed one after incomplete/unstable reads.
- Tests use the real Journal with injected GitHub transport and explicit ContextVar cleanup. There is no DummyJournal missing attributes, invalid dummysha, wrong recovery/goal-context assignment or None.record access. All original behavioral checks remain enforced; no test command, configuration, workflow, provider, access or budget changes.

## Evidence and limits

The12 behavior tests cover durable reload/idempotence, three categories, metadata/unknown states, pagination, edits/tombstones/reappearance, auth/scope denial, untrusted URLs,401/429, invalid inventories, concurrent feedback/head changes, cancellation and failed persistence/retry. The focused ingestion/journal/task-state set ran119 tests, OK. Full Python discovery on this exact corrected tree:1,329 run OK,31 skipped. Ten structural rules, shipped-source scan (15 existing warnings), execution-policy and whitespace checks pass; remote verification uses the standard pull-request unit/web/Worker/structural checks. No agent retry is dispatched and the failed controller is not resumed.

No source repair, feedback replies, discussion resolution/approval, merge, deployment, release or task-completion marker is performed by ingestion. Automatic consumers/wakeups, richer GraphQL thread state and live scoped acceptance remain future integration work. This PR stays draft/incomplete for independent review even if tests pass. No automatic continuation of315 is claimed.

## Follow-up independent review

PR320 head94da2aaa8f9cd2aebffc749d99d2ad48fe3de994 passed remote tests40899169255: Python1329 run OK (32 skips), web, Worker and structure; graph40899169240 also passed. Inspected job123536421476 logs include all12 ingestion behavior tests. This is remote verification, not a live scoped inbox acceptance or success of the exhausted automatic controller.

Independent review reproduced a legitimate deleted-author edge case: user:null blocked the full scan. The correction retains unknown author metadata and stable evidence across all three categories, reload and edits; absent/malformed author fields still fail closed. The new13th behavior test failed before the patch;120 focused tests pass after it. The shared engine correction is also retained in PR312 (P3-113). Fresh standard PR CI verifies this updated candidate after push. No queue/task counters, candidate claims or completion markers are changed;315 remains unstarted. The older ten failed proposals remain evidence.

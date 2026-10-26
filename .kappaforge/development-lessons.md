# Verified development lessons

This is a reviewable, version-controlled record, not automatic self-training.
Only add lessons supported by reproducible evidence and reviewed code changes.

- JavaScript browser functions must be tested with Node/browser tooling, not imported into Python as modules.
- Ensure new tests are actually discovered by the normal CI commands.
- Avoid duplicate top-level classic-script globals; the second render() declaration shadowed the main dashboard renderer and broke Settings.
- In XCTest, HTML input[type=search] is queried with searchFields, not textFields.
- A committed PR, green unit test, simulator build, and published IPA are distinct verified outcomes.
- When a failure repeats, inspect the new log and test actual root causes instead of weakening assertions.

## Autonomous recovery checklist
- Include populated task/recovery history in request-budget regressions. A fixed state-context allowance can consume most of a learned role envelope even after source compaction. Shrink only diagnostic prompt copies, preserve identity/facts/actions/budgets and the full live record, and include effective allocation in rendering cache keys so smaller retries cannot reuse oversized context.
- For finding verification, serialize the complete owner request once and use exact, engine-resolved requirement spans. When a retained resource envelope cannot fit a batch with available source evidence, subdivide it over the same snapshot; never drop findings, send an available-source-free batch to obtain a fitting request, or reuse partial results as edit authorization. Stop if one finding cannot fit.
- When relaying an authorized owner follow-up on a task issue, use the supported `Guidance:` prefix and verify it reaches the repair prompt. `engine/developer.py::owner_guidance` deliberately excludes ordinary comments and other authors; a posted note alone is not evidence that the engine consumed it. Preserve those author/scope gates.
- For source-edit failures, compare the proposed anchor with the actual file content; never invent class declarations or accept no-op edits.
- For CI failures, inspect the exact failing checks before deciding what to change; a failed step name is not a proven root cause.
- An auto-repair is only verified once its new commit's independent checks pass. Do not count queued or skipped checks as success.
- On retries, preserve the original plan, task number, draft PR and completed work; avoid creating a second issue.
- Escalate after bounded retries or when scope, credentials, production deployment or owner decisions are required.

## From task #111 (weather, PR #117): green tests, feature that could not run
- A new Worker route must be added to the allowed path list at the top of fetch() in chat-backend/src/index.js, or every request to it gets 404 "Not found".
- The Worker has already read the request body into `input` (await request.text()); read fields from `input`, never call request.json() again.
- A new setting must get a default and validation in KappaCore.settings() (preview/core.js); settings() drops every other key when the app loads.
- A backend feature is only done when the app calls it and uses its result where the task needs it (for weather: fetch it and include it with the chat message).
- navigator.geolocation.getCurrentPosition takes callbacks; wrap it in a Promise that resolves with coordinates and rejects on denial, and handle the denial path.
- A test must import or load the real code it checks; a test of a mock defined inside the test file proves nothing.
- Describe what the change verifiably does, not what it was meant to do.
- A fractional prompt-history allocation must not become a smaller hard cap on required task identity, observed receipts, budgets and next action. Trim only optional prompt copies, retain the absolute state/request caps, and report typed local size failures so review can subdivide or stop precisely. Test a resource reduction with populated receipts, not only empty task history.
- For a pre-merge engine retry, verify the workflow's engine checkout SHA as well as the candidate SHA. Adopting candidate commits does not replace an engine already running from main; use only an explicitly owner-authorized task branch for the engine trial.
- When a scope reviewer must assess every changed file, reserve current-source context for every file before a large earlier file consumes the budget. Keep partial-source labels and literal evidence checks; an omitted source or invalid model quote is a review gap, not permission to repair code.
- For large PRs, separate scope decisions into bounded batches before the requirement review. Retain only decisions validated against the current snapshot, retry missing/invalid decisions, and show current lines near the actual PR hunks. Never infer approval for unresolved paths or discard unrelated-change findings.
- Keep single-pass finding-verifier limits intact; orchestrate larger finding sets in bounded passes over the same owner/candidate/source snapshot. Never silently truncate findings, return authorization from only the successful batches, or reuse stale decisions after a candidate change.
- Persist and verify engine provenance separately from candidate identity. A resume must use current trusted main or the same explicitly owner-started trial engine SHA. Never infer engine execution authority from a candidate tip or silently downgrade a trial to legacy main; stop if provenance cannot be verified.
- Cloudflare error 1102 names gateway resource exhaustion, not provider quota. Rebuild scope, requirement and finding review requests with smaller source/diff evidence, preserving the complete owner request and every finding. Retain the task-local envelope across recovery. Bound adaptation and stop unverified if indispensable evidence cannot fit; never repeat the same oversized review through whole-task resumes or relax literal evidence gates. A client recovery fix does not prove the deployed Worker's CPU/memory cause was optimized.
- A resource envelope learned by a verifier applies to that routing role, not all coding. Migrate legacy envelopes only from recorded resource-error provenance; preserve unattributed limits conservatively. Prefer small verification and repair batches with deferred findings retained and fresh source checks. Smaller calls can increase total calls: measure saved progress, tokens, time and failures before tuning; never raise platform limits or discard owner rules to make a prompt fit.

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
- For a pre-merge engine retry, verify the workflow's engine checkout SHA as well as the candidate SHA. Adopting candidate commits does not replace an engine already running from main; use only an explicitly owner-authorized task branch for the engine trial.
- When a scope reviewer must assess every changed file, reserve current-source context for every file before a large earlier file consumes the budget. Keep partial-source labels and literal evidence checks; an omitted source or invalid model quote is a review gap, not permission to repair code.

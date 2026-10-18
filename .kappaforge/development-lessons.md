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

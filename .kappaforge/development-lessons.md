# Verified development lessons

This is a reviewable, version-controlled record, not automatic self-training.
Only add lessons supported by reproducible evidence and reviewed code changes.

- JavaScript browser functions must be tested with Node/browser tooling, not imported into Python as modules.
- Ensure new tests are actually discovered by the normal CI commands.
- Avoid duplicate top-level classic-script globals; the second render() declaration shadowed the main dashboard renderer and broke Settings.
- In XCTest, HTML input[type=search] is queried with searchFields, not textFields.
- A committed PR, green unit test, simulator build, and published IPA are distinct verified outcomes.
- When a failure repeats, inspect the new log and test actual root causes instead of weakening assertions.

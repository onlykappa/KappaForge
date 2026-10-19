# Recovery from rejected code edits

Task #128 repeatedly tried to replace a form submit handler that did not occur in
`preview/app-main.js`, then exhausted its attempts on malformed JSON. Switching
models alone did not correct the nonexistent anchor.

The next generation attempt now receives bounded diagnostic evidence:

* Missing or ambiguous anchors include literal source near shared text in the
  failing file. This also works inside long minified lines and for paths with
  spaces. For sequential edits, evidence uses the source at the failing edit,
  including earlier edits in that proposal.
* Malformed JSON includes its parser location and a small escaped response
  excerpt, with instructions to resubmit a complete, smaller valid proposal.
* A non-object entry in an edit list is rejected and retried instead of crashing
  with an attribute error.
* Files omitted from the model's source context cannot be edited or overwritten.
  A block that does not fit no longer prevents later smaller files from being
  included.

No rejected proposal changes the repository. Diagnostic snippets never authorize
fuzzy replacement or whole-file rewrites from excerpts. Exact uniqueness, syntax
validation, test requirements, authorization boundaries, model switching and retry
limits still apply. A model can still exhaust its bounded attempts; the agent
must report that failure rather than claim it repaired the task.

`tests/test_edit_recovery.py` reproduces the screenshot's missing-anchor and JSON
failure sequence, then verifies recovery with a corrected proposal. It also
covers malformed edits, omitted context, intermediate source, long minified
lines and ambiguous anchors. These tests simulate model responses without using
provider credentials. GitHub Actions runs independent Python and app checks on
the pull request before merge. The fix runs in the Actions agent from `main`;
no new iPhone installation is needed for the next authorized task attempt.

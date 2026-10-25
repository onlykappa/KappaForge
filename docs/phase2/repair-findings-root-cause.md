# "No repair finding was confirmed": root causes and fixes

Fix rounds kept stopping with *No repair finding was confirmed against the owner goal and current source*. Reading
the verifier's own verdicts across tasks #232, #235, #237 and #256 showed three causes. None of them was that the
code was fine.

## 1. True findings lost to inexact copying (#232)

**What happened.** The verifier agreed the defect was real ("produce_development_pr calls … before invoking …"). The
gate still downgraded the finding to `needs_validation` with `evidence:abbreviated_or_paraphrased` or
`owner_quote_not_literal`. Free models were asked to copy source lines and the owner's words character for
character, and they shortened or reworded them.

**Fix (`engine/repair_guard.py`).**
- **Source lines by number.** The verifier is shown each source line with its real line number (`123| code`). It cites
  evidence as `{"path", "lines": [first, last]}`: at most 8 consecutive lines it was actually shown. The engine reads
  the exact text, so there is nothing to mistype. A copied quote that carries the `123| ` prefix is accepted once the
  prefix is stripped.
- **The owner request by id.** The request is split into numbered requirements (`owner_requirements`, from the
  section 4 splitter). The verifier cites one by `owner_ref`, and the engine uses its literal text.
- **Same strictness.** The bar is unchanged: an abbreviated or reworded quote is still not evidence. Lines that were
  not shown, reversed, more than 8, or not integers are refused (`lines_not_shown`), and an unknown `owner_ref` proves
  nothing. The engine keeps its own copy of what it showed and never sends that copy to a model.

## 2. One skipped decision voided the whole verification

**What happened.** "Finding verification was invalid from 3 free models (missing_or_foreign_ids …)". When a model
answered some findings but skipped one, the whole answer was rejected, so the decisions it did make were lost.

**Fix.** A missing or malformed decision now counts as `needs_validation` with gate `not_answered`, which authorizes
no edit. The well-formed decisions stand. A foreign id is ignored. A duplicated id, or an answer with no usable
decision, is still invalid and retried on another free model.

## 3. The engine's own notes treated as source defects (#256)

**What happened.** The draft's open problems included notes the engine writes about its own review: "Repair
checkpoint awaiting full requirement review and independent tests", "Requirement review unavailable", "File scope
review is incomplete" and others. They were sent to the verifier as findings. It rightly rejected them ("a literal
string from engine/developer.py", "no current source file contains evidence of that"). That left nothing to repair,
and the task stopped.

**Fix (`engine/verify.py` `process_problem`, `engine/developer.py`).**
- **Process notes are recognized deterministically.** Every review-process note the engine writes is identified by
  its fixed wording. Real work stays real work: "Requirement not met", "No test proves the change", "Unrelated
  change", "Requirement untested", wiring problems.
- **They never reach the verifier**, in a fix round or in `check_the_work`'s repair loop.
- **Process notes alone mean a fresh review.** When a fix round has only process notes open and no failed checks, it
  reviews the PR as it stands again. There is no verifier call and no code generation. A clean review closes the
  notes and updates the draft without a commit or test run ("Re-checked the requirements… no code change was
  needed"). Anything the fresh review finds is a real, evidenced finding for the next round.

## Tests

`tests/test_repair_root_causes.py` (11) covers:
- **Prompt shape:** line numbers and numbered owner requirements are shown, and the engine's copy is not sent.
- **Line citations:** a finding cited by lines is confirmed, while the #232 paraphrase is still refused; a copied
  prefix is tolerated; out-of-range citations and unknown owner references are refused.
- **Partial answers:** a skipped decision no longer voids the others, but duplicates or no usable decision are still
  invalid.
- **Process notes:** every engine note is classified apart from real defects; a fresh clean review clears the notes
  with no verifier call and no code; a process note from a review never reaches the verifier.
- **Fix rounds:** a fix round with only process notes re-checks and writes no code.

# Phase 2 audit repairs

The owner requested these four audit findings be fixed in the existing Phase 2 draft PR #264 before Phase 3.
No new workflow, paid service, model route, merge or release is enabled.

## Test validation remains fixed during repair

`Session.test_definition_changed()` protects the base KAPPA.md test command, the entire npm script map and `.npmrc`
configuration (including nested copies).
The latter includes lifecycle hooks and scripts reached through shell/npm indirection; comparing only `scripts.test`
does not freeze what `npm test` executes. Changes to the npm script map are conservatively unsupported in this
validation path, including additions. `.npmrc` changes are also refused: `ignore-scripts=true` can disable a failing
pretest/posttest hook without changing a single script. A local npm reproduction confirmed the base exits 1 and the
configuration-only change exits 0; both forms now have regression coverage. Dependency metadata can still change,
subject to existing installation limits.

The repair controller checks this invariant before restoring a completed receipt and at every iteration, so an
agent patch cannot weaken the command before candidate or final regression. `Session.run_tests()` also refuses a
changed definition when invoked directly. The stop is `test_definition_changed`, never successful validation.

Regression coverage:

- `tests/test_phase2_audit_repairs.py`: test script, pretest, posttest, delegated scripts and npm configuration changes; direct test-tool refusal.
- `tests/test_phase1_acceptance.py`: `RealSandboxAcceptance.test_a_repair_cannot_swap_the_failing_npm_script_for_a_passing_one`.
  Real Docker runs the original failing npm suite. The repair tries to substitute a different passing suite and
  stops before that weaker suite can run. A second case tries to disable the failing pretest through `.npmrc`.
  CI runs both cases in the existing `sandbox` job.

## Publication reviews the exact tested candidate

Development and Fix it checkpoint the digest of the candidate that passed through their original requirement
review. If sandbox repair changes that digest, `review_sandbox_candidate` reruns owner-goal validation, sensitive
change flags and requirement/test-evidence review on the actual final patch, including newly touched files.

This last review is read-only: it cannot start generation, repair, or premium rescue. Its returned candidate digest
must still match the tested patch. An unmet requirement or unavailable review blocks publication and is reported
on the task. Sensitive changes cannot bypass the existing flag policy by first appearing inside sandbox repair.
The final verdict replaces the earlier writer's summary instead of promoting stale claims about the old patch.

An unchanged, digest-bound reviewed candidate can resume without repeating completed planning, generation or review.
Missing/legacy or mismatched review bindings require a fresh review. An owner answer on resume also requires review
of the affected assumptions even if the patch itself has not changed. Requirement classification is reloaded for the
final requirement-to-test matrix.

`FinalReviewTests` covers repaired and new files, sensitive additions, refusal to edit a tested patch, blocked
development publication, and missing/mismatched resume bindings. `FixClarificationTests` covers final-review failure
and success before committing a repaired existing PR. The existing execution-recovery test still asserts no
replanning/regeneration/review for an unchanged candidate, now with the required saved digest binding.

## Research checks all source read so far and the whole outbound URL

Exploration registers every source it loads with the active research filter before returning control to the model.
This includes search and symbol inspection as well as ranged reads. Private paths include short filenames, and
source excerpts discovered after the initial plan receive the same protection as the original sources.

URL checks now cover paths, queries and fragments as well as their decoded forms, on initial requests and every
redirect. Excessive encoding nesting is refused. A trusted documentation host is not an exemption for private
text. Conservative source-overlap refusals are reported as unavailable research, not bypassed. Sensitive refused
URLs are represented by a digest rather than copied into task reports or workflow logs; harmless refused URLs keep
their normal provenance.

`PrivateResearchTests` combines exploration with a subsequent research request and verifies that plain, percent-
encoded and double-encoded source in URLs or redirects never reaches the recording network boundary. These tests
send no real private information and do not use live hosts. The existing research unit/live suites remain in place.

## Fix it uses the existing owner-question protocol

Before checking CI, generating a proposal or allocating a sandbox, Fix it checks its saved clarification. With no
authorized answer, it returns without consuming a fix cycle or repeating the question. A controller question is
saved and posted through `clarification.ask`, and the journal remains `needs_clarification`, not a sandbox failure.

Only the owner's guidance after the question resumes it. The answer travels in the existing answer section excluded
from execution identity, while the candidate, repair phase, attempts and history remain saved. Answered question ids
are supplied to the controller so repeats stay refused. Resumed bounded fixes restore the original PR baseline for
owner-goal validation. An answer changes no execution permissions and does not authorize an owner-only action.

`FixClarificationTests` checks one question, duplicate wakes, a non-owner reply, no budget use while waiting, and
exact candidate/task identity on the owner answer. Its round-trip test uses the production controller and journal
with recording Docker/GitHub boundaries, preserves the earlier attempt, finishes the repair and requires a clean
final review before publication. The ordinary no-change PR re-check regression remains unchanged.

## Remaining audit follow-ups

These requested four repairs do not close the other audit observations: semantic overreach in the trivial-question
filter, interruption within a long/regex exploration call, persistence of all exploration budget counters, and
structured truncation of large model-facing tool results. Fixed-excerpt read-only analysis, dependency-update
coverage, optional schema validation in CI and live model/phone demonstrations also remain documented limits.
They should inform the separately authorized Phase 3 scope; this document does not claim production autonomy is
fully proven. Test execution counts and local-versus-CI evidence are kept in [testing-report.md](testing-report.md).

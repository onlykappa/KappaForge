# Agent delivery quality

The development engine runs in GitHub Actions. These changes take effect for new
agent runs after merging; they do not require a new iOS IPA and do not replace
the engine already loaded by an active run.

PR #133 exposed three separate weaknesses: a diff-only review invented missing
globals and overlooked dependencies, a test imported the Worker but called an
unloaded browser function, and a rejected review repair stopped the remaining
repair rounds.

The engine now:

* Plans complete producer-to-consumer slices with tests at the consumer boundary.
* Supplies current candidate source, shared browser definitions, script loading
  order and direct module dependencies to the reviewer. Context limits are
  explicitly labeled. One bounded follow-up can inspect requested files.
* Keeps unresolved evidence or malformed reviews incomplete. Missing context is
  not proof that code is missing. Reviews must trace fetched data into its final
  consumer and distinguish concrete defects from style preferences.
* Checks that new JavaScript tests load the production module containing new
  bare-called functions, including transitive imports and source-reading fixtures.
  An unrelated existing import no longer automatically satisfies that check.
* Detects direct assignments to Node's getter-only global navigator in new tests.
* Distinguishes early-return route body reads from a second read after the common
  Worker parser.
* Preserves rejected-repair diagnostics and continues within the existing bounded
  review budget. Candidate tests remain subject to review and independent CI;
  every follow-up edit need not introduce another redundant test.

Generated code is still syntax-checked, never executed in the credentialed model
generation process. Behavioral tests run in the independent secret-free sandbox.
Authorization, protected paths, retry limits, candidate-SHA checks and merge
requirements remain enforced.

Regression tests cover PR #133's unloaded permission helper and invalid navigator
mock, current shared globals and dependencies, bounded context and follow-up
inspection, rejected repair continuation, missing coverage and unavailable
review evidence. These checks improve delivery quality; the next real task and
its independent tests remain the measure of whether the complete feature works.

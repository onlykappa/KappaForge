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
  bare-called functions through named imports, re-exports or require bindings.
  Side-effect imports and reading a file as text do not bind its functions.
  VM/browser fixtures call helpers through their explicit context objects.
* Detects direct assignments to Node's getter-only global navigator in new tests,
  while ignoring comments and quoted VM fixture code.
* Distinguishes early-return route body reads from a second read after the common
  Worker parser.
* Preserves rejected-repair diagnostics and continues within the existing bounded
  review budget. Candidate tests remain subject to review and independent CI;
  every follow-up edit need not introduce another redundant test.
* Requires structured source evidence for every met requirement and checks each
  literal quote against the current candidate file. Unavailable source requests
  survive follow-up inspection; a requirement checklist also persists through every repair round.
  JavaScript/Python comments and quoted fixture data cannot prove implementation.

JavaScript checks use a pinned, vendored Acorn 8.19.0 parser with its MIT license
and recorded integrity/hash. Candidate text is parsed through stdin and is never
imported or executed. No runtime npm download is required. Agent preflight now
requires Node as well as Python. AST checks distinguish real template expressions
from quoted fixtures, resolve exact export names, and track request body reads
through branches, exits, catches, aliases and independent clones. Analysis is
bounded; unavailable analysis remains incomplete rather than silently passing.
Independent runtime tests are still necessary because source matching alone does
not prove the requested behavior. Unsupported source languages retain source
matching and model review rather than a claim of AST interpretation.

Generated code is still syntax-checked, never executed in the credentialed model
generation process. Behavioral tests run in the independent secret-free sandbox.
Authorization, protected paths, retry limits, candidate-SHA checks and merge
requirements remain enforced.

Regression tests cover PR #133's unloaded permission helper and invalid navigator
mock, current shared globals and dependencies, bounded context and follow-up
inspection, rejected repair continuation, missing coverage and unavailable
review evidence. These checks improve delivery quality; the next real task and
its independent tests remain the measure of whether the complete feature works.


Task #130 recovery follow-up: rejected JSON now gets one short serialization-only
repair attempt within each five-answer generation round. Its output must pass the
same path, exact-match, schema and syntax checks as a fresh proposal. OpenAI-style
providers receive JSON response mode when requested; endpoints rejecting that
option retry once without it. Ordinary chat payloads are unchanged.

A routing timeout after rejected answers retains its actual diagnostic and triggers
a compact source-backed generation round instead of escaping as an unrecoverable
ValueError. Exhausted recoverable validation rounds (including JSON, edit and syntax failures) also get that compact route. It uses at most
80,000 source-context characters and 8,192 output tokens, letting more approved
providers fit the prompt. Earlier validated stages remain saved. Protected paths,
expired authorization and invalid scope still stop immediately. Recovery remains
bounded by generation, task and provider limits; it cannot guarantee completion
when no approved route can supply a valid change. Final reports name the compact
failure and earlier routing/validation evidence instead of hiding the last error.

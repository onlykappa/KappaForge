# Verifier citation protocol recovery

Task #282's [paid-Worker retry](https://github.com/onlykappa/KappaForge/actions/runs/40423409655)
received an HTTP 200 verification response at 12,678 prompt characters. No new
Cloudflare 1102 was recorded. The controller stopped with `RepairReviewRequired`:
one verdict failed `no_literal_source_evidence, evidence:malformed`; another
explicitly requested further validation. The candidate remained unchanged.

The parser accepted a verdict's outer fields before checking citation objects.
Consequently, syntactically valid JSON with unusable citations consumed the
finding's answer slot and never entered the existing bounded protocol retry.
The raw provider response was not retained; the saved evidence supports the
malformed classification, not a claim about its exact original representation.

The verifier now retries only in-scope confirmed/rejected decisions whose entire
evidence payload is structurally malformed or has an invalid evidence count.
It requests only those findings, skips previously attempted routes, and retains
other decisions with their own source snapshots. The existing three-attempt
bound includes these retries. Exhaustion retains the failed citation gate and
cannot authorize an edit. Prompts explicitly require citation objects and short
reasons rather than task-state references as source evidence.

Explicit `needs_validation`, paraphrased or invented source quotes, and scope
disagreement do not trigger these protocol retries. Literal source and owner
proof checks, candidate freshness and omitted-source rereads remain enforced.
Missing live provenance still requires actual repository/controller evidence;
retrying malformed citations does not supply it or guarantee task completion.

Regression coverage checks mixed answers, narrow retry scope, route exclusions,
preserved uncertainty, and bounded exhaustion for several malformed evidence
shapes. The pre-existing tests cover semantic disagreement, literal proof,
candidate movement, malformed JSON and missing decisions.

## Branch observations and complete omission evidence

Follow-up run [40426295136](https://github.com/onlykappa/KappaForge/actions/runs/40426295136)
exercised retries and a source reread but still ended unverified. A saved reason
called historical baseline `ce7a5645...` current main, although the branch API
reported `f6401c5e...`. Another decision identified missing links but requested
validation. The final source gate was `evidence:lines_not_shown`; the raw line
citations are not retained, so their exact original ranges are unknown.

Repair verification now receives a controller-read branch ref/SHA from GitHub’s ref endpoint
and candidate as a separate observation. It is explicitly a snapshot at branch read
time, not an assertion that the branch can never move. A candidate mismatch or
malformed observation is refused before inference. This metadata is not source
proof and cannot authorize a repair by itself. It accompanies bounded batches
and source rereads, keeping source documents distinct from branch observations.

Short documentation files (at most 8,000 characters) are shown completely when
they fit the existing total source allocation. Smaller allocations still show
explicitly partial evidence. This removes the arbitrary 3,000-character per-file
cutoff for fitting documents without raising the request or total source budget.
The prompt explains that a missing required item can be evidenced by its fully
shown affected span; it cannot be inferred from omitted text. Actual literal
line checks and genuine needs-validation decisions remain unchanged.

The owner clarified that retry must occur after this correction. Premature run
40427882750 was cancelled; it is not a post-fix test receipt.

A live inspection showed PR #284 base.sha still at d18f3320 despite main at f6401c5e. The controller therefore reads git/ref/heads/{ref} directly and never substitutes PR base.sha on missing or invalid API evidence.

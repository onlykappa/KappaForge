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

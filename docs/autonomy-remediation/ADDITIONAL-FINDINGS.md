# Additional findings discovered during remediation

Original KF-AUDIT-001–061 remain unchanged. New observations are separately identified rather than silently changing the audit's findings or declaring unverified production behavior broken.

## KF-REMEDIATION-DISCOVERY-001 — legacy catalog settings can bypass the current spending policy

Related original gates:019,021,052. Classification: VERIFIED source behavior, production activation UNVERIFIED. Severity:High; priority:P1. Baseline:19c9592 through the previously verifiedbc04800 code. Candidate remediation is on remediation/a-free-cost-boundary, not yet independently integrated.

Source: chat-backend/src/routing-policy.js fullCatalog/providerPolicyStatus; providers.js freeModels/catalog admission; engine/runner.py full_catalog/provider_models/list_provider_models. Original tests explicitly expected named Kilo to include paid/model and full Gemini catalogs to include Pro, and allowed metered Hugging Face through a named flag. OpenRouter's existing capped Premium boundary was already stronger and must remain intact.

Root cause: catalog visibility and a legacy configuration opt-in were treated as general spending authorization. Free-provider/channel flags and model count/attempt caps do not enforce the owner's current rule: paid OpenRouter only through explicitly enabled capped Premium after free-route exhaustion.

Candidate solution: legacy flags expand only free pools/the existing free-eligible Flash family. Ordinary model admission rejects unreviewed/metered providers, paid classes and explicit nonzero/malformed prices, including in legacy routing modes and direct Python fallback. Provider probes report exclusions without implying a rejected key. The routing diagnostic carries a cost-policy version. The current free Small route can classify when tiny Mistral classifier models are not eligible. Existing Premium caps/defaults are preserved.

Evidence/tests: seven new Python/Node negative/positive pricing/catalog tests; retained fallback/64-attempt/three-send, provider-health, streaming, classifier and malformed-response tests run against approved simulated free pools. Original paid-positive assertions are replaced with stronger denials; no assertion is skipped to obtain success. A controlled fixture's declared eligibility is not a production price review. Full regressions/build/security/actual supported CI remain required before considering this candidate ready.

Limitations: application model eligibility cannot establish an upstream account's billing configuration or remaining free allowance. Dynamic Flash discovery retains the existing free-eligible family and excludes Pro/experimental classes; it is not a claim that every account/request is free. Quota/billing policy must be independently verified, as required by019/021. No live request or paid activation was made. This finding does not close the61-gap program or change its autonomy score.

Risk/rollback: fewer routes are eligible until reviewed; show a truthful capacity/configuration block rather than expanding into paid catalogs. Keep this change isolated and test normal free fallback before any owner-approved integration. Reverting must not silently authorize spending under the current owner policy; document any compatibility problem instead. Production rollout remains a separate owner decision.

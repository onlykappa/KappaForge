# Request-size recovery provenance — partial KF-AUDIT-017

The gateway emits413/request_too_large only when every route failed admission without an inference attempt. The Python adapter previously raised GatewayUnavailable with terminal=true. Although recovery.diagnose called this request_size, the existing source-context builder only handled GatewayRequestTooLarge or actual platform-resource errors, so this confirmed safe-to-rebuild request stopped before adaptation.

The adapter now uses GatewayRequestTooLarge only for that authenticated aggregate with gateway_guard/context_limit and no attempted/mixed upstream evidence. It retains status, route attempts and sanitized details, and never turns a spurious Retry-After into a provider-capacity wait. Callers without a safe builder still see a terminal error. Ambiguous or upstream size responses retain GatewayUnavailable, actual cooldowns and explicit dispatch uncertainty; they can no longer falsely claim a provider was not contacted.

Existing generation already reconstructs source excerpts for this error type. The same original task and scope remain intact, candidate edit validation still uses the full original source, and generated-proposal versus actual-request accounting remains separate. ReviewResources now rebuilds evidence for remote preflight refusals as well as local envelopes, with at most three decreasing-size adaptations and no invented persistent Cloudflare1102 ceiling. A full owner task that cannot fit stops unchanged before another inference. No raising quotas, guessed tokenizer substitution, paid escalation or silent output reduction.

## Tests and evidence

Two independently executed regressions fail on the previousba6a9ea in an isolated detached worktree: real adapter exception provenance and generation after remote rejection. The corrected branch passes38 focused tests. Six new cases prove the actual HTTP adapter carries the size type, generation preserves the owner task while reducing source and validates the exact edit, review rebuilding does not write platform-limit evidence, repeated size refusals allow only three smaller adaptations, unshrinkable scope is not sent repeatedly, and mixed/upstream lookalikes preserve uncertainty/cooldowns. Transport is scripted; no provider inference or production mutation.

Composed Python, structural scan, map and execution-policy results are recorded in TEST-EVIDENCE.md. Actual supported candidate CI/real sandbox remains required. No live#330, Groq/Mistral admission or50-task benchmark is inferred.

## Remaining request packing blocker

An offline call to the actual codingRequestBudget with current registry metadata shows that even a one-byte Groq prompt requests81 input tokens plus8192 output plus256 reserve =8529, exceeding the configured8000 free allowance. An explicit3000 output request instead requires3337 and fits. The normal tool loop requests16384, clamped to8192, so simply shrinking its input cannot make this route eligible. Silently squeezing a possibly large structured patch is not a fix. Next work must build explicit route-compatible compact task/tool packets and output contracts, preserving the full owner scope and retrievable source evidence, then calibrate token estimates and validate an actual eligible no-paid route. Mistral upstream request limits need their own bounded evidence. This increment repairs the exception/control-flow root cause without claiming the original017 acceptance is complete.

Rollback gateway error typing and bounded review adaptation together; keep the regressions, exact owner scope and all lifetime spend/cancellation records. No Worker/provider policy, production deployment, merge/release or cost setting changed.

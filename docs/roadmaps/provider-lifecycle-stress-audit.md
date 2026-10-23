# Full provider and lifecycle stress audit — 2026-10-23

Baseline application revision: `71cddc0f74737518210cf7fae930f1d11379c516` (PR #203 merged). Application changes remain isolated in [lab PR #9](https://github.com/onlykappa/kappaforge-lifecycle-lab-20261023-2acdc4/pull/9). Production [PR #207](https://github.com/onlykappa/KappaForge/pull/207) receives the roadmap only.

## Live provider experiment

All 15 registered providers were inventoried through the existing Cloudflare gateway. One discovered model per usable provider was selected; this is not every model, maximum concurrency, or an exhaustive benchmark. Missing routes were recorded, not bypassed by changing permissions. Provider credentials remained in Cloudflare. Synthetic requests consume real shared quota and update normal routing health/usage; no provider configuration or deployment was changed.

Trusted collection and credential-free evaluation ran in separate read-only GitHub jobs. Returned code ran only inside Docker with networking disabled, read-only filesystems, 256 MiB RAM, one CPU, a PID limit, dropped capabilities, and a 25-second execution timeout.

| Provider | Selected model | Chat eligibility snapshot | Successful HTTP replies / attempts | Mechanical contract passes / scores | Failure categories |
| --- | --- | --- | --- | --- | --- |
| gemini | `gemini-3.1-flash-lite` | approved | 1/6 | 1/1 | timeout ×3, provider_outage ×1, collector_network_error ×1 |
| workers-ai | `@cf/nvidia/nemotron-3-120b-a12b` | approved | 3/6 | 2/3 | invalid_json_response ×1, provider_error ×2 |
| ollama | `gpt-oss:120b` | approved | 3/6 | 3/3 | invalid_json_response ×1, concurrency ×2 |
| nvidia | `deepseek-ai/deepseek-v4.1-flash` | approved | 0/6 | 0/0 | timeout ×6 |
| kilo | `cohere/north-mini-code:free` | approved | 4/6 | 3/4 | invalid_json_response ×1, output_limit ×1 |
| unorouter | `None` | free_provider_permission | 0/0 | 0/0 | no discovered model |
| mistral | `codestral-2508` | approved | 4/6 | 3/4 | invalid_json_response ×1, output_limit ×1 |
| groq | `openai/gpt-oss-120b` | approved | 4/6 | 4/4 | context_limit ×1, output_limit ×1 |
| openrouter | `cohere/north-mini-code:free` | approved | 2/6 | 2/2 | collector_network_error ×1, invalid_json_response ×1, concurrency ×1, output_limit ×1 |
| requesty | `None` | free_provider_permission | 0/0 | 0/0 | no discovered model |
| zai | `glm-4.7-flash` | approved | 2/6 | 2/2 | timeout ×3, output_limit ×1 |
| cerebras | `None` | free_provider_permission | 0/0 | 0/0 | no discovered model |
| huggingface | `None` | metered_provider_opt_in | 0/0 | 0/0 | no discovered model |
| llm7 | `None` | free_provider_permission | 0/0 | 0/0 | no discovered model |
| ovh | `None` | free_provider_permission | 0/0 | 0/0 | no discovered model |

Collector totals: 54 attempted, 30 not run; stop reason: `None`. Strictly scored results: 20 passed, 3 failed. HTTP errors are not scored as reasoning failures.

Challenges: short availability reply; four-cause incident audit with an injected unsafe README; strict JSON Python implementation; the same implementation after roughly 47,000 characters of hostile distractors; forced short output budget; an immediate short recovery request. Coding evaluations test numeric edge cases, booleans, NaN/infinity, invalid entries, cooldown equality, stable ordering, quota/busy exclusion, and input immutability. These are fixed synthetic tasks and one sample per phase, not statistical model rankings.

Recorded usage is available for 23 responses: 16,508 input and 12,483 output tokens. Failed attempts and provider-side reasoning/billing may be missing; these are not total billed usage or a cost estimate.

Gemini limitation: the baseline router ignores a known bare Gemini model preference. Actual attempt metadata must be used instead of the selected-model label. A separate deterministic reproduction and lab fix establish this defect. Workers AI was tested via chat because the registry marks it agent:false; chat does not expose this harness output-budget control. Its cutoff test cannot establish the same 128-token condition.

The first collection used an invalid privateCode:false request envelope: coding calls were rejected HTTP 400 before inference. The next correction had a label-initialization error after the first request. Neither run is model-quality evidence. The final collector passed local payload-contract checks before rerunning. The original Workers AI replies are retained as preliminary evidence only.

## What the saved answers establish

Five routes (Kilo, Mistral, Groq, OpenRouter, Z AI) returned a normalization/output_limit outcome with upstream HTTP 200 and internal status 206, then returned HTTP 200 and LAB_OK on the immediate independent short request. That directly supports #203's healthy-route recovery behavior for those samples. Ollama was capacity-blocked after a long-context transport failure; NVIDIA was already in timeout cooldown. Those sequences do not prove an output-limit cooldown bug.

On the coding contract, Ollama, Mistral and Groq each passed all five hidden test groups. Workers AI returned a code string with double-escaped literal newlines, which became a Python SyntaxError. Kilo failed the strict JSON code envelope. Mistral wrapped its incident audit in Markdown fences and failed that strict JSON contract. Prompt-only JSON was requested; this benchmark did not enable the provider's responseFormat JSON mode, and does not establish that KappaForge's own parser would reject every such response.

The audit's automated check validates finding IDs and the self-declared injection-rejection flag, not causal correctness. Manual review found Workers AI incorrectly saying the trusted PR receipt was wrong; the evidence says the reviewer ignored a correct receipt. Ollama's wording that chat should be publicly writable is unsupported: normal chat still needs its existing bearer authentication, while task-operation authorization is separate. Treat these as reasoning/writing errors requiring evidence reconciliation, not recommendations to weaken authentication. Mechanical passes are not a model-quality ranking.

Large-context requests exposed structured gateway context rejection on Groq, timeout/capacity refusals on several routes, and non-JSON HTTP 503 responses on Workers AI, Ollama, Kilo and Mistral. The collector's first JSON-only decoder lost those bodies, so their exact origin is not established by the initial run. The follow-up transport probe captured response types, request bytes, Cloudflare request IDs and bounded redacted bodies. All six probes passed: roughly 51,000-character availability prompts and immediate short follow-ups on Ollama, Mistral and Workers AI. Thus input size alone did not reproduce the original long coding failures. Their exact earlier origin remains unresolved without the missing response bodies or Worker traces; retain that uncertainty and capture raw failure provenance on future runs. Do not relabel these gateway/transport failures as bad model reasoning.

The initial bind-mounted code evaluation was invalid because the runner's Docker daemon could not see host files; a stopped read-only container also refused docker cp. The corrected evaluator streams JSON source data into an isolated Docker-managed volume, then executes as an unprivileged user with that volume mounted read-only. The final scores were obtained only after a real Python and Node sandbox canary passed. Green evaluation CI means the experiment ran; individual model failures remain in evaluations.json.

## Deterministic findings and lab-only upgrades

1. **Generic Python imports falsely rejected.** The verifier accepts only engine/tools/scripts imports. A test importing app.calculator fails when the real helper is mutated, yet the verifier calls it a fake test. Lab upgrade resolves static AST imports against candidate repository paths, including custom packages, aliases, relative imports and src layouts. This establishes source linkage, not complete behavioral test quality; dynamic imports and runtime path manipulation need separate treatment.

2. **Explicit Gemini selection ignored.** fallbackRoutes recognizes only provider-prefixed manual labels, but Gemini uses bare model labels. The requested second Gemini model is replaced by the first. A failing-before/passing-after test verifies the lab-only recognition fix without broadening provider permissions.

3. **Experiment failure can be green.** tools/multi_agent_check.py catches exceptions and prints ok:false, then returns None. main exits zero. A mocked generation failure reproduces it without inference. The lab propagates failed generation, unfinished requirements and failed checks to nonzero process status. The previously successful live simple run did complete its two generated functions after reviewers rejected malformed first attempts; its green status alone is insufficient evidence.

4. **Missing test dependency.** tests/ui-chat.test.mjs imports jsdom but the root manifest does not declare it. Full Node discovery initially ran 788 successes plus one module-load failure. The lab declares jsdom and all 789 original Node tests pass. This is a test-inventory defect; the test itself simulates a small DOM fragment and does not establish correctness of the complete production UI.

5. **Dependency-map growth boundary.** Putting the new lab test modules in runtime/tests expanded the serialized map to 6,090 characters, violating the existing <6,000 assertion; the Worker slices the map to 6,000. Moving the independent lab harness outside the copied application preserves the baseline inventory, but does not fix future application growth. Implement explicit budget-aware valid serialization and a visible omitted-evidence record. Never truncate JSON mid-document.

6. **Existing complex check executes generated code with runner credentials.** The existing multi-agent-check workflow passes the router and GitHub tokens to tools.multi_agent_check. Its complex scenario runs generated Python/JavaScript as ordinary child processes, inheriting that environment and network access; file writes also join model-supplied paths without a containment check. The simple live scenario used here did not execute generated code. No exfiltration is alleged or attempted. The lab replaces host subprocess execution with restricted containers and rejects escaping paths; a real CI canary checks that host environment markers are absent, mounts are read-only and external networking fails. Port this boundary before broadening the old complex runner.

## Regression and chaos evidence

The copied application passes 473 Python tests in Linux CI with pinned structural-scan tooling. Seventeen additional Python lab tests cover 500 randomized valid/invalid package pairs, 1,000 poisoned missing-context errors, 1,000 malformed completion envelopes, failed-check refusal, runner exit status, path containment and sandbox command construction. 793 Node tests pass: 789 original plus four lab tests. Routing soak covers 1,500 cutoff/short-answer cycles across all 15 provider IDs, 90 same-clock partial-versus-real-failure cases, and 30 competing reservations per provider. These exercise the actual routing store with an in-memory transactional storage adapter, not live provider concurrency. Worker build dry-run passes. Desktop Chromium and mobile WebKit browser suites pass locally after selecting the bundled Python runtime through the existing PYTHON override; the first browser attempt stopped because Windows python3 was a Store alias. No deployment or native build occurs.

The earlier real GitHub replay created a draft, observed failed CI, repaired and pushed a candidate, observed green CI, and merged [test PR #6](https://github.com/onlykappa/kappaforge-lifecycle-lab-20261023-2acdc4/pull/6). Eight denial cases held: failed CI, absent merge authority, unfinished requirements, stale proof, non-fast-forward update, development push to main, stale merge SHA, and cancellation immediately before merging. Dedicated resume opened one saved draft and ignored duplicate continuation; the fresh-start orphan refusal is not a confirmed resume bug. Bot checkpoint provenance and downstream handoff were adapted/stubbed in that dedicated replay; see REPORT.md.

## Prioritized implementation roadmap

- P0: split trusted collection from credential-free execution; validate output paths, resource bounds, artifact provenance and failures. Make experiment exit codes reflect measured outcomes.
- P0: reconcile trusted PR receipts before model review and repair; preserve the original requirements and candidate identity. Never request workflow edits as source proof of an already-created draft.
- P1: port the generic Python import and explicit Gemini selection fixes with negative permission tests. Validate UI test discovery dependencies.
- P1: expose per-provider coding/chat eligibility and failure provenance, not a misleading missing-key diagnosis. Add general diagnostics beyond the existing Groq-only probe. Distinguish policy, discovery, cooldown, quota, transport, output limit and incorrect model output.
- P1: preserve leases and real failures across cutoff recovery; replay the exact live cutoff/short-response sequences and quota retryAt boundaries with fixed clocks. Keep #203 protections and exponential backoff for actual server errors.
- P1: make dependency-map serialization budget-aware and valid under growth; report omitted context explicitly.
- P1: derive required validations from a trusted task manifest; bind actual checkout SHA; prevent late or duplicate jobs from changing blocked task status.
- P2: add repeated, model-pinned samples only for permitted providers and report distributions, token use, failure provenance and statistical limits. Do not call unavailable routes a model failure or weaken policy to improve a score.

Future implementation prompt: Start from main after #203 and reproduce these findings using the saved fixtures. Port the isolated fixes in small commits, first address the credential-bearing complex runner and false-green experiment status, then import resolution and Gemini selection. Reconcile trusted lifecycle receipts separately from source review. Keep every authorization, protected-path, cancellation, candidate-SHA, no-merge and quota boundary. Do not change provider permissions or deploy. Keep PR #207 draft and report what remains unverified.

## Evidence files

[Live challenge run](https://github.com/onlykappa/KappaForge/actions/runs/39992066000), [corrected sandbox and regression run](https://github.com/onlykappa/kappaforge-lifecycle-lab-20261023-2acdc4/actions/runs/39993936865), [follow-up transport run](https://github.com/onlykappa/KappaForge/actions/runs/39994078055), and [live simple engine run](https://github.com/onlykappa/KappaForge/actions/runs/39989753918). The simple engine run rejected malformed first attempts and repaired both helpers in 35.7 seconds. It did not test native build or release paths.

The [disposable lab evidence directory](https://github.com/onlykappa/kappaforge-lifecycle-lab-20261023-2acdc4/tree/lab-v2/audit-upgrades/evidence) contains sanitized catalog, capabilities, selections, request outcomes and sandbox evaluations. provider-stress/ contains the exact trusted collector and evaluator. Tests and upgrades are in runtime/ and lab-tests/. The temporary production runner branch is removed after artifacts are secured. The private disposable lab remains available for further testing, with no scheduled provider workload and no provider credentials stored in it.

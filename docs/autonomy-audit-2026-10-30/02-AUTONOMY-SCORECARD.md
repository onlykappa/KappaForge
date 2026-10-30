# Autonomy scorecard

Audit snapshot: 2026-10-30 UTC. Default branch `main`, commit `19c95923d12156688487fd8d4e1f6dd1c16eefa6`. Documentation-only branch `audit/autonomy-2026-10-30`. No inference requests, workflow dispatches, merges, releases, deployments or production configuration changes were made by this audit.

Evidence labels: VERIFIED = directly observed implementation or execution (the evidence specifies which); PARTIAL = implementation exists with material limits; BROKEN = observed failure or deterministic incorrect behavior; MISSING = no implementation found in the inspected execution surfaces; UNVERIFIED = insufficient execution/access evidence; NOT APPLICABLE = outside the declared supported scope. Source verification is not production verification.

Provisional overall autonomy: **41.63/100 (rounded 42/100)**. Plausible evidence-constrained range **32–54**; this is a judgment range, not a statistical confidence interval. Scores measure application workflow maturity against the requested broad scope, not intelligence or model quality.

Method: 0 absent; 25 narrow source/prototype support; 50 useful bounded behavior with substantial live limitations; 75 repeatably successful representative workflows and fault recovery; 90 sustained high reliability on held-out supported tasks; 100 declared-scope gates met. Source-only capabilities receive limited credit. Recent live failures override optimistic API/file presence. No broad task-success rate is inferred from unit-test counts.

| Category | Weight | Score | Contribution | Confidence | Evidence / score-raising gates |
|---|---:|---:|---:|---|---|
| Task understanding and planning | 8% | 45/100 | 3.60 | Medium (runtime lower) | requirements.py, task_plan.py; 30/40 probe; gaps 001,004 |
| Agent reasoning and adaptive strategy | 10% | 32/100 | 3.20 | Medium (runtime lower) | developer.py, repair_strategy.py; #322 recurring anchors; gaps 007,010,011 |
| Tool use and environmental interaction | 12% | 38/100 | 4.56 | Medium (runtime lower) | tool_loop.py, exploration.py, sandbox_tools.py; #322 reads; gaps 015,028–033 |
| Autonomous execution and validation | 15% | 42/100 | 6.30 | Medium (runtime lower) | sandbox_repair_controller.py; #330 passing tests/incomplete review; gaps 001–003,011 |
| Error recovery and self-correction | 12% | 35/100 | 4.20 | Medium (runtime lower) | recovery.py; #322 invalid_limit and later closed draft; gaps 007–010 |
| Model routing and provider resilience | 8% | 52/100 | 4.16 | Medium (runtime lower) | routing-policy.js, inference-router.js; #330 free fallbacks; gaps 016–021 |
| Memory and context management | 7% | 38/100 | 2.66 | Medium (runtime lower) | project_memory.py, app-state.js; vault source only; gaps 025–027 |
| Long-running task persistence | 7% | 50/100 | 3.50 | Medium (runtime lower) | execution.py, runtime_engine.py, recovery.py; saved #322 candidate; gaps 022–024 |
| Research and external information | 5% | 25/100 | 1.25 | Medium (runtime lower) | research.py, research-hosts.json; curated docs only; gaps 028–031 |
| Security and permission enforcement | 6% | 48/100 | 2.88 | Medium (runtime lower) | intent_guard.py, sandbox.py; workflow premerge exposure; gaps 035–041 |
| User experience and progress transparency | 4% | 55/100 | 2.20 | Medium (runtime lower) | app-tasks.js/progress_notes.py; stale testing #330; gaps 042–046 |
| Testing, observability and reliability | 6% | 52/100 | 3.12 | Medium (runtime lower) | 1452 Python /924 Node; no broad benchmark; gaps 047–052 |

Calculation: sum(category score × percentage weight)/100 = **41.63**. Weights total 100%. Machine-readable values: evidence/scorecard.json.

Planning understands narrow requests and has durable task plans, but cannot silently discard requirements. Adaptive strategy has repair plans and feedback, yet #322 repeatedly fails at the same anchor and finally at response parsing. Tool use gets credit for actual sandbox execution and dynamically selected reads, not for nonexistent browser/desktop capabilities. Execution gets credit for exact-candidate test gates and no-merge drafts, with a substantial penalty for incorrect test evidence and blocked completion verification. Recovery exists; five labels are not five causal strategies. Routing has real fallback and durable health, but three strong routes are ineffective in #330. Memory and persistence are materially implemented but not proven through broad device/restart scenarios. Research is documentation research, not general web research. Security has strong sandbox design and authority checks, but workflow privilege and current deployment settings are unresolved. UX uses real receipts with observed stale state. Testing is extensive yet poorly predictive of broad autonomous delivery.

Separate provisional dimensions (not combined into intelligence):

| Dimension | Estimate | Range | Basis |
|---|---:|---:|---|
| Architecture maturity | 48/100 | 38–60 | Durable but fragmented coding controller, gateway and projections |
| Feature completeness | 32/100 | 25–42 | Broad assistant surfaces absent despite useful coding core |
| Operational reliability | 38/100 | 25–55 | Recent failed task chains, no production SLO denominator |
| Security readiness | 45/100 | 30–60 | Enforced boundaries plus unresolved privileged-workflow risk |
| Production readiness | 35/100 | 25–50 | No broad acceptance evidence, native failure, deployment unknowns |
| Benchmark task success | NOT YET MEASURED | — | 50-task suite not run with actual models |

Local results: Python 1,452 tests, OK, 36 skipped; Node 924 passed; PR #331 direct tests 9 passed. Report 08 separates these from production receipts and missing checks. Every score should rise only after its referenced acceptance gate passes; phase estimates in report 07 are ceilings, not automatic points.

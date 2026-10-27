# Architecture inventory — checkpoint 3.1b

**Inspected main:** [42272f41b30b7d59b5b891ad083f6fccb321c46f](https://github.com/onlykappa/KappaForge/commit/42272f41b30b7d59b5b891ad083f6fccb321c46f). Source and workflow definitions inspected on 2026-10-27 UTC. This corrected inventory is proposed in repair PR #300; it does not mark the overall Phase 3.1 audit complete.

| Component | Entry files and responsibility |
| --- | --- |
| Web UI | [preview/index.html](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/preview/index.html) loads classic scripts in order; [preview/app-main.js](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/preview/app-main.js) contains app startup and messaging. `preview/app-dashboard.js` renders dashboard/review UI; it is not the page entry point. |
| Native iOS shell | [ios/KappaForge/KappaForgeApp.swift](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/ios/KappaForge/KappaForgeApp.swift) declares `@main` and opens `RootView`. It hosts `KappaWebView`, whose implementation in `ios/KappaForge/KappaWebView.swift` loads the bundled web UI and handles native bridges. |
| Cloudflare Worker | [chat-backend/src/index.js](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/chat-backend/src/index.js) exports the Worker request handler and connects request routing to the imported chat, GitHub, task and inference modules. |
| Python agent | [engine/runner.py](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/engine/runner.py) is invoked as `python -m engine.runner` by the agent workflow. It selects the authorized task and dispatches analysis/development/recovery; `engine/developer.py` implements generation and review, and `engine/execution.py` tracks sandbox proposals. |

## Configuration

`preview/settings.js` implements settings UI and preference handling; it is not the central project configuration. `.kappaforge/owner-preferences.md` records owner preferences, not all runtime configuration.

| File | Responsibility |
| --- | --- |
| [config/app.json](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/config/app.json) | Central app identity/version, runtime-version declarations and web/native bundle locations; scripts/configure.py generates derived configuration. |
| [chat-backend/wrangler.toml](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/chat-backend/wrangler.toml) | Worker entry module, bindings, variables and deployment resource configuration. Declares CPU 300000 ms, 10000000 subrequests and global day/minute throttles 0. |
| [config/projects.json](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/config/projects.json) | Registered project policies and recovery budgets; provider consumption counters are distinct from these policies. |
| [config/providers.json](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/config/providers.json) | Provider catalog and routing defaults, including request/context/output bounds. |
| [config/execution-infrastructure.json](https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/config/execution-infrastructure.json) | Reviewed execution infrastructure/workflow policy. It does not prove a workflow actually ran. |

## CI and orchestration

Definitions are pinned in the [workflow directory](https://github.com/onlykappa/KappaForge/tree/42272f41b30b7d59b5b891ad083f6fccb321c46f/.github/workflows). Key entry files:

| File under `.github/workflows/` | Responsibility |
| --- | --- |
| `tests.yml` | Python unit, structure, Worker and web regression jobs. |
| `agent.yml` | Classifies owner tasks and runs read-only analysis or authorized development; includes router diagnostics. |
| `sandbox-tests.yml` | Secret-free validation of an exact agent candidate. |
| `project-tests.yml` | Validation of a candidate in another registered project. |
| `review-graph.yml` | Risk/review graph generation for a candidate; separate from task fulfillment. |
| `ios-build.yml` | Native iOS build, simulator checks and artifacts. Manual branch validation does not publish a release; release is separately conditioned. |
| `deploy-chat.yml` | Worker deployment inspection, validation and deployment. Its presence is not evidence of deployment for this audit. |
| `recovery.yml` | Resumes eligible authorized development checkpoints. |

Complete workflow filename inventory from that commit’s Git tree (22 files):

`agent.yml`; `ai-audit.yml`; `authorized-completion.yml`; `continuous.yml`; `deploy-chat.yml`; `free-llm-drift.yml`; `ios-build.yml`; `lifecycle-simulation.yml`; `live-usage-check.yml`; `multi-agent-check.yml`; `openrouter-review.yml`; `premium-smoke.yml`; `project-tests.yml`; `provider-check.yml`; `recovery.yml`; `research-live.yml`; `review-graph.yml`; `sandbox-selftest.yml`; `sandbox-tests.yml`; `stop-legacy-native.yml`; `task282-progress.yml`; `tests.yml`.

## Evidence and limits

The descriptions above come from source, configuration and workflow definitions. The workflow filenames are enumerated from the complete pinned Git tree; they are not unknown. File existence and configuration values do not demonstrate runtime behavior, deployment, provider capacity or native device acceptance.

Repair regression/CI results are reported on PR #300 against its exact final commit. No additional live model run, native device test, deployment, release or cross-phase acceptance is claimed by this document. PRs #284 and #299 remain separate drafts; this correction does not rewrite their history or recovery checkpoints. Stop at 3.1b; no 3.1c work is included.

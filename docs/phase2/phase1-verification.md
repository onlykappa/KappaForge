# Phase 2 section 1: Phase 1 verification

Phase 1 is merged into `main`: #262 (Step 7, free execution and resource admission), #263 (Step 8, acceptance
tests) and #265 (fix for the agent workflow that GitHub rejected after #262). This branch is based on that `main`.
Phase 2 reuses each component below; none is duplicated.

## Components Phase 2 builds on (verified in source)

| Component | Where | Phase 2 use |
| --- | --- | --- |
| Isolated sandbox: exact revision, uncommitted candidate, command policy, limits, no secrets or network | `engine/sandbox.py` (`Session`, `Policy`, `PROFILES`, `open_session`, `redact`) | Section 7 runs focused tests on the same session; the research interface (section 5) stays outside it, because sandbox commands have no network by design |
| Tool schemas and dispatcher | `engine/tool_loop.py` (`TOOL_CATALOG`, `run_tool_loop`), `engine/sandbox_tools.py` (`SandboxTools`) | Section 2 adds read-only exploration tools to the same catalog and loop; section 2 replaces `max_steps` with call, time, output and context budgets |
| Repair controller: attempts, repeated-patch and identical-error stops, final regression | `engine/sandbox_repair_controller.py` | Section 7 interleaves exploration with its repair actions |
| Execution checkpoints and recovery journal | `engine/execution.py` (`Execution`, `pending`, `seed`, `save_plan`), `engine/recovery.py` (`Journal`), `engine/generation_checkpoint.py` | Section 3 persists the evolving plan here; section 6 pauses and resumes from it |
| Verified task state and goal | `engine/task_state.py`, `engine/task_goal.py` | Section 3 extends the goal into the evolving plan instead of adding a parallel record |
| Authorization guard | `engine/intent_guard.py` (`ExecutionScope`, `activate`, `guard_request`) | Section 4: classification never widens it; section 6: only the authorized owner's answer resumes a task |
| Free-execution admission | `engine/infrastructure.py` (`authorize_dispatch`, `runtime`, `resources`), `chat-backend/src/free-execution.js`, `scripts/execution-policy.py` | Unchanged; every job Phase 2 starts passes it |
| Owner guidance and retry | `engine/developer.py` (`Guidance:` comments), `chat-backend/src/agent-work.js` (`sendGuidance`, `retryTask`) | Section 6 delivers the clarifying question and the owner's answer through these paths |
| Progress card | `engine/developer.py` (`Progress`), `preview/task-progress.js`, `preview/ui.js` | Phase 2 work is reported on the same card; the structured transcript is in #266 |

## Errors found and fixed

- **The agent workflow was invalid on `main` after #262** (fixed in #265). Step 7 gave the agent code job a second
  `permissions` block. PyYAML keeps the last value, so every local check passed; GitHub rejects duplicate keys, so
  no agent task could start. The extra block is removed, and `scripts/execution-policy.py --check` (run on every PR)
  now rejects any duplicate workflow key. Task #267's agent run then succeeded from `main`.
- **`README.md` said browser regression tests no longer run**, but the tests workflow's `web` job runs
  `npm run test:web` on every PR, against the app screens the IPA bundles. The README is corrected here; the
  tests stay.

## KappaForge's own verification (task #267)

KappaForge ran this section as a read-only analysis task (#267, `gemini-3.1-flash-lite`, HEAD `f249874`), visible in
the app under Agent tasks. Checked against the source:

| Its claim | Verdict |
| --- | --- |
| `README.md` says the browser regression tests are retired while `package.json` still has `test:web` | **Correct inconsistency, wrong fix.** It proposed deleting the tests; they run in CI and protect the app screens, so the README is what was wrong. |
| #265 fixed duplicate keys "that GitHub's parser would silently ignore" | **Inverted.** GitHub rejects them; PyYAML silently ignores them. |
| `execution-policy.py` should be added to CI via `continuous.yml` | **Wrong.** It already runs in the tests workflow on every PR. |
| Phase 2 must make the agent check free capacity before generating code | **Already done.** The agent code job runs the `engine.infrastructure` preflight before model work, and every sandbox command rechecks admission. |
| Sandbox, tool loop, guard and admission "confirmed" | **Unsupported by its evidence.** It saw only `tests/test_infrastructure.py` referencing them, not their source. |
| No Phase 2 roadmap in `docs/` | True on `main`; the roadmap lives on this PR. |

Why: analysis mode (`engine/handoff.py` `collect`) reads only the HEAD commit's changed files plus at most eight
3,500-character excerpts. A verification task cannot look further, so it reasons from the few files it was given.
This is the fixed-file, single-pass limitation Phase 2 replaces (sections 2, 3 and 7), and #267 is the baseline to
compare against once exploration lands.

## Not yet proven in production

- The agent code job's free-execution preflight on a real **development** task: #267 ran in the read-only `analyze`
  job, which does not run it. The Phase 1 acceptance suite proves the same admission on the sandbox self-test runner.

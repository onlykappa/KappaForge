# Phase 1 roadmap: pre-commit execution sandbox and autonomous repair

Goal: KappaForge applies its edits in an isolated workspace, runs the project's real checks, repairs what fails and
validates the result **before** the first commit or draft PR. Everything runs on cloud infrastructure (GitHub Actions);
the owner's phone or computer never needs to stay online.

Tracking: one branch (`phase1/execution-sandbox`) and one draft PR. Boxes are ticked only when the step's code, tests
and documentation are on the branch. Nothing here is merged, deployed or released by KappaForge.

## Progress

- [x] **1. Investigate before modifying** ([execution architecture](../phase1/execution-architecture.md)): map the real execution path, workflows, checkpoints, test dispatch, retry
      architecture, limits, provider routing and every existing security control; document the execution architecture.
- [x] **2. Isolated execution sandbox** (`engine/sandbox.py`, [step 2 notes](../phase1/execution-architecture.md#step-2-implementation-enginesandboxpy)): short-lived, isolated workers on existing GitHub Actions infrastructure; exact
      revision fetch; uncommitted edits; controlled commands; lockfile installs; extensible toolchain adapters; test
      command detection; per-session results; cleanup; no credentials in the sandbox; resource, network and output limits.
- [x] **3. Development tool loop**: structured tools (`apply_patch`, `run_command`, `run_tests`, `inspect_test_results`,
      `read_execution_log`, `inspect_diff`, `revert_candidate_change`) with machine-readable results; the agent picks
      the next tool from the last result. Implemented by `engine/sandbox_tools.py` and `engine/tool_loop.py`;
      [step 3 validation and interface notes](../phase1/testing-report.md#step-3-development-tool-loop).
- [x] **4. Test-driven autonomous repair**: generate, apply, test, diagnose, correct, retest; up to five meaningful
      attempts per candidate; repeated-patch, identical-error and loop detection; final regression run; commit and draft
      PR only after validation; honest failure reports that keep the diff and logs.
- [ ] **5. Persistent checkpoints and recovery**: reuse the recovery journal for the task, base revision, candidate patch,
      commands, results, repair history, error fingerprints, provider usage and stage; resume without redoing finished
      steps after verifying the workspace and revision.
- [ ] **6. Execution diagnostics**: live command, real elapsed time, pass/fail/skip/blocked states, error category and
      evidence, attempt number and changes, final validation; bounded, sanitized logs in the task history.
- [ ] **7. Cost and resource enforcement**: free-first only; check permissions and free capacity before choosing
      infrastructure; stop with an actionable explanation instead of falling back to unsafe or billable execution.
- [ ] **8. Tests and acceptance**: automated proof of every Phase 1 acceptance requirement, including a realistic faulty
      fixture that passes only after an agent-driven repair; testing report that separates checks that ran from checks
      that were only inspected.

## Deliverables (end of Phase 1)

- [ ] Implementation and regression tests
- [x] Execution architecture documentation and diagram
- [x] Sandbox threat model
- [x] Operating limits (step 2 profiles; revisited in step 7)
- [ ] Testing report (ran vs. inspected), [kept per step](../phase1/testing-report.md)
- [ ] Readiness criteria for Phase 2

Phase 2 and Phase 3 are out of scope, apart from minimal reusable interfaces Phase 1 needs.

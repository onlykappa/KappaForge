# Phase 3.1c remaining workflow and client inventory

Inspected source: combined revision0b1e4dc (2026-10-28), containing #279 f5501afe, #309 a1e7050 and #310 publication tests. All 23 workflow filenames are accounted for below. This records source inspection; it does not claim every workflow was executed or every production credential/environment inspected.

| Workflow | Entry, authority and mutation boundary |
| --- | --- |
| agent.yml | Read-token task_scope classification selects owner-authorized task and separates read/write jobs. Code runs only for explicit workflow_dispatch and write scope. Runner rechecks scope, activates the task and validates trial-engine provenance; request() rereads the owner issue before GitHub writes. Failure finalization edits only the matching bot snapshot and records recovery rather than assuming completion. |
| continuous.yml | Separate read/write job tokens and required modes. continuous.main selects eligible owner tasks, activates each scope and rechecks mode; read scans never enter the repair queue. continuous_code/repair_loop use original task/candidate authority. |
| recovery.yml | Fixed trusted scanner and task identity; saved-scope/candidate and continuation checks remain the authority. See recovery-control-policy-review.md. |
| task-intake.yml | Owner issue eligibility, production ExecutionScope, fixed main agent dispatch and bounded deduplication; see task-intake-policy-review.md. |
| task282-progress.yml | Fixed issue282/PR284 monitor, main-only job, open owner-task/open-draft checks, bot checkpoint, complete active-run window and durable pre-dispatch debit. Unchanged candidate/engine suppresses retries; maximum three dispatches. Closed task/PR stops the monitor. No merge or release path. |
| ai-audit.yml | Owner /audit-code comment, task label and non-PR event; fixed main agent dispatch. Engine admission must independently confirm open owner task; reaction does not prove execution. |
| sandbox-tests.yml | Trusted validation workflow executes the exact candidate in the sandbox. Notification/fix requests require task-branch/full-SHA validation and current-head reread; test success alone does not complete requirements. |
| project-tests.yml | Token-bearing fetch packages exact external owner-repository SHA without git metadata; permissions-empty verify executes project tests. No-test detection is explicitly a separate outcome, not evidence that tests passed. |
| sandbox-selftest.yml | Standard hosted capacity admission; read-only token; real Docker isolation, tool-loop fixtures, Phase1/2 acceptance fixtures and project suites. No publication/merge/deploy step. |
| tests.yml | Unit, web, Worker build/runtime checks and structural rules/scan; no candidate publication or lifecycle endpoint. |
| review-graph.yml | Validates manual repository/task branch/SHA inputs. Fetch packages source/history; analyze has empty permissions and parses code. Publish holds PR-write authority only and updates the authenticated workflow identity's marked comment on the selected PR. Candidate analysis is not merge authority. |
| authorized-completion.yml | Main helper verifies task, unique PR, candidate SHA, requirements and independent checks. Final result is owner_merge_required with no lifecycle write; see workflow-lifecycle-policy-review.md. |
| ios-build.yml | PR/manual builds validate native code and unsigned IPA; exact task/SHA report callbacks recheck head. Separate release job is gated to successful native job plus main push. It never releases on our PR runs. |
| stop-legacy-native.yml | Only active superseded same-repository/main native runs; excludes manual agent builds and rereads source/status before cancellation. Remote read/cancel is not atomic. |
| deploy-chat.yml | Validation precedes production-environment deployment; inspect is separate. Push-main/explicit manual operations use existing credentials and health/rollback/binding checks. Not dispatched by this audit. |
| free-llm-drift.yml | Reads public provider list and writes/updates one labelled drift issue, not provider configuration or source. An unchanged report produces no update. |
| live-usage-check.yml | Explicit diagnostic branches/manual entry; invokes configured gateway/app probes, then force-publishes artifacts to fixed live-usage-check-results branch. This is a separate operator workflow outside task candidate publication. It was not run here; its result branch is not main or an authorized candidate. |
| openrouter-review.yml | Dedicated diagnostic branch; free-model requests and summary only; contents-read token. No repository publication. |
| provider-check.yml | Explicit manual provider reachability requests; contents-read token. Credential availability is not blanket execution authority. Not dispatched here. |
| multi-agent-check.yml | Dedicated diagnostic branches/manual entry; in-memory project simulation, contents-read token. No repository publication. No delegation was launched during this audit. |
| lifecycle-simulation.yml | Explicit diagnostic branch/manual entry; simulated GitHub transport with real-host refusal, generated code only in isolated sandbox. Reports are artifacts, not real PRs. Not dispatched here. |
| research-live.yml | Read-only allowlisted documentation research; no credentials or repository write. Exact #279 live result is separately recorded in regression-ci-evidence.json. |
| premium-smoke.yml | Dedicated paid-smoke branch, explicit small paid-test scenario and contents-read token. It is not part of free validation and was not launched by this audit. |

The production Python developer, coder and self_repair clients route GitHub mutations through runner.request (coder.gh imports it). continuous also activates scope per selected issue. The request guard is not claimed to govern standalone operator workflows, non-GitHub provider calls, browser fetches or the separate authenticated Worker. Their entry points are recorded here or in backend-merge-policy-review.md and recovery-control-policy-review.md.

## Executed checks and boundaries

Combined source: workflow_safety, validation_workflows, coder, continuous, continuous_code, task282_monitor, free_list_check, runtime_engine, intent_guard and phase1_acceptance:93 run, OK,12 skipped (environment-dependent execution checks). An initial command named nonexistent tests.test_task_scope and failed import; corrected selection includes TaskScopeTests from test_workflow_safety. No production edit was needed for that command error. Broader combined discovery:1,220 run, OK,31 skipped; Node880 passed; see combined-delivery-audit.md.

Existing main-push release/deploy automation and separate operator diagnostic grants are current repository behavior, not proof of future Phase3.7 action-specific lifecycle grants. Phase3.2 review ingestion must remain read-only and cannot invoke those paths; implementing separate grants remains explicitly tracked in the roadmap's Phase3.7. No deployment, release, access change or branch-protection mutation was performed or accepted here. Production environment approval settings, real-device behavior and paid diagnostics remain untested.

This closes the filename/entrypoint inventory gap; it does not close #308's automated source-proof gate or establish a universal race-free authorization guarantee. Do not describe source inspection as live lifecycle acceptance.

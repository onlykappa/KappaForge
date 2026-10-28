# Phase 3.1c — selected workflow lifecycle boundaries

Source inspection on accumulator `72f8c9a3562b296b336d2b3331d4bc658082ba42`, 2026-10-28 UTC. This checkpoint extends the backend and intake traces. It is not a complete review of every workflow and helper. No workflow was dispatched or changed for this inspection.

| Entry | Source-to-action boundary inspected | Limit |
| --- | --- | --- |
| authorized-completion.yml | Successful workflow-dispatch completion of Sandbox branch tests or Project tests checks out main and invokes engine.authorized_completion. The helper checks originating repository, main ref, expected workflow path, exact branch/SHA title, original task authority, unique PR, candidate head, requirements, checks/statuses and applicable native build. Even a verified merge-authorized task returns owner_merge_required and sends no merge request. | The job's write permissions exceed this helper's current read-only outcome. Permission minimization is not part of this repair. Existing tests establish the helper's behavior, not live workflow delivery. |
| ai-audit.yml | An owner-authored /audit-code comment on a labelled non-PR issue dispatches fixed agent.yml on main with only the issue number, then adds a reaction. | Its event filter does not itself check issue author/open state; execution admission must recheck the actual task. A reaction is not execution completion. |
| stop-legacy-native.yml | Reads main, paginates iOS runs, selects only active same-repository main runs with different valid SHAs, excluding workflow_dispatch agent builds. It rereads main and each selected run before POST cancellation. | Remote reread and cancellation are separate operations. No cancellation was sent during this audit; selector execution was not separately tested in this checkpoint. |
| sandbox-tests.yml notification | A failed exact-candidate validation may dispatch agent.yml fix on main only for kappa/dev-N and after checking the branch still has the tested full SHA. Reports likewise require that head and carry task/SHA/result metadata. | These shell source checks are not a live callback demonstration or proof of atomic dispatch against later head movement. |
| ios-build.yml agent report | Exact kappa/dev-N/full-SHA reporting rechecks current branch before posting result or dispatching a fix. Validation markers explicitly say workComplete:false. | Build success is validation evidence, not requirements acceptance. |
| ios-build.yml release | Release is a separate contents-write job after successful native validation, restricted to push on main. It checks whether newer main contains app changes, skips superseded builds and never replaces an existing release version. | Inspection does not establish a separate future Phase 3.7 release grant. Nothing was released. |
| deploy-chat.yml | Inspect is separated from validation/deployment. Deployment uses cloudflare-production, validation prerequisite, configured credentials, binding snapshots, health checks and rollback. Main pushes on listed paths and explicit operation dispatches can enter this workflow. | Production environment approval settings and credential distribution were not inspected. This audit does not authorize deployment or exercise rollback. |

Executed on the same working source:

```sh
PATH=/workspace/kappaforge-venv/bin:$PATH python -m unittest tests.test_authorized_completion tests.test_native_build -v
```

18 passed, zero failures/skips, with fake transport. Coverage includes waiting for the owner without writes, failed/pending checks, forbidden/foreign workflow origin, original no-merge authority, stale candidate rejection, native-build requirements, exact candidate dispatch identity and refusal to build another task's branch. These are existing regressions, not 18 new tests or live native execution.

Remaining: fully trace agent/continuous job and direct-client paths, task282 monitor, review/report workflows and any remaining provider/diagnostic workflows with mutations; reconcile against the architecture inventory; then validate the combined delivery revision. Earlier Python-helper, publication, backend and intake traces retain their own pinned snapshots and limits. Phase 3.1 remains incomplete.

Follow-up: [complete workflow entrypoint inventory](workflow-entrypoint-inventory.md) accounts for all23 files and the remaining direct-client/monitor/diagnostic paths, with93 tests run successfully (12 skipped). Its source-versus-execution and future Phase3.7 limits remain explicit.

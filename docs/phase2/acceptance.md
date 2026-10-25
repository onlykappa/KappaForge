# Phase 2 acceptance

Every row of the roadmap's acceptance table maps below to executable assertions. Test names are relative to
`tests/`. `unit` means the `KappaForge tests` workflow's `unit` job (`python -m unittest discover -s tests -v`);
`web` runs `npm test` and browser regression. `sandbox` means the `Sandbox self-test` workflow's real-Docker job;
`research` means the `Research live check` workflow's live, allowlisted network job. Run evidence and limitations
are recorded separately in [testing-report.md](testing-report.md).

| Acceptance requirement | Automated proof | CI job |
| --- | --- | --- |
| Relevant files absent from the initial plan are discovered | `test_exploration.InvestigationTests.test_a_file_absent_from_the_initial_plan_is_discovered_read_and_added`; checks the new file is actually read and added, not merely named | unit |
| More than eight follow-up reads are possible within configured limits | `test_exploration.ExplorationToolTests.test_more_than_eight_follow_up_reads_fit_the_configured_budget`; twelve successful reads | unit |
| New errors cause further investigation | `test_phase2_exploration_repair.ExplorationRepairTests.test_each_new_error_causes_further_investigation`; missing export followed by a new missing name, each with evidence in the next patch prompt | unit; real failure sequence also asserted by sandbox |
| Tool loops terminate safely when budgets are reached | `test_exploration.BudgetTests.test_each_budget_runs_out_and_says_which` and `test_the_tool_loop_stops_safely_when_a_budget_is_spent`; call, time, output and context limits, no further tool/model calls; `test_phase2_exploration_repair.ExplorationRepairTests.test_the_exploration_budget_is_bounded` | unit |
| Documentation retrieval records provenance | `test_research.ProvenanceTests.test_every_fetch_records_its_source_time_size_and_digest`; live tests check time, digest and allowed final host on actual responses | unit; research (`test_research_live.LiveResearchTests`) |
| Unsupported API claims are not treated as verified | `test_research.ClaimTests.test_only_quoted_claims_from_fetched_pages_are_verified`, `test_api_checks_flag_deprecated_and_undocumented_symbols`, `test_unavailable_research_is_reported_not_invented`; nonexistent sources, false/empty quotes and offline research cannot verify claims | unit; research checks real deprecated APIs |
| Requirement classification works across several phrasings | `test_requirements.PhrasingTests.test_each_kind_is_recognized_across_phrasings` and `test_a_negated_owner_action_is_a_restriction_not_a_request` | unit |
| Classification cannot bypass authorization | `test_requirements.AuthorizationTests.test_classification_cannot_bypass_authorization` and `test_nothing_in_classification_touches_the_execution_scope`; real guard refusal and structural separation | unit |
| Ambiguous tasks pause and ask one question | `test_clarification.PipelineTests.test_an_ambiguous_task_pauses_asks_once_and_resumes_with_the_answer`; duplicate wake calls no planner; `JournalTests.test_asking_saves_the_question_and_marks_only_this_task_waiting`; `clarification-ui.test.mjs` verifies question status and attention | unit; web |
| The authorized owner's answer resumes the exact task | `test_clarification.AnswerTests.test_only_the_owners_guidance_after_the_question_answers_it`, `test_answers_leave_the_checkpoint_identity_unchanged`; `JournalTests.test_asking_saves_the_question_and_marks_only_this_task_waiting` refuses a different task; `PipelineTests.test_an_ambiguous_task_pauses_asks_once_and_resumes_with_the_answer` | unit |
| A paused task keeps its repair history and sandbox state | `test_clarification.RepairPauseTests.test_a_paused_repair_keeps_its_state_and_resumes_exactly`; candidate, phase, attempts and history survive, with no regeneration | unit |
| No unnecessary new PR is created during clarification | `test_clarification.PipelineTests.test_an_ambiguous_task_pauses_asks_once_and_resumes_with_the_answer` and `test_a_repair_pause_opens_no_pr_and_saves_the_question`; zero PRs/branches while waiting, one PR after the answer | unit |
| End-to-end: an initially unknown file dependency is discovered and fixed | `test_phase2_exploration_repair.ExplorationRepairTests.test_an_unknown_file_dependency_is_discovered_and_fixed`; `RealSandboxExplorationRepair.test_the_unknown_dependency_is_discovered_and_fixed_in_the_real_sandbox` runs the shop fixture in real Docker, investigates two actual errors, runs focused and full tests, and asserts no code publication during repair | unit; sandbox |

## Additional regression coverage

- `test_task_plan` proves reasoned revisions, bounded history, evidence rendering and checkpoint identity, including
  resume without planning again. `test_requirements.MatrixTests` proves that behavioral work without an accepted
  test citation remains open.
- `test_research.BoundaryTests` covers host and redirect restrictions and private-data refusals. `BudgetTests`
  proves pagination reuses the fetched page rather than spending network and byte budgets repeatedly.
- `test_repair_root_causes` proves line-number source evidence, requirement-id owner evidence, partial verifier
  replies, and separation of review-process notes from code defects. The `ReverifyTests` pipeline regression
  invokes `fix_pull_request` with no source changes: both clean and still-incomplete fresh reviews update the
  existing draft's title/body and task comment, without sandbox execution, commits or test dispatch.

The Docker fixture uses a scripted repair agent and the production controller, journal, tools and Docker sandbox.
It proves the execution and evidence path deterministically; it does not measure a live model's coding quality.
The clarification pipeline uses a stateful GitHub test boundary, not a live phone or production task.

Architecture, boundaries and policy: [Phase 1 reuse](phase1-verification.md), [exploration](exploration.md),
[task plan](task-plan.md), [requirements](requirements.md), [research allowlist and data rules](research.md),
[clarification](clarification.md), and [sandbox investigation](sandbox-exploration.md).

## Audit regression coverage

[Audit repairs](audit-hardening.md) adds `tests/test_phase2_audit_repairs.py` to the ordinary `unit` suite: immutable
npm validation scripts, final-candidate requirement/flag checks, live source registration for research, encoded URL
refusals and Fix it owner clarification/resume. The additional real-Docker npm bypass regression in
`tests/test_phase1_acceptance.py` runs in the existing `sandbox` job. No earlier acceptance check was removed or disabled.

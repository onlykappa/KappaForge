# Phase 1 Step 8: acceptance requirements and their tests

Every Phase 1 acceptance requirement has a named test in `tests/test_phase1_acceptance.py`. Tests marked **Docker**
run real containers through the production sandbox, repair controller, recovery journal and authorization guard; CI
runs them in the *Sandbox self-test* workflow on a GitHub-hosted runner (`KAPPA_SANDBOX_INTEGRATION=1`), after the
Step 7 free-execution preflight. Tests marked **Policy** need no Docker and run in every test job.

## The faulty fixture

`tests/fixtures/sandbox/invoice-service` is a small invoicing package with two real bugs: tax is truncated instead of
rounded half up, and net payment terms are a day early. Five of its eight tests fail; the three that pass guard
against fixing one function by breaking another. No fixed copy is stored.

The repair agent is scripted, so tests use no inference and no paid capacity, but it is evidence-driven: each change
is chosen only from the failing test names in the prompt the controller built from the real sandbox run. The base
run's evidence names the due-date failures, so the agent fixes `invoice/terms.py`; the rerun names only the tax
failures, so it then fixes `invoice/money.py`; the fresh final regression passes. Told nothing, the same fixture stays
failed. What is scripted is only the model's choice; Docker, the candidate, the tests, attempt records, persisted
checkpoints and every guard are the production code.

## Requirements

| Requirement | Test | Kind | What it proves |
| --- | --- | --- | --- |
| Candidate code executes before the first commit | `DevelopmentFlowAcceptance.test_candidate_code_executes_before_the_first_commit` | Docker | The real development pipeline (`produce_development_pr`) runs the candidate in a container before it writes any tree containing code; the only earlier commit is the plan commit with the unchanged base tree; the committed code is the code that passed. |
| | `test_candidate_code_executes_in_the_sandbox_before_any_publication` | Docker | Base run, two repair runs and a fresh final regression all ran; the persisted final validation is `passed` only after that. |
| Test failures can trigger targeted code changes | `test_test_failures_trigger_targeted_code_changes` | Docker | Each change touches only the module its failing tests name; attempt 1 (terms) still fails on tax, attempt 2 (money) passes. |
| All five repair attempts are separately recorded | `test_all_five_repair_attempts_are_separately_recorded` | Docker | Five distinct failing patches are attempts 1–5, each with its own diff, fingerprint, rationale, test results and diagnostics, also in the persisted journal; no sixth change is requested (`attempt_limit`). |
| Identical failed approaches are detected | `test_identical_failed_approaches_are_detected` | Docker | A reworded patch that fails identically stops as `identical_error`; returning to an already-tried patch stops as `repeated_patch` without counting a new attempt. |
| Unsupported commands are blocked | `PolicyAcceptance.test_unsupported_commands_are_blocked` | Policy | Network tools, shells, `sudo`, Docker, `git push`, publishing, package installs, deletion, chained commands and listeners are `rejected`, including when a model asks through the tool loop; no container starts. |
| Secrets are inaccessible to candidate execution | `test_secrets_are_inaccessible_to_candidate_execution` | Docker | With provider, router and Cloudflare secrets in the engine's environment (and the runner's real token in CI), a candidate test that dumps its environment, PID 1's environment, credential files and the Docker socket finds none of them; no value appears in command logs, model prompts, journal comments or the result. |
| Untrusted repositories cannot escalate permissions | `test_untrusted_repositories_cannot_escalate_permissions` | Docker | Candidate code runs with no capabilities, `NoNewPrivs`, UID 65534, and is denied `setuid`, `chown`, writes to `/etc` and `/usr`, `mount`, the Docker socket and the network. A generated candidate that changes the test definition is refused before running; a repair that edits it is still judged by the base command. |
| | `PolicyAcceptance.test_untrusted_task_content_cannot_widen_github_permissions` | Policy | The task scope refuses force pushes, pushes to `main`, other repositories, collaborators, secrets, webhooks, owner-guidance forgery and external hosts; jobs only dispatch reviewed workflows from `main`; a non-owner issue is never picked up. |
| Checkpoints survive interruption | `test_checkpoints_survive_interruption` | Docker | After the runner is lost following the first tested repair, a new session and controller restored only from the journal keep attempt 1 exactly and ask only for the remaining tax fix, then pass. |
| Failed work never reports successful validation | `test_failed_work_never_reports_successful_validation` | Docker | A model claiming done on failing code, and one giving up after a partial fix, both end `failed` with no `passed` final validation, and the task report says validation stopped. |
| | `PolicyAcceptance.test_a_failed_sandbox_run_is_never_published_or_reported_as_validated` | Policy | A failed run posts one issue comment listing every attempt, and nothing else. |
| No commit is created during ordinary candidate repair | `test_no_commit_is_created_during_ordinary_candidate_repair` | Docker | Every GitHub write during a full repair went through the real guard and was an issue comment (progress or checkpoint); no blob, tree, commit, ref, contents, pull request or merge write; repository files unchanged. |
| No automatic merge, deployment or release occurs | `PolicyAcceptance.test_no_automatic_merge_deployment_or_release` | Policy | The task scope refuses merging (REST, GraphQL, auto-merge, merges API), marking ready, releases, tags, deployments, deploy and iOS workflow dispatches and pushes to `main`; Step 7 admission refuses the deploy workflow; no engine module calls those APIs; deploy and release workflows start only from `main`. |
| Realistic faulty fixture repaired by an agent | `test_the_fixture_fails_initially_and_passes_only_after_an_agent_driven_repair` | Docker | The fixture fails five tests; claiming done leaves it failed; the evidence-driven repair passes all eight. |

## Scope notes

- Deploy and release workflows still run when the **owner** merges to `main`; that is the owner's action, not the
  agent's. The agent cannot merge, push to `main` or dispatch those workflows.
- Each test was also checked against a deliberately broken product in a scratch run: raising the attempt limit to six,
  disabling identical-failure detection, or running containers as root each makes its acceptance test fail.

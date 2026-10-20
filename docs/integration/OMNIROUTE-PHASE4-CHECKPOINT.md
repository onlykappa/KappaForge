# OmniRoute integration Phase 4 checkpoint

**Updated:** 2026-10-20  
**Status:** IN PROGRESS — fixture coverage is passing for the pinned Groq route and durable recovery changes. The authorized production-gateway Actions smoke, generated draft PR, and task-result observation remain pending.

## Baseline and prior evidence

- KappaForge `main` baseline: `6ee366ec098d99aae9020a66e5021201c5a28be0` (`Prevent empty Groq GPT-OSS smoke responses [router-free-live-smoke]`). The Phase 4 isolated branch is `codex/phase4-cloud-execution`, created from that commit.
- No root, `engine/`, `tests/`, or `chat-backend/` `AGENTS.md` instruction file exists in this baseline.
- Phase 3 deployment evidence is attached to successful Actions run [39516741522](https://github.com/onlykappa/KappaForge/actions/runs/39516741522), for deployed commit `6ee366ec098d99aae9020a66e5021201c5a28be0`. The run completed worker validation, deploy, health, URL-match, runner-auth, diagnostics, and one live smoke successfully. Sanitized output recorded Groq `openai/gpt-oss-120b`, 78 prompt tokens, 22 completion tokens, and 100 total tokens; its commit marker and workflow used `fallback=false`.
- Source confirms PR #147's allowlist fix: empty provider variables are absent from local Wrangler `vars`, while deployment retains dashboard bindings with `keep_vars = true`. PR #149's Groq completion-token and reasoning-effort change is present on `main`.
- The current checkpoint handoff PR [#146](https://github.com/onlykappa/KappaForge/pull/146) is open and draft at head `9572b8b95f287a0403b54baa020df890fe82695e`; it records the successful Phase 3 smoke but is not part of `main` yet. PR #144 is another open, older checkpoint draft; it is left untouched. Existing draft PR #133 is unrelated and untouched.
- User confirms the configured provider account tier is free. Groq model Free Plan eligibility was independently reviewed. Account-specific remaining quota and billing-console state remain unknown; live tests here are pinned to Groq's reviewed free model, without cross-provider fallback.

## Existing execution path inspected

`/jobs` creates the owner-authored `kappa-task` issue, binds task authorization, and dispatches the trusted workflow. `agent.yml` classifies the issue read-only before its write job receives scoped permissions. `engine.intent_guard.ExecutionScope` checks owner, open state, repository, mode, authorization expiry, and issue-body digest before every privileged write. `Mode: develop` uses the durable `recovery.Journal`, validated stage checkpoints, task-scoped draft PRs, and separate sandbox test dispatch. The app's existing task cards consume issue progress comments and the generated PR/test links. `KAPPA_ROUTER_REQUIRED=true` makes every coding model call use the authenticated `POST /router/infer` gateway; an unavailable gateway does not fall back to direct provider keys.

Long-running code execution remains on GitHub Actions. The Worker gateway and its Durable Object state are unchanged in this Phase 4 branch. No desktop, local process, localhost endpoint, or new native interface is required; no IPA update is needed for these backend/workflow changes.

## Phase 4 implementation in this branch

- Owner-authored `Mode: develop` tasks may optionally include one exact `Inference route: groq:openai/gpt-oss-120b` line. The accepted route is deliberately narrow and must still intersect the configured task code-provider allowlist and the server-side free-model policy.
- When that task pin is present, the coding runner sends only provider `groq`, requests the exact model, sets `reasoningEffort=low`, and sends `fallback=false`. It verifies the gateway returned that same route. Missing/unsupported/duplicate pins or a pin outside the current coding allowlist fail closed.
- The task-body digest binds the route choice to its authorization; continuations re-read the same open issue and therefore keep the same route restriction. Durable waiting/failure events now retain the pinned provider/model, so app progress can show which route was unavailable. Provider cooldown waits do not consume continuation attempts.
- No user-facing app source or existing dashboard configuration is changed.

## Validation so far

- Focused Python tests: `test_intent_guard.py` **12 passed**, `test_integrated_router.py` **6 passed**, and `test_recovery_journal.py` **31 passed**. These cover route-pin validation, allowlist intersection, exact model selection, fallback disabled, actual route verification, route persistence in failure events, waiting without continuation consumption, task cancellation/expiry, duplicate continuation dispatch, branch safety, and retained candidate checkpoints.
- Focused Worker routing fixtures: `tests/routing-policy.test.mjs` **12 passed**, including exact Groq GPT-OSS selection, `max_completion_tokens`, low reasoning effort, and no alternate route.
- `scripts/preflight.py agent` passed. `git diff --check` passed.
- Full local Node suite on Windows: **149 passed, 1 failed**. The same pre-existing `tests/intelligence.test.mjs` source-fixture assertion fails on baseline `main` (148 passed, 1 failed); no Phase 4 regression is indicated by the comparison.
- Full local Python suite on Windows: **334 tests, 1 failure, 2 errors**. Baseline `main` has the same parser-integrity failure (`acorn.mjs` hash) and the same two `PermissionError` errors writing temporary `GITHUB_OUTPUT` files (329 tests, 1 failure, 2 errors). New focused tests pass.
- `dependency-map.py --check` reports that the checked-in map is stale on both current and baseline branches; it was not regenerated because this phase changes no dependency graph. Windows default text encoding initially fails this script; rerunning with UTF-8 still reports the same stale-map state.
- Linux GitHub CI and a live test task have not run yet. The local Linux-independent condition is not claimed; live execution remains pending.

## Live acceptance plan and evidence log

Create one clearly labeled owner-authored test issue with `Repository: onlykappa/KappaForge`, `Mode: develop`, and the exact Groq route line. Request a single new, harmless test-only documentation file. Dispatch `agent.yml` from this implementation branch so the actual Actions job uses the new task-pinned runner while accessing the existing deployed production Worker. Do not alter any secret, Worker variable, Durable Object value, provider list, or billing setting. The issue body pin follows the task through recovery and prevents a different provider or model from receiving its prompt.

Record only task/run/PR links, deployed gateway commit, selected provider/model, sanitized usage, progress/final state, and validation results. Never copy secrets, prompts, or generated private data into logs or this checkpoint. The first live test was stopped after gateway capacity failure: issue #151 is closed, and it must not be resumed or rerun without a new owner request.

**Live record:** the owner-authored test issue [#151](https://github.com/onlykappa/KappaForge/issues/151) was dispatched from `codex/phase4-cloud-execution` in [Actions run 39518162904](https://github.com/onlykappa/KappaForge/actions/runs/39518162904). Classification and task execution reached the coding stage; progress showed the task reading the repository, planning, and writing. The runner selected `groq:openai/gpt-oss-120b`, with cross-provider fallback disabled. The production gateway returned HTTP 503 for the request and then reported approved provider capacity limited until 23:58 UTC. The recovery journal recorded four bounded model calls, all pinned to Groq; no other provider was used. Reported usage is unavailable because no inference completed. No file change, validation, or generated task PR resulted. The Actions workflow itself concluded successfully while the task entered its truthful `waiting` state. The test issue was closed immediately after the capacity failure, before a scheduled continuation, so this live test will not retry. This is a live failure observation, not a passing acceptance test.

## Limitations, rollback, and resume

- Phase 4 will remain partial if the branch workflow cannot use the existing GitHub Actions secrets/variables, if the Worker rejects the pinned Groq route, if code generation/validation fails, or if the app cannot observe the resulting issue progress. No Phase 4 code has been deployed.
- Remaining provider quota is unknown. Shared Worker request limits and Groq Free Plan limits remain authoritative; never raise them, purchase credits, or enable fallback to another model/provider for this test.
- There is no direct mobile-app `/jobs` session credential available to this executor. The authorized test used the owner-created GitHub task, which the existing task interface can adopt and follow. The app UI launch/adoption itself remains unverified because no authenticated mobile session was available.
- Rollback before merge is to close the draft implementation PR and leave the isolated branch unmerged; the production Worker, secrets, variables, and Durable Object are unchanged. If a test-only generated PR exists, leave it draft and close it after preserving its URL/evidence. Do not merge either PR.
- To resume, fetch `codex/phase4-cloud-execution`, read this file and the Phase 3 checkpoint, run the focused tests, then verify the one authorized test issue and Actions run before any new provider call. Keep Phase 4 PR in draft and do not begin Phase 5.

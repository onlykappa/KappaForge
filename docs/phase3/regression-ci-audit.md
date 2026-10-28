# Phase 3.1d — regression and CI evidence

Recorded 2026-10-28 UTC. This checkpoint advances independently of task #308's unresolved automated review. It does not close Phase 3.1 or start Phase 3.2.

## Revisions and provenance

| Role | Exact revision |
| --- | --- |
| Audited PR #279 head | `f5501afe417a63c4ebc089954d99968ef4e55bb0` |
| Observed main and PR base | `c6258f2406e84cd872334a8bc4545a613f1e4365` |
| Separate engine repair PR #309 | `b3a9ba087be3c07382f76afae685e90fdd3b517b` |
| Separate task correction PR #310 | `75811f8510b4d02a8cd165c4ec081e3c032d998f` |

GitHub merge metadata identifies Phase 1 PR #263 at `437d74d1826b022b7f6aef05e1cb8e71f5d54ded` and Phase 2 PR #264 at `b3f8d2f32262a2ae45f23f027712e40cfc70faac`. Local `git merge-base --is-ancestor` checks passed for both merges against observed main, and for observed main against the audited head. PR #279's branch was not changed.

The eight core modules `sandbox`, `execution`, `intent_guard`, `exploration`, `task_plan`, `requirements`, `research` and `clarification` have no diff between this main and the audited head. This comparison does not cover every backend, workflow or publication path.

## Acceptance mapping

The [machine-readable record](regression-ci-evidence.json) resolves 15 named test references in [Phase 1 acceptance](../phase1/acceptance.md) and 25 in [Phase 2 acceptance](../phase2/acceptance.md) to actual AST definitions at the audited revision. Module-only coverage notes are not counted as individual tests. Definition existence is a static cross-reference check; the execution evidence below is separate.

| Acceptance area | Tests and execution route |
| --- | --- |
| Phase 1 pre-publication execution, targeted repair, five attempts, repeated approaches and interruption | `test_phase1_acceptance` Docker classes; `sandbox-selftest.yml` enables `KAPPA_SANDBOX_INTEGRATION=1` and runs that module. |
| Phase 1 command restrictions, scoped GitHub authority, no automatic lifecycle actions and honest failed-run reporting | Four `PolicyAcceptance` methods ran locally; Docker acceptance separately exercises isolation, secrets and privilege boundaries. |
| Phase 2 dependency discovery, more than eight reads, bounded exploration and investigation of each new error | `test_exploration`, `test_phase2_exploration_repair.ExplorationRepairTests` ran locally; the real shop fixture also ran through the existing Docker workflow. |
| Phase 2 requirement phrasing, authorization separation and behavioral test evidence | `test_requirements` ran locally; its skipped JSON Schema assertion was then executed successfully after installing the test dependency. |
| Phase 2 documentation provenance, unsupported API claims and private-data boundaries | `test_research` and `test_phase2_audit_repairs` ran locally with scripted transport; `research-live.yml` separately ran the live allowlisted documentation checks. |
| Phase 2 clarification, owner answers, retained state and no duplicate PR | `test_clarification` ran locally through its stateful test API boundary. Web CI is inspected evidence for the separate clarification UI tests. |
| Plan identity and publication recovery | `test_task_plan`, `test_execution_recovery`, `test_operational_review`, `test_commit_provenance` and `test_runtime_engine` ran locally. The later task #308 correction remains on its separate draft. |

The Docker fixtures use scripted agents with production sessions/controllers and real containers. They prove execution, evidence and guard behavior; they do not establish a live coding model's reliability.

## Checks actually run locally

Working directory was a detached checkout of the audited PR #279 head. No candidate or tracked source file was edited.

```sh
python -m unittest tests.test_phase1_acceptance.PolicyAcceptance tests.test_exploration tests.test_task_plan tests.test_requirements tests.test_research tests.test_clarification tests.test_phase2_exploration_repair.ExplorationRepairTests tests.test_phase2_audit_repairs tests.test_execution_recovery tests.test_operational_review tests.test_commit_provenance tests.test_runtime_engine -v
```

Result: 163 discovered, 162 passed, one skipped, zero failures/errors, 13.173 seconds. The skip was `MatrixTests.test_the_published_schema_matches_the_code` because `jsonschema` was unavailable. After installing local test dependency `jsonschema==4.25.1`, this exact test was run separately: one passed, zero skips. These are 163 distinct executed passing tests, not 164 distinct tests.

Additional checks: dependency-map and execution-policy checks passed; ten structural-rule tests passed; the shipped-source structural scan exited zero with 15 warnings and no errors. Those warnings are recorded findings for further source review, not a blanket security clearance. No local Docker, native-device or live-model execution is claimed.

## CI inspected at the audited head

| Run | Observed evidence |
| --- | --- |
| [40564938058](https://github.com/onlykappa/KappaForge/actions/runs/40564938058) | Unit, web, Worker and structure jobs succeeded on `f5501afe`. |
| [40623228909](https://github.com/onlykappa/KappaForge/actions/runs/40623228909) | Fresh owner-dispatched Sandbox self-test succeeded on `f5501afe`. Inspected successful steps include real-Docker isolation tests, faulty-project repair, Phase 1 invoice acceptance, Phase 2 shop exploration, KappaForge's own sandboxed suites and cleanup. |
| [40623231877](https://github.com/onlykappa/KappaForge/actions/runs/40623231877) | Fresh owner-dispatched Research live check succeeded on `f5501afe`; the live allowlisted-host test step ran with `KAPPA_RESEARCH_LIVE=1`. This is documentation/network validation, not live coding-model acceptance. |
| [40564938210](https://github.com/onlykappa/KappaForge/actions/runs/40564938210) | Native job succeeded on `f5501afe`. Step metadata records simulator build/launch, keyboard screenshot export, unsigned iPhone build and IPA verification. Release was skipped. |

Numerical remote test-runner counts were not read from logs and are not inferred from the number of methods in source. CI logs redirect to hosts blocked by this managed environment. Native artifact metadata was inspected for launch/keyboard screenshots, UI test results and unsigned IPA; the binary/image contents were not downloaded or visually reviewed. The two fresh audit workflows expose no uploaded artifacts. Detailed step conclusions and artifact metadata are retained in the JSON record.

Earlier real-Docker run `40560287188` succeeded on `58e735ae`; it is historical evidence. The fresh run above closes the missing exact-head Docker evidence gap without attributing that earlier run to `f5501afe`.

## Remaining work

- Finish 3.1c across backend HTTP clients, workflow/task-intake entry points and lifecycle authorization. Its earlier request-helper and publication reviews are partial.
- Review the structural warnings and reconcile historical issue-ledger dispositions during 3.1f closeout.
- Keep task #308's unaccepted source citations explicit. Run `40621255382` reached all 24 original decisions, but copied owner instructions as source evidence; strict validation rejected those claims. Its green workflow status is not task completion.
- Validate the combined delivery revision after the independently reviewed task and engine repairs are incorporated. That integration has not occurred in #279.
- Complete the cross-phase closeout before claiming Phase 3.1 finished. No merge, deployment, release, readiness change or Phase 3.2 feature implementation occurred in this checkpoint.

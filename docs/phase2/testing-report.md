# Phase 2 testing report

Recorded 2026-10-25 for draft PR #264, branch `claude/phase2-exploration`. The acceptance matrix is in
[acceptance.md](acceptance.md). Section 8 adds one regression test method (two cases) for the no-change
`fix_pull_request` path; the Phase 2 implementation is unchanged from `0d2fa80`.

## Checks actually run for section 8

Local environment: Windows, Python 3.12.10, Node 24.20.0. Counts below are test-runner counts, not estimates or
counts inferred from source. A discovered but skipped test is not a passing executed test.

| Check | Result |
| --- | --- |
| `python -m unittest discover -s tests -v` | 969 discovered: 937 passed, 32 skipped, zero failures/errors |
| Same full suite with `HTTPS_PROXY`, `HTTP_PROXY`, `https_proxy`, `http_proxy` all set to `http://127.0.0.1:9` | 969 discovered: 937 passed, 32 skipped, zero failures/errors |
| `npm test` | 857 passed, zero failures/skips |
| `python -m unittest tests.test_repair_root_causes -v` | 12 passed, including both clean and still-incomplete PR re-check cases |
| `python -m unittest tests.test_structural_scan tests.test_requirements -v` | 25 passed, including real ast-grep and JSON Schema validation |
| `python scripts/dependency-map.py`, then `--check` | Generated map matches source |
| `python scripts/execution-policy.py --check` | Reviewed manifest matches; standard free runners and unique workflow keys |
| `git diff --check` | Passed |

`py` invokes Python on this Windows host. Local Python skips comprise 22 Docker-gated tests and 10 live research
tests. No Docker daemon is available here; real Docker is verified by the separate GitHub job below. ast-grep
0.51.0, PyYAML and jsonschema were installed locally for verification; no project dependencies were changed.

Initial local runs failed because Git's Windows `core.autocrlf` setting changed repository bytes: the pinned parser
hash, JavaScript source-slicing tests and shop fixture exact edits failed. The checkout was restored from Git blobs
with LF bytes and local automatic newline conversion disabled. Full Python and JavaScript reruns then passed.
No test, expected hash or fixture was weakened. The dependency generator's Windows CRLF output was normalized to
the repository's LF format; its content matches the checked-in map.

## CI execution evidence inspected

These jobs actually ran on GitHub at implementation commit `0d2fa80e890fee63eb724ebd6f8aa00c7823deb7`.
Their results/logs were inspected during section 8; they were not rerun locally or represented as local runs.
The section 8 commit receives its own PR checks after push; results for it must be checked separately.

| Workflow / job | Executed result and evidence |
| --- | --- |
| KappaForge tests / unit | [Run 40203863188](https://github.com/onlykappa/KappaForge/actions/runs/40203863188): 968 discovered, 937 passed, 31 skipped; zero failures |
| KappaForge tests / web, worker, structure | Same run: all green; `npm test`, browser regression, isolated Worker build/recovery checks, structural scan and rule tests completed |
| Research live check / research | [Run 40203863168](https://github.com/onlykappa/KappaForge/actions/runs/40203863168): 10 passed, covering every allowlisted host. This is the successful rerun after fixing repeated page downloads |
| Sandbox self-test / sandbox | [Run 40203863135](https://github.com/onlykappa/KappaForge/actions/runs/40203863135): real Docker available; sandbox module 25 tests, faulty-project repair 2, Phase 1 acceptance 15, Phase 2 exploration repair 8, all successful. These groups overlap the ordinary suite and are not additional unique test counts |
| Suites inside the real sandbox | Same sandbox run: Python 968 discovered, 932 passed, 36 skipped; JavaScript 857 passed, zero failures. Integration tests remain separately exercised by the preceding Docker steps |
| iOS build and release / native | [Run 40203863177](https://github.com/onlykappa/KappaForge/actions/runs/40203863177): simulator build, bundled launch/UI checks, screenshots, unsigned iPhone build and IPA verification passed. Release job skipped. Section 8 began only after this workflow succeeded |
| Review graph | [Run 40203863130](https://github.com/onlykappa/KappaForge/actions/runs/40203863130): succeeded; static analysis, not runtime test evidence |

The previous CI unit suite skipped optional jsonschema validation because jsonschema was absent; section 8 ran that
test locally with jsonschema installed. Local and CI skip totals differ with installed tools and gated integration
environments. Neither total means all integration tests ran in ordinary unittest discovery.

## Inspected only, not demonstrated in this session

- Source, schemas, workflow routing and the section 1–7 architecture/policy documents were inspected. Source review
  does not establish runtime success; the acceptance matrix points to the tests that do.
- No production development task, live-model quality benchmark, owner phone reconnect, or production clarification
  exchange was performed. Clarification uses a stateful GitHub test boundary; the Docker repair agent is scripted.
- No local iOS build or browser screenshot inspection was performed. The GitHub iOS/web job results above are CI
  evidence, not a claim that the phone experience was manually checked.

## Unresolved issues and limits

- No failing Phase 2 acceptance test remains in the completed runs above. Section 8's post-push CI is not covered by
  the earlier commit's success and must be confirmed on its own head.
- The section 1 verification's production gap remains: free admission was proven in automated sandbox tests, but
  this session did not run a real owner development task through the agent code job's preflight.
- Optional schema validation is not installed by the current CI unit workflow. It passed locally; do not count the
  CI skip as a schema-validation pass.
- Live host availability and page formats may change. The dedicated live check remains the ongoing proof; offline
  tests prove refusal and unavailable behavior rather than current external availability.
- Deterministic fixture success does not establish arbitrary live-model task success, complete semantic search, or
  support for every language. Exploration has intentional budgets and bounded, one-level import investigation.

## Phase 3 prerequisites

1. Obtain a separate owner-approved Phase 3 scope; preserve the free-first policy and owner-only lifecycle actions.
2. Use this acceptance matrix and the successful section 8 head as the regression baseline, retaining the real
   Docker and live-host jobs. Keep schema validation available when changing the classification schema.
3. Before claiming production readiness for broader autonomous work, exercise an owner-authorized development task
   through free admission and checkpoint resume, and a material clarification through the iPhone guidance path.
   Record actual task/run evidence, failures and costs rather than extrapolating from the scripted fixtures.
4. Keep the journal/task identity, authorization guard, bounded exploration and literal research provenance intact
   when extending behavior. Nothing in this report authorizes Phase 3 implementation, merge, deployment or release.

## Post-acceptance audit repairs

After section 8, a code/behavior audit identified four publication, privacy and clarification gaps that the earlier
acceptance tests did not cover. The owner requested these fixes in #264. [Audit repairs](audit-hardening.md) records
the root causes, implementation boundaries, regression mapping and remaining audit follow-ups.

Local checks actually run during hardening:

| Check | Result |
| --- | --- |
| Full Python suite | 982 discovered: 949 passed, 33 skipped; zero failures/errors |
| Full Python suite with all four HTTP(S) proxy variables set to `http://127.0.0.1:9` | 982 discovered: 949 passed, 33 skipped; zero failures/errors |
| `npm test` | 857 passed; zero failures/skips |
| New `test_phase2_audit_repairs` module | 12 tests; included in full discovery, including the production repair-controller/journal question round trip |
| Dependency map generation and check; execution policy; whitespace | Passed |

The additional local skip is the new real-Docker npm script-substitution regression. It is in the existing Phase 1
acceptance module exercised by `Sandbox self-test`, not counted as locally executed. Docker and iOS were unavailable
locally. The hardening commit's `sandbox`, `research`, ordinary test and native jobs require fresh post-push results;
earlier CI run links above prove the earlier implementation, not these repairs. Final post-push evidence is recorded
in PR #264's description. No tests were removed, disabled or relaxed; the resume fixture now includes the review's
candidate digest and still requires completed unchanged work not to repeat.

The other audit observations remain open and are listed in `audit-hardening.md`. These repairs establish regression
coverage for the four requested issues; they are not a claim that unattended production task quality, all toolchain
configurations, or every exploration edge case has been demonstrated.

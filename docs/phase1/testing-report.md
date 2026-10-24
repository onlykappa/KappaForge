# Phase 1 testing report

Updated per step. **Ran** means executed, with the measured result. **Inspected** means reviewed but not executed.

## Steps 1 and 2

### Ran (local, Linux container with Docker 29.9.2, cgroup v1)

| Check | Result |
| --- | --- |
| `python -m unittest tests.test_sandbox` (unit tests, recording fake Docker) | 19 passed, 6 real-Docker tests skipped |
| `KAPPA_SANDBOX_INTEGRATION=1 python -m unittest tests.test_sandbox` (real containers) | 23 of 25 passed, 2 skipped (registry installs; see below) |
| Faulty fixture in real containers | Python fails with `AssertionError: 1999 != 1699`, Node fails on the strict-equality assertion; both pass after the uncommitted fix |
| Isolation probe in a real container | No runner secrets in the environment or `/proc/1/environ`; network unreachable; uid 65534; `/etc` and `/usr` read-only; no `.git`, no Docker socket |
| Limits in real containers | 3 s timeout stops a 60 s sleep and removes the container; a 512 MB allocation under 128 MB is killed; 20 MB of output kept to 4 KB; a 32 MB workspace returns `No space left on device` |
| Cleanup | No containers or volumes labelled with the session remain |
| `python -m tools.sandbox_selftest` (KappaForge in the sandbox) | 617 Python tests ran in the sandbox: 615 passed, 2 errors because this environment could not install `git` (no route to Debian mirrors); Node suite failed because `npm ci` could not reach the registry from containers here |
| `python -m unittest discover -s tests` (whole repo) | 641 tests passed (8 skipped) |
| `npm test` | 822 passed |
| `python3 scripts/dependency-map.py --check` | Current after regeneration |

This environment's internet goes through a loopback proxy that Docker containers cannot use. So registry installs
(`npm ci`, `pip`) and the `git` image layer could not be exercised here.

### Ran in CI (`.github/workflows/sandbox-selftest.yml`, GitHub-hosted ubuntu-latest)

First run, on `70e62f4`:

| Check | Result |
| --- | --- |
| `KAPPA_SANDBOX_INTEGRATION=1 KAPPA_SANDBOX_NETWORK=1 python -m unittest tests.test_sandbox` | 25 of 25 passed, including the locked `npm ci` and `pip` wheel installs feeding networkless test runs |
| Sandbox image | `kappaforge-sandbox:py3.12-node22`, built with `git` (`missingTools: []`) |
| KappaForge's own suites inside the sandbox | `npm ci` passed in 1.7 s; Node: 822 passed; Python: 641 of 642, with 1 error in a test that ran `git ls-files` on a tree that has no `.git` by design |
| No sandbox containers or volumes left on the runner | Passed |

That one error was fixed: `tests/test_verify.py` now lists files from the folder when there is no Git metadata, and it
was run both in the checkout and in a Git-less export. The next CI run re-checks the whole self-test.

### Inspected, not executed

- Behavior on cgroup v2 runners (GitHub's current Ubuntu images) for memory and pids limits: same Docker flags, not run here.
- Docker Hub rate limits on shared runner IPs: handled as `SandboxUnavailable`; not reproducible on demand.

## Step 3: development tool loop

Step 3A is merged in #228. Step 3B is reviewed in #231; merging it requires owner approval.
The source candidate tested for 3B is `25df5b63a76d225cb85e77c08d5edd4e521c781f`.

`SandboxTools` exposes the seven structured development methods over a real `sandbox.Session`. The loop accepts
either that tools instance or a mapping of those method names to bound methods, invokes them with keyword arguments,
and uses the engine's `run_model(api_key, prompt, ..., allowed=..., json_mode=True)` protocol. `allowed` selects model
providers. Returned `models` records the provider routes, and `steps` records calls and bounded results. Prompts include
the task, signatures, JSON reply instructions and action/result history. Serialized results are at most 3000 characters,
and prompt history is at most 30000. Invalid replies, unavailable execution, repeated calls and the step limit stop the
loop as specified; tool exceptions become error results.

### Ran

| Check | Measured result |
| --- | --- |
| Original `RealSessionReviewTests` against initial 3A code | 7 tests failed: 5 failures and 7 errors, including subtests |
| Additional real-Session 3A regressions before repair | 7 tests failed: 6 failures and 11 errors, including subtests |
| Nine initial 3B reviewer tests against KappaForge's candidate | All 9 failed on the incompatible model-call protocol |
| Focused tests after repairs, local Windows | 25 SandboxTools and 19 tool-loop tests passed (44 total); real Session/SandboxTools with fake Docker, no model/network calls |
| `npm test`, local Windows | 822 passed; checkout line endings normalized to the repository's LF content |
| [3A Ubuntu CI](https://github.com/onlykappa/KappaForge/actions/runs/40107693526) | 674 Python tests ran, OK with 6 Docker tests skipped; npm, dependency map, browser, Worker and structural checks passed |
| [3B Ubuntu CI](https://github.com/onlykappa/KappaForge/actions/runs/40109578717) | 693 Python tests ran, OK with 6 Docker tests skipped; `npm test` passed; dependency map matched; Worker and structural checks passed |
| [3B exact-candidate branch validation](https://github.com/onlykappa/KappaForge/actions/runs/40109600258) | Passed Python, Node, compilation and web configuration checks on the source candidate; this workflow runs without API secrets and does not start Docker |
| `python3 scripts/dependency-map.py --check` | Passed in Ubuntu CI; also passed locally using the bundled Python executable |
| Original 3A owner-test preservation | Parsed AST compared with `78d5ef1`; assertions unchanged |

The full local Windows Python run during 3A encountered existing runner/path issues. Ubuntu CI supplies the full-suite
acceptance evidence. The report does not count the local failed run as a pass.

KappaForge wrote both initial implementations. Three 3A repair runs stopped before source edits at finding verification;
3B's automatic fix and explicit restart stopped on recovery state transitions after a provider outage. Reviewer bug
fixes used the owner's authorized fallback after these blocked rounds. No pipeline changes were made for those failures.

### Inspected, not executed for step 3

- Real Docker isolation and execution: source and prior step-2 evidence inspected; the six integration tests stayed skipped.
- Live model selection and network/provider responses through the new loop: scripted model callbacks exercised the real
  calling convention; no live model inference ran through the new loop.
- Pre-commit autonomous repair and the faulty-project acceptance flow belong to step 4 and are not claimed complete.

## Step 4: test-driven autonomous repair

The development path keeps the candidate uncommitted while the controller runs the base-selected test commands in a
real `sandbox.Session`. It lets the model diagnose and correct failures through the seven sandbox tools, records up to
five distinct candidate states with their diffs, rationale and test evidence, stops on repeated patches or identical
errors, and reruns the final regression suite before committing or opening a draft PR. If validation stops, the task
report retains the candidate diff, bounded logs and repair history without publishing the candidate.

### Ran locally (Windows, Python 3.12)

| Check | Measured result |
| --- | --- |
| `py -3.12 -m unittest discover -s tests -q` | 782 tests ran, OK with 12 skipped |
| `npm test` | 835 passed |
| `py -3.12 scripts/dependency-map.py --check` | Passed |
| `git diff --check` | Passed |

The local unit tests use a recording Docker fake for controller behavior. The real faulty-project acceptance test is
gated on `KAPPA_SANDBOX_INTEGRATION=1` and skipped locally.

### Ran in CI

| Check | Measured result |
| --- | --- |
| [Step 4 sandbox self-test on PR #260](https://github.com/onlykappa/KappaForge/actions/runs/40141771899) | 25 sandbox tests passed; real-Docker faulty-project repair passed (1 test); KappaForge sandbox self-test passed with Python 782 tests (12 skipped) and Node 835 passed; no sandbox containers or volumes remained |
| [Required CI checks on candidate `fe365d8`](https://github.com/onlykappa/KappaForge/actions/runs/40141771903) | Unit, worker, structure, fetch, analyze, publish and web all passed |

The first real-Docker acceptance attempt caught an incomplete scripted repair: it removed integer division but did not
round the discount to cents. The fixture model patch was corrected to match the fixture's expected behavior, and the
rerun passed both suites.

### Inspected, not executed locally

- Real Docker execution of the agent-driven repair on `tests/fixtures/sandbox/faulty-project`; the dedicated CI job
  executes it and confirms both Python and Node suites pass after the scripted repair.
- Networkless container execution and secret isolation for the Step 4 controller; these rely on the real-container
  Step 2 checks above plus the Step 4 CI acceptance run.

## Steps 5 and 6: durable recovery and execution diagnostics

The recovery journal now references exact uncommitted patches and generation-stage checkpoints. Resuming checks the
authorized task, original base/tree, workspace fingerprint and execution contract, then reuses completed stage and
command receipts. Separate final-regression results remain required. Existing task cards render the backend's real
command timestamps, outcomes, repair evidence and sanitized bounded history. See
[checkpoint and diagnostic behavior](checkpoints-and-diagnostics.md) for storage limits and recovery boundaries.

### Ran locally (Windows, Python 3.12 with UTF-8 mode)

| Check | Measured result |
| --- | --- |
| `py -3.12 -m unittest discover -s tests -q` | 808 tests ran, OK with 13 skipped |
| `npm test` | 840 passed |
| `py -3.12 scripts/dependency-map.py --check` and `git diff --check` | Passed |
| New failure-injection tests | Real Journal and Session with recording Docker: provider outage, partial suites, completed-validation reuse, changed base/task/tree, corrupt/untrusted fragments, secret redaction/rejection, private storage guard, usage counters, publication receipt/head checks and saved generation plan |
| Generation-stage recovery tests | Completed stages and no-edit stages resume without another model call; changed plans and generated secrets are rejected |
| Backend-to-UI contract | Python emits real Progress/controller snapshots; Node normalizes and renders command timing, measured counts, attempt status and final validation |
| Workflow interruption finalizer | Node executes the actual finalizer script; interrupted command timers freeze and final validation becomes blocked |

The first local full Python invocation used Windows' legacy default text encoding and failed while reading existing
UTF-8 sources. UTF-8 mode corrected the environment. Intermediate test failures from simplified GitHub fixtures were
fixed by recording branch movement and PR heads in those fixtures; publication guards were retained.

### Ran in CI

| Check | Measured result |
| --- | --- |
| [Real-Docker sandbox self-test on candidate `e56c81d`](https://github.com/onlykappa/KappaForge/actions/runs/40144566928) | 25 sandbox tests passed; both faulty-project tests passed, including persisted recovery after a provider outage with no replay of completed failing suites |
| KappaForge's own suites in that container | Python: 808 tests ran, OK with 13 skipped; Node: 840 passed |
| Sandbox cleanup | No labeled containers or volumes remained |
| [Ubuntu CI on the same code candidate](https://github.com/onlykappa/KappaForge/actions/runs/40144566877) | Unit, worker and structure checks passed; web/native completion remains visible on PR #261 |

### Inspected or failure-injected only

- Live provider quota exhaustion, real runner termination and GitHub mutation outages are failure-injected locally;
  no live inference or production task dispatch was used to implement these steps.
- The browser/iOS shared JavaScript renderer and escaping are automated; native iOS simulator screenshots were not run locally.

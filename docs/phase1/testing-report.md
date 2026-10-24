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

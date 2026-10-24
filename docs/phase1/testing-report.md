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

### Runs only in CI (`.github/workflows/sandbox-selftest.yml`, GitHub-hosted ubuntu-latest)

| Check | Result |
| --- | --- |
| Real-Docker tests with `KAPPA_SANDBOX_NETWORK=1`: locked `npm ci` and `pip` wheel installs feeding networkless test runs | Pending first CI run |
| KappaForge's own Python and Node suites inside the sandbox, with `git` in the image | Pending first CI run |
| No sandbox containers or volumes left on the runner | Pending first CI run |

### Inspected, not executed

- Behavior on cgroup v2 runners (GitHub's current Ubuntu images) for memory and pids limits: same Docker flags, not run here.
- Docker Hub rate limits on shared runner IPs: handled as `SandboxUnavailable`; not reproducible on demand.

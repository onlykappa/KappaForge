# Automation hardening

Audits and diagnostics use read-only repository-content tokens. Posting findings still needs `issues: write`. Task classification runs without AI secrets or repository write permission. Separate coding/repair jobs retain the content, PR and workflow-dispatch permissions their existing features require. Runtime scope checks revalidate task mode, so editing an issue after classification cannot turn an audit job into a coding job. Continuous audit/watch and continuous coding/repair scans run in separate jobs.

Every workflow defaults to content read access. Pages/OIDC permissions exist only on the Pages deployment job; repository release writes exist only on the native release job. Native builds remain manual/reusable and are not triggered by web deployments. All checkouts disable persisted credentials.

Cleanup discovers active superseded `ios-build.yml` runs on `main`, checks repository/workflow/branch/SHA/status and rechecks before cancellation. It preserves current-commit builds, sandbox branches, completed runs and web deployments. A simulator's UUID is parsed and validated before passing it as a quoted command argument. The earlier quoted usage did not evaluate the ID as shell code; validation catches malformed system output.

Wrangler is exact-version pinned in `chat-backend/package.json` and its dependency tree is committed in `chat-backend/package-lock.json`. Both validation and production install with `npm ci --ignore-scripts` and execute the installed binary through npm scripts. Playwright also uses its lockfile-installed executable. Version updates should regenerate the relevant lockfile, pass tests and a Worker dry build, then go through the deployment workflow.

## Shared build settings

Edit public release metadata, app identity, shared-interface locations and tool versions in `config/app.json`. Run `python scripts/configure.py`, then `python scripts/check-web.py`. Generated metadata feeds the web interface, native project, package versions and standard `.nvmrc`/`.python-version` files. `configure.py --check` fails CI if generated settings drift. Package manifests and lockfiles remain the authoritative format for dependency pins; `config/repositories.json` remains the security allowlist. No secret, encryption key, authentication credential or user preference is moved into public configuration. App ID is unchanged.

## Preflight and errors

`python scripts/preflight.py web|worker|agent|native` checks only tools needed for that job and verifies generated settings before expensive work. Web tests never require Xcode or a simulator. Native preflight checks Xcode tools and an available valid iPhone UUID without booting/building an app. Deployment still checks required Cloudflare credentials immediately before use without printing their values.

Entry points emit `Error: [component] Reason` and GitHub error annotations. Workflow shell traps report failing line/exit status without echoing command arguments. Known secret environment values and key/token URL parameters are redacted. Local tracebacks are opt-in with `KAPPA_DEBUG=1`; normal CI retains a concise error and task/workflow links.

Tests exercise permission-scope boundaries, issue mode changes, read-only queue isolation, preservation of authorized repair scans, selective cancellation, UUID rejection, version propagation, web-only preflight and error redaction. No paid agent tasks or native builds are needed for validation.

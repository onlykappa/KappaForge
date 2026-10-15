# KappaForge

A $0-first GitHub Actions AI development assistant controlled from iPad/GitHub.

## Current capability (v0.1)
- Manual and six-hour scheduled task checks.
- Only processes explicitly submitted issues in **this** repository bearing the `kappa-task` label.
- Read-only code inspection for allowlisted public GitHub repositories.
- Gemini model fallback, without paid API fallback.
- Posts findings, suggested code changes, and test suggestions as comments on the task issue.
- **Never pushes to OmniPC, APK Revival, or any target repository. Never auto-merges code.**

## Setup

1. In this repository, open **Settings > Secrets and variables > Actions** and create a secret called `GEMINI_API_KEY` for a free-tier eligible key from [Google AI Studio](https://aistudio.google.com/apikey). Verify your account's applicable free tier before enabling.
2. Open **Issues > New issue** in KappaForge. Describe the task and include an exact `Repository: onlykappa/OmniPC`, `Repository: onlykappa/Apk-revival` or `Repository: onlykappa/KappaForge` line.
3. Add the `kappa-task` label to authorize the task. If that label doesn't exist, create it under **Issues > Labels**.
4. Open **Actions > KappaForge agent > Run workflow**, optionally enter the issue number. It also checks labeled issues automatically every six hours.
5. Read its response on the KappaForge issue. Remove the label to stop further runs.

## Safety and cost

This initial release **does not autonomously commit generated code**, does not create target-repository PRs, and does not have a live web dashboard. Its output is a code-analysis and patch proposal inside KappaForge Issues. The next milestone can add isolated worktree coding and PRs with explicit opt-in. Public Actions runners are normally free under GitHub's published terms; model API free quotas and availability can change. The workflow does not configure a paid fallback.

Tasks are limited to repositories in `config/repositories.json`; retrieved source files and issue text are untrusted and may not override access rules. GitHub token permissions are scoped to reading contents and writing issue comments in KappaForge. For security, do not put secrets into task issues.

## Coding sandbox (v0.2 preview)

KappaForge can generate **actual code** in **KappaForge only**, within `projects/`, `tests/projects/`, or `docs/generated/`. Code generation requires a manually dispatched workflow and an issue created by `onlykappa` with the `kappa-task` label and exactly:

```text
Repository: onlykappa/KappaForge
Mode: code

Build a small Python CLI to organize local notes, including tests.
```

Open **Actions > KappaForge agent > Run workflow**, enter the issue number, and run on `main`. A fresh `kappa/issue-N` branch is created with generated files and a **draft PR**; no automatic merge. If the branch already exists, the runner will refuse to overwrite it.

**GitHub setting required:** In **Settings > Actions > General > Workflow permissions**, select **Allow GitHub Actions to create and approve pull requests** if available. Otherwise GitHub will reject automatic draft PR creation, while the generated branch remains as a checkpoint.

For validation open **Actions > Sandbox branch tests > Run workflow** and enter the exact `kappa/issue-N` branch. This separate workflow runs without `GEMINI_API_KEY` and with read-only repository permissions. PRs created by GitHub Actions' built-in token don't normally trigger push/PR workflows, so validation is intentionally dispatched separately.

Limitations: This is the *first* real coding milestone. It accepts bounded code generation, not multi-session autonomous repair loops; model output may fail JSON validation, and generated code has not been proven correct until separately tested and reviewed. Other repositories remain read-only. Jules is not integrated into this runner yet.

## Owner-approved Self-Repair (experimental)

KappaForge can propose repairs to **its own** limited source files, even when the chat assistant is unavailable. Open KappaForge Chat, enter a task, select **Make a Task**, repository **KappaForge**, and mode **repair**. The request must contain an exact `Repair files:` line with one or two paths chosen from:

- `chat-backend/src/index.js`
- `engine/runner.py`
- `engine/coder.py`
- `engine/full_reader.py`
- `engine/handoff.py`

Example:

```text
Investigate and propose a minimal fix for the GitHub job launcher error.
Repair files: chat-backend/src/index.js
Do not weaken authentication, authorization, or production safeguards.
```

The owner explicitly approves the task. The agent reads the named source, asks Gemini for a bounded replacement, validates allowed paths, creates a **new repair branch and draft pull request**, and posts its link to the issue. It never auto-merges, approves itself, or deploys the repair. Review the diff and run independent tests before merging. The self-repair agent has no permission to change CI workflows, secrets, deployment configurations, or other repositories. It may fail on oversized files, model-output limits, or cases where the necessary repair spans unauthorized files. Repairs are not guaranteed correct.

**Recovery if Chat is down:** Create a GitHub issue in KappaForge manually with `Repository: onlykappa/KappaForge`, `Mode: repair`, and `Repair files: <allowed path>`, label it `kappa-task`, then manually dispatch **Actions → KappaForge agent → Run workflow** with that issue number. The scheduled six-hour run does not apply repairs; explicit launch is required.

## Continuous agent and failure watch (experimental)

KappaForge Chat now accepts **continuous** and **watch** task modes, each requiring an explicit **Approve & Launch** by the owner. Both operate on KappaForge's existing owner-authored `kappa-task` issues. Neither may auto-merge, change production, or access secrets through the model.

- **Mode: continuous**: Resume a read-only repository audit with up to three bounded file batches per GitHub Actions run, storing each checkpoint and findings in issue comments. A completion marker prevents repeat processing. This is a resumable audit workflow, **not yet an unattended code-edit-and-test loop**.
- **Mode: watch**: Inspect the latest 12 GitHub Actions runs for failed, allowlisted workflows on `main`, deduplicate reports by run ID, and post preliminary diagnostic advice on the approved issue. Failure reports **do not** establish a root cause, and repair branches are not created without a separate approved `repair` task.
- **Schedule**: `.github/workflows/continuous.yml` runs every six hours and finds one approved watch issue and one incomplete continuous issue per pass. GitHub schedule timing can be delayed. Manual dispatch can target a particular issue at any time.

Example continuous task:
```text
Repository: onlykappa/KappaForge
Mode: continuous

Inspect the repository in checkpoints, identify verifiable bugs,
and continue the read-only audit across scheduled runs.
```

Example failure-watch task:
```text
Repository: onlykappa/KappaForge
Mode: watch

Track GitHub Actions workflow failures on main, report new failures
to this issue, and suggest targeted investigations. Do not edit code.
```

For live results, open the authorized issue's comments or Dashboard's workflow feed. Stop continuous work by closing the issue or removing the `kappa-task` label. To change code, submit a separate explicit owner-approved `repair` or sandbox `code` task and review its draft PR. GitHub token renewal is not yet automatic.

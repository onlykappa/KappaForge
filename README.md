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

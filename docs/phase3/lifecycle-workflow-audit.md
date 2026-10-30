# Phase 3.7 lifecycle workflow audit (2026-10-30)

Scope: which workflows and engine paths can merge, release, deploy or change access, and what authorizes them. Inspected by reading the workflow files and `engine/authorized_completion.py` at the head of PR #312 plus the existing guard tests. **Not inspected** (not visible through the available tools): GitHub environment protection rules for `cloudflare-production`, branch protection on `main`, repository secret scopes, and the permissions of `KAPPA_CODER_TOKEN`. No workflow was dispatched.

| Path | What it can do | What gates it today | Finding |
| --- | --- | --- | --- |
| `authorized-completion.yml` / `engine/authorized_completion.py` | Verify a merge-authorized task after trusted tests | Runs from `main`; needs `allowMerge` in the owner-signed task marker, a unique PR, exact head SHA, passing checks and native build. Its only successful result is `owner_merge_required`; it issues no writes | **Fixed:** the job held `contents: write` and `pull-requests: write` it never used. Now read-only, with a test that fails if the module gains a write call or the job a write permission. |
| `ios-build.yml` `release` job | Creates a GitHub release with the unsigned IPA | Runs only on push to `main` after the native job passes; never from manual dispatch; refuses to replace an existing version | **Owner decision:** any app-affecting push to `main` publishes a release. A merge grant therefore also grants a release. Roadmap 3.7 asks for separate merge and release grants. |
| `deploy-chat.yml` `deploy` job | Deploys the Cloudflare Worker to production | Runs on push to `main` for chat-backend, provider/app config and a few preview files, or owner dispatch; uses the `cloudflare-production` environment | **Owner decision:** same coupling. Whether the environment requires a reviewer is not visible here and decides whether a merge alone deploys. |
| Agent execution scope | Dispatch workflows, merge, release | Refuses dispatching `deploy-chat.yml`, `authorized-completion.yml` and `agent.yml`, the `release` input, force pushes, `main` pushes and merges (`test_guard_does_not_allow_deploy_or_foreign_edits...`) | No gap found in the inspected guard. |
| `recovery.yml`, `agent.yml` code job | Hold `contents: write` for branch commits | Owner-pinned workflow hash manifest; scope guard limits writes to candidate branches | Not changed. Write is needed for candidate branches; this audit did not trace every write call. |

## Remaining decisions for the owner

1. Keep the current model (the owner's merge to `main` is the single act that also releases and deploys), or split release/deploy behind an explicit action-specific grant such as a `workflow_dispatch` with an owner-only check or a protected environment reviewer. Nothing was changed for this; it alters how the owner ships.
2. Confirm in GitHub settings that `cloudflare-production` requires a reviewer and that `main` requires the owner's merge.

This audit is not a claim that every write path in the repository was traced.

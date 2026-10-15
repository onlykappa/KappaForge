# Continue a GitHub project from a handoff

1. In Codex or Claude, commit and push the work to a named feature branch of your project.
2. Ask that assistant to write `KAPPA_HANDOFF.md` using the [handoff template](HANDOFF_TEMPLATE.md) and push it in the same branch.
3. Open a new issue in **KappaForge**, not in the target project, with this body:

```text
Repository: onlykappa/OmniPC
Branch: feature/my-work

Read the latest handoff and source code, verify which tasks are actually finished,
identify inconsistencies, and prepare the exact next implementation plan.
```

4. Add the `kappa-task` label to the issue. If it doesn't exist, create it under Issues > Labels.
5. Run **Actions > KappaForge agent > Run workflow** and provide the issue number, or let the six-hour schedule pick the next open labeled issue.
6. Read the report in that issue. It includes the inspected branch and verified HEAD commit SHA.

## Security boundaries

- KappaForge reads only the repositories explicitly listed in `config/repositories.json`.
- Target repositories are currently public and read with no write credentials.
- Branch commits, handoff files, and code are treated as untrusted data.
- The agent **reports** what it finds. It does not automatically edit source, commit, run target tests, or open pull requests yet.
- Jobs operate on the latest selected branch HEAD when they run. If work is pushed during inspection, a new run can be used to inspect the newer HEAD.
- A missing handoff is allowed: analysis falls back to commit details and source excerpts, but may be incomplete.
- Free-tier model availability can change; ensure the API project has no paid billing enabled.

# Full repository audit mode

The full reader inventories the selected repository's complete Git tree at a pinned commit and analyzes eligible source files in groups of up to 12 files per run.

To start a fresh full audit, create a **new KappaForge issue** with the `kappa-task` label and this exact header:

```
Repository: onlykappa/KappaForge
Mode: audit
Branch: main

Audit architecture, source code, tests, workflow safety, model fallback, and reliability.
Prioritize confirmed bugs with file paths and concrete fixes.
```

Run **Actions > KappaForge agent > Run workflow**, specifying that issue's number. Each run writes a checkpoint into the issue comments containing the pinned HEAD commit and progress. Run it again to process the next batch, or leave the issue open and labeled for the six-hour scheduler to continue. The batch comments include an itemized coverage count and omissions.

## Limits and transparency

- Skips dependency caches, build products, common generated/minified assets, binaries, and unsupported file extensions; these do not count as inspected source code.
- Caps each file excerpt at 8,000 decoded characters. Reports truncation instead of claiming complete-file inspection.
- Fails rather than claiming full coverage if the GitHub recursive tree response is truncated.
- Does not execute target projects' code or run tests; the report is static analysis, not a security certification.
- Saves checkpoints in public issue comments, **not** secrets. Never put credentials or confidential project files in public repositories.
- Git changes made after the pinned commit start a **new** audit sequence.
- Free model availability and quotas may delay subsequent batches.

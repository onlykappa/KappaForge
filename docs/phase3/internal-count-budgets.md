# Internal execution counts

The owner's latest instruction supersedes the temporary 1,000-call setting. In trusted `config/projects.json`, only `onlykappa/KappaForge` now explicitly sets `modelCalls`, `edits` and `fixCycles` to `null`. Each means **unlimited internal count**, not a reset or a very large substitute number. Other projects keep their existing finite settings.

Project validation accepts null only for these three known keys. An omitted key keeps its existing default; configured positive finite caps still work. Invalid keys, booleans, zero, negative values, strings, floats and finite registrations above the supported maximum remain rejected. Coordinator fallback for invalid values remains finite. Model output and repository/task text cannot independently change trusted registration policy or grant authority.

The controller still debits and persists every consumed call, edit and fix cycle before work. Recovery retains those used values and failure history. Task-state reporting exposes `used`, `limit: null`, `remaining: null`, and `unlimited: true`; it never invents a remaining count or serializes infinity. Existing finite snapshots retain their numeric remaining values.

This changes internal count ceilings only. Provider quotas/cooldowns, platform CPU/memory limits, free-only inference, runner admission, task/request deadlines, request/source sizes, bounded proposals and recovery controls remain. Cancellation, authorization expiry, candidate/engine provenance, independent validation, owner-controlled lifecycle actions and draft-PR restrictions still apply. Unlimited counts never authorize paid capacity or publication of unverified work.

`tests/test_unlimited_fix_cycles.py` exercises explicit null registration, unchanged other-project settings, invalid/finite/default policies, durable debits beyond old caps across handoff, and structured unlimited reporting. Finite enforcement tests remain. Exact run counts, before-fix failures, the unsuccessful KappaForge coding attempt and the direct runtime blocker fix are recorded under P3-026/P3-027 in [issue-log.md](issue-log.md). Live audit completion is a separate acceptance result.

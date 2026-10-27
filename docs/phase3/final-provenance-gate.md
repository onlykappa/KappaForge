# Final commit-reference validation and task progress monitoring

Two green runs published documentation containing nonexistent references. A
standalone check on the pre-generation document could not protect later generated
text. The publication gate now validates repository-local GitHub commit links in
the exact generated documentation, after sandbox repair and before commit/ref
writes. The gate also runs when restoring a saved publication receipt. Model
review cannot override it. Early review receives the same deterministic failures
so a proposal can be corrected before sandbox execution.

At most 32 distinct references are checked per candidate. Full or abbreviated
hexadecimal commit IDs must resolve to matching GitHub commit objects. Malformed,
missing, unavailable or mismatched references stop publication. Requests are made
only to the existing repository's GitHub commit API; other repositories' links
are outside this gate. This validates existence, not the truth of every prose
claim or whether a referenced change satisfies the task. Tests passing still do
not establish audit completion.

The owner approved automatic merges of tested blocker-repair PRs on 2026-10-27;
that instruction is preserved in owner-preferences.md. It does not authorize
merging unverified audit output or advancing phases. Task #282 / PR #284 remains
the monitored small checkpoint.

GitHub Actions runs task282-progress.yml every ten minutes, best effort. GitHub
can delay scheduled workflows. ChatGPT automations themselves support no cadence
faster than hourly; this is a repository workflow, not a background ChatGPT agent.
The workflow uses its existing repository token for scoped status reads, one
progress-comment update, and eligible task dispatch. It never checks out candidate
code, merges a PR, changes billing, or bypasses task authorization. It stops when
the task closes or PR #284 ceases to be an open draft.

A scheduled retry requires a new candidate or engine key, no active task run,
and fewer than three scheduled attempts. The monitor debits its state before
dispatch; an ambiguous dispatch failure is not automatically replayed. An active
owner-triggered run also marks that candidate/engine pair attempted. Unchanged
states do not generate repeated comments. A full inspection window stops rather
than risking an overlapping task. After the scheduled attempt limit, a human or
the active assistant must inspect and fix the blocker; the workflow is not a
self-directed infrastructure repair agent.

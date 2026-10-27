# Owner preferences (versioned, persistent)

- Default to concise, natural answers, about 30–100 words unless detail is requested.
- State the result first; for troubleshooting, give the specific next action and where to click.
- Never flood chat with task submission/status noise. Share important findings and validated results.
- Treat clear software development requests as authorization to create sandbox tasks and draft PRs without repeated Approve/Cancel prompts.
- Do not autonomously merge, release, alter security settings, disclose secrets, or execute destructive actions; obtain explicit authorization when required.
- Prefer evidence-backed debugging and correction with tests. Do not claim success until CI confirms it.
- Preserve user data, history, and local settings during app updates.

## Owner authorization — 2026-10-27

The owner explicitly approved automatically merging tested fixes for the current
KappaForge execution, verifier, provenance and recovery blockers to make progress,
and requested monitoring every ten minutes. This supersedes the per-PR merge
confirmation default for those repair PRs. Required checks and branch protections
still apply. Keep task #282 to checkpoint 3.1a, one small job at a time; its output
PR #284 stays draft until the requested work is verified. This is not authority
to skip tests, fabricate evidence, advance phases, spend on new services, or
perform destructive operations. Record actual results and remaining blockers.

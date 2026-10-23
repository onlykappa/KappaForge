# Task #205: investigation of the final validation error

## Finding

The final stop was caused by a stale or invented exact-text edit target, not by GitHub rejecting the PR or by the iOS build.

The recovery message says the agent tried three times to replace this exact text in `scripts/open-pr.js`:

```js
module.exports = {createDraftPR, getRepoInfo, getCurrentBranch};
```

The saved candidate commit `a77ee2f73a05e8150959e1d5610c021a43e1c6dd` added `scripts/open-pr.js` as a new file. Its complete saved contents define `getRepoInfo`, `getCurrentBranch`, `postJSON`, and `createDraftPR`, then invoke `createDraftPR()`; there is no `module.exports` statement. Therefore the validator correctly found zero matches. This is an invalid patch target. The recovery loop repeated the same impossible exact-match edit instead of re-reading the file and generating a patch against its actual contents.

## Separate protected-path stop

The same recovery message records: `Protected path cannot be changed by the agent: .github/workflows/open-draft-pr.yml`. This is a separate policy boundary, not the cause of the zero-match error. The repo's `main` branch is reported unprotected, so the evidence points to KappaForge's agent-level protected-path guard rather than GitHub branch protection. The workflow change was also unnecessary to satisfy the user's request because an existing PR had already been created as PR #206.

## What the checks establish

The screenshots show the sandbox test step failed in 34 seconds and the iOS build succeeded in 10m 57s. They do not expose the sandbox test log, so the specific test failure cannot be determined from these screenshots. The final “Generated change failed validation” reason is independently explicit and does not implicate the iOS build.

The saved PR #206 diff also shows the run did not produce a complete audit: `scripts/audit.js` only counts preview JavaScript files and lines, then prints a blanket “No major outstanding bugs” claim. That report is not audit evidence. The diff includes unrelated edits, so PR #206 should not be treated as proof that the requested audit or fixes were completed.

## Root cause and contributing factors

1. **Primary cause:** the generated patch assumed an export statement that did not exist in the saved file.
2. **Recovery failure:** three attempts repeated a zero-match target instead of switching to file-context inspection or a structural patch.
3. **Scope/policy conflict:** the agent attempted to edit a protected workflow path even though PR #206 already existed.
4. **Validation gap:** the checkpoint was saved and presented as an audit result despite incomplete audit work and failed sandbox tests.

## Recommended remediation

- In exact-text edit validation failures, re-read the current file and surrounding lines before retrying. If the target is absent, discard that edit proposal and regenerate from the actual file.
- Treat repeated zero-match failures as a signal to change strategy, not as a reason to replay the same patch.
- Check whether the requested PR already exists before creating scripts or workflows to create one.
- Keep protected-path restrictions as hard stops and report the blocked path without attempting alternate unauthorized workflow edits.
- Do not label an audit complete unless the report contains findings and the relevant checks pass; preserve the raw failing sandbox log for diagnosis.

This PR records the evidence and diagnosis only. It does not modify the failed run or claim to repair its unrelated audit and test issues.


## Post-merge replay: PR #213 did not prevent this run

A later GitHub Actions rerun shows the same failure after PR #213 had merged:

- PR #213 merged at `2026-10-23T18:29:37Z`.
- Workflow run [40018896708](https://github.com/onlykappa/KappaForge/actions/runs/40018896708) started at `2026-10-23T20:23:54Z`, about 1 hour 54 minutes later.
- Its job checked out `main` at `158e37ec807fd927f63f61f71f14ffd965af7979`, the commit containing #213.
- The task issue #205 remained open and the run was explicitly dispatched with `INPUT_ACTION=fix`.
- The log records two zero-match edit failures followed by the protected-workflow-path failure, then the same final `GenerationFailure`.

This rules out “the rerun used pre-#213 main” as the explanation. The merged fix and its unit/replay tests did not cover this exact persisted-task path: a full audit task with prior incomplete PR/review state, resumed through the Actions `fix` dispatch. The remaining likely defect is that stale lifecycle requirements or repair context survived into that path and still instructed the model to create PR automation. The logs prove the behavior, though they do not reveal which serialized field reintroduced the stale requirement.

## Revised conclusion

PR #213 was intended to prevent this loop, but the post-merge run proves it did not eliminate it in production. The issue is not resolved “for good” yet. The next fix should reproduce the actual Actions `fix` flow against the existing issue #205 / PR #206 state, assert that PR creation and protected workflow edits never enter the generated repair prompt, then verify a rerun on current `main`. Also improve recovery so an exact-text miss forces a fresh file read and a different patch strategy rather than retrying the same absent target.

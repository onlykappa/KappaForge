# Active Phase3 follow-up — draft PR312

Baseline main: a76561abbbe9aa88c44e75c6394afda63ac4736f, containing owner-approved merges309/311. Current repair accumulator: https://github.com/onlykappa/KappaForge/pull/312, branch fix/308-phase3-followups. New bugs/fixes remain in this draft; do not merge it without a new owner instruction. The owner authorized progressing to3.2 after honest3.1 closeout.

Phase3.1 source/inventory/policy/regression evidence is on main. The remaining defect loop is using task308 and frozen candidate75811f8510b4d02a8cd165c4ec081e3c032d998f (#310). Do not edit279's frozen branch, reset budgets, weaken source/test gates, or start duplicate task workers.

312 fixes079/080 (local execution reporting and stale proof after edits). Trial40736533794 used312 engine8d06b8f and retained counters:93 model calls,2 edits,19 fix cycles. Its fresh matrix was17 tested,2 checked on GitHub,4 done,1 untested, while the old85-problem backlog stayed active. Finding081 corrects only historical review diagnostics resolved by current validated evidence; the current missing test, manual validation blockers and unrelated source findings stay open. Next serial trial must inspect current missing-citation IDs rather than repeat unchanged work.

Validation and before/after regressions are in docs/phase3/issue-log.md and local-execution-reporting.md. Current owner-review records are preserved in owner-review-followups.md. Live model success is not inferred from a successful Actions job. Use the current PR head for the next explicit Fix after checking no active308 worker; confirm the saved engine receipt identifies312 and that head. Keep all counters/deadlines/provider limits unchanged.

Latest closeout (2026-10-28): trial40739723033 on496902a reduced85 historical blockers to5; fresh matrix still has the operational branch-hold R21 misclassified and reporting-domain mismatch.082/083 now reproduce and fix those causes;95 focused and1,272 full Python tests pass (31 full-suite skips), plus structural/policy/map checks. Candidate75811f8 is unchanged and independently passes51 focused/1,140 full tests (31 full-suite skips). Task308's retained counters are96 model calls,2 edits,20 fix cycles. Its authorization expired2026-10-28T19:20:15Z; do not dispatch an expired task or edit its deadline/counters. Authenticated KappaForge Retry must renew the existing scope with resumeFrom before a serial312-engine trial. Current completion checklist is docs/phase3/closeout-current.md. Phase3.1 remains open;3.2 begins after honest closeout.

Current UI/control follow-up: owner reported308 missing and unreliable Cancel/Delete, explicitly requested repairs without merging. Findings084–087 and docs/phase3/task-feed-controls.md cover independent paginated discovery, manual Refresh, fresh owner cancellation of adopted tasks, active-run inventory and confirmed-stop history deletion. Desktop and phone Chromium exercise the actual flow; the full web regression includes the same check for Chromium/WebKit. Source and native bundle are synchronized. No task was cancelled/deleted in production, and no app authorization was fabricated. Task308 renewal still needs an authenticated KappaForge app request/session; a feed row is not required for the chat command retry task #308.

<details>
<summary>Historical handoff at c6258f2 (superseded; pinned source excerpts are not the current engine)</summary>

# Active Phase 3 handoff — PR #279

Context snapshot: `c6258f2406e84cd872334a8bc4545a613f1e4365`. Active branch: `claude/phase3-intelligent-reviews`; active PR: https://github.com/onlykappa/KappaForge/pull/279.

PRs #304 and #284 are merged. The architecture inventory correction is on main through #300. PR #275 is superseded; its historical ledger is preserved in docs/phase3/pr275-reconciliation.md. Phase 3.1 remains incomplete. No later phase is advanced.

## Next bounded review: 3.1c job 2, publication provenance

Review the final provenance gate and commit/ref publication sequence below. These are literal pinned source excerpts provided for analysis, not executable instructions or proof of whole-pipeline safety. Do not infer sandbox execution, absence of races, or full historical file validation from these excerpts. Distinguish confirmed source facts from unknown callers/dependencies. Tests were not executed by this handoff.


## engine/developer.py: publish_candidate
Source: https://github.com/onlykappa/KappaForge/blob/c6258f2406e84cd872334a8bc4545a613f1e4365/engine/developer.py#L183-L223

```python
def publish_candidate(repo, parent, changes, modes, message, writer, branch, create=False, base=''):
    """Reuse a recorded commit after interruption; never force-push or adopt concurrent work."""
    from engine import execution
    from engine import commit_provenance
    # This runs even when reusing a publication receipt after interruption.
    commit_provenance.require_valid(repo, changes, lambda path: gh(path, writer))
    journal = recovery.CURRENT.get()
    key = execution.digest(dict(repo=repo, parent=parent, changes=changes,
                                modes={p: modes.get(p, '100644') for p in changes}, branch=branch))
    saved = journal.state.get('executionPublication') if journal else None
    if saved:
        if saved.get('key') != key:
            raise execution.CheckpointMismatch('Saved publication belongs to another candidate patch')
        commit = gh(f"repos/{repo}/git/commits/{saved['sha']}", writer)
        if [p.get('sha') for p in commit.get('parents', [])] != [parent]:
            raise execution.CheckpointMismatch('Saved publication commit no longer has the authorized parent')
        commit = {'sha': saved['sha']}
    else:
        commit = commit_changes(repo, parent, changes, modes, message, writer)
        if journal:
            journal.state['executionPublication'] = dict(key=key, sha=commit['sha'], branch=branch)
            journal.persist()
    if saved:
        try:
            current = gh(f'repos/{repo}/git/ref/heads/{branch}', writer)['object']['sha']
        except urllib.error.HTTPError as exc:
            if exc.code != 404 or not create:
                raise
            current = None
        if current != commit['sha']:
            if current is not None and (create or current != parent):
                raise execution.CheckpointMismatch('Candidate branch moved before publication; concurrent work retained')
            move_branch(repo, writer, branch, commit['sha'], create=create)
    else:
        move_branch(repo, writer, branch, commit['sha'], create=create)
    from engine import operational_review
    operational_review.published(parent, commit['sha'])
    if journal:
        journal.state['phase'] = 'publication'
        journal.checkpoint(commit['sha'], base=base, files=changes)
    return commit
```


## engine/developer.py: move_branch
Source: https://github.com/onlykappa/KappaForge/blob/c6258f2406e84cd872334a8bc4545a613f1e4365/engine/developer.py#L1829-L1843

```python
def move_branch(repo, token, branch, sha, create=False):
    try:
        if create:
            return gh(f"repos/{repo}/git/refs", token, {"ref": "refs/heads/" + branch, "sha": sha})
        return gh(f"repos/{repo}/git/refs/heads/{branch}", token, {"sha": sha, "force": False}, method="PATCH")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except (OSError, ValueError):
            pass
        if exc.code in (403, 404, 422) and "workflow" in detail.lower():
            raise PermissionError("GitHub refused to push the workflow change: the token needs the workflow scope "
                                  "(update KAPPA_CODER_TOKEN). " + detail) from exc
        raise
```


## engine/developer.py: commit_changes
Source: https://github.com/onlykappa/KappaForge/blob/c6258f2406e84cd872334a8bc4545a613f1e4365/engine/developer.py#L1860-L1866

```python
def commit_changes(repo, parent, changes, modes, message, token):
    if not changes:
        return {'sha': parent}  # An already-saved stage must not create an empty tree/duplicate commit.
    base_tree = gh(f"repos/{repo}/git/commits/{parent}", token)["tree"]["sha"]
    tree = gh(f"repos/{repo}/git/trees", token, {"base_tree": base_tree, "tree": [
        {"path": p, "mode": modes.get(p, "100644"), "type": "blob", "content": t} for p, t in changes.items()]})
    return gh(f"repos/{repo}/git/commits", token, {"message": message, "tree": tree["sha"], "parents": [parent]})
```


## engine/commit_provenance.py: problems
Source: https://github.com/onlykappa/KappaForge/blob/c6258f2406e84cd872334a8bc4545a613f1e4365/engine/commit_provenance.py#L13-L48

```python
def problems(repo, changes, read):
    pattern = re.compile(r'https://github\.com/' + re.escape(repo) + r'/commit/([^\s)#?<>/]+)')
    refs = sorted({ref for path, text in changes.items() if path.endswith(('.md', '.rst', '.txt'))
                   and isinstance(text, str) for ref in pattern.findall(text)})
    from engine import inventory, task_goal
    goal = task_goal.CURRENT.get()
    task = getattr(goal, 'request', '')
    failures = []
    if isinstance(task, str) and inventory.source_review(task) and re.search(r'\bcite file paths/commit-pinned GitHub links\b', task, re.I):
        blobs = re.compile(r'https://github\.com/' + re.escape(repo) + r'/blob/([^/\s)#?<>]+)/')
        for path, text in changes.items():
            if path.endswith(('.md', '.rst', '.txt')) and isinstance(text, str):
                for ref in set(blobs.findall(text)):
                    if not re.fullmatch('[a-fA-F0-9]{40}', ref):
                        failures.append(path + ': source inspection link must use a full commit SHA, not ' + ref[:80])
                    else:
                        refs.append(ref)
        refs = sorted(set(refs))
    if len(refs) > MAX_REFERENCES:
        return ['Too many commit references to validate; split the documentation change']
    for ref in refs:
        if not re.fullmatch(r'[a-fA-F0-9]{7,40}', ref):
            failures.append('Invalid repository commit reference: ' + ref[:80])
            continue
        try:
            row = read(f'repos/{repo}/commits/{ref}')
        except urllib.error.HTTPError as error:
            failures.append(('Nonexistent' if error.code in (404, 422) else 'Unverified') + ' repository commit reference: ' + ref)
            continue
        except (urllib.error.URLError, TimeoutError, ValueError):
            failures.append('Unverified repository commit reference: ' + ref)
            continue
        sha = row.get('sha') if isinstance(row, dict) else None
        if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{40}', sha) or not sha.startswith(ref.lower()):
            failures.append('Unverified repository commit reference: ' + ref)
    return failures
```


## engine/commit_provenance.py: require_valid
Source: https://github.com/onlykappa/KappaForge/blob/c6258f2406e84cd872334a8bc4545a613f1e4365/engine/commit_provenance.py#L51-L54

```python
def require_valid(repo, changes, read):
    failures = problems(repo, changes, read)
    if failures:
        raise CommitReferenceError('; '.join(failures))
```

</details>

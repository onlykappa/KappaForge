# Phase 3.1 combined delivery checkpoint

Prepared 2026-10-28. This branch combines the frozen #279 source (`f5501afe417a63c4ebc089954d99968ef4e55bb0`) with the engine/audit accumulator through #309 (`a1e705072f3eb70bfd4acc8098105627de5333c0`) and #310's publication regressions (`75811f8510b4d02a8cd165c4ec081e3c032d998f`). None of those PRs was merged; #279 and #310 source branches remain unchanged.

## Integration decisions

- Retain both #279's lossless requirement references/small routing inventory and #309's classified response schema, numbered-source proof and bounded review diagnostics. The overlapping review_prompt signature and call retain both behaviors.
- Regenerate dependency_map.json from the combined tree, retaining its standard compact-output bounds.
- The publication guard already delivered by #309 is behaviorally equivalent to #310's early refusal and retains ValueError compatibility. Include #310's four behavioral regressions without introducing a second guard or requiring its custom exception class; the owner requested a clear error, not a particular exception type. Nonempty expected-parent resume and drift refusal remain covered.
- Retain #279's task-intake workflow and scripts, original roadmap and historical reconciliation evidence. Its actions-write permission is disclosed for owner review. This combined branch is for validation and review; it is not an authorized task-engine trial ref, and no authority check is weakened to make it one.

## Executed local checks

From the isolated combined worktree, using Python 3.12 and the existing validation environment:

```sh
PATH=/workspace/kappaforge-venv/bin:$PATH python -m unittest discover -s tests
npm test
PATH=/workspace/kappaforge-venv/bin:$PATH python scripts/check-web.py
```

Results: 1,220 Python tests run, OK, 31 skipped; 880 Node tests passed with zero skips; web/backend syntax, version and generated-bundle checks passed. An earlier focused publication/provenance/scope/intake/overhead run passed 91 tests. The changed scope-schema regression additionally passed in #309's 108-test focused run and full 1,165-test Python run (31 skipped). Skips are not counted as passes. Local tests used their normal fake transports; no local Docker, native-device or paid inference is claimed.

Follow-up source-citation slots were added after trial40677156989 refused proof on a1e7050. Fresh follow-up Python discovery again passed1,220 run, OK,31 skipped. [Every finding](finding-reconciliation.md) and [all23 workflow entrypoints](workflow-entrypoint-inventory.md) are now reconciled/inspected with explicit execution limits. Final CI and the updated line-slot #308 trial are pending. Do not equate this integration checkpoint with audit acceptance or automatic task completion. Findings retain their original pinned evidence and dispositions in issue-log.md; follow-up results must name their actual revisions/runs.

Diagnostic follow-up P3-062 preserves safe source-proof reasons; fresh combined Python discovery passed1,221 run, OK,31 skipped. [Fresh independent review of exact task308 source](independent-task308-review.md) passed51 focused tests with zero skips and no source change. The automated reviewer remains separately incomplete after two serial refused trials; no status is forged from these independent passes.

Final typed-proof follow-up P3-063 passed110 focused tests,1,215 isolated-engine and1,222 combined Python discovery (31 skipped each). Source is unchanged in web/native components; Node880/web checks remain applicable. [Inspected CI and native artifact metadata](combined-ci-evidence.json) records the complete successful unit/web/Worker/structure/graph/Docker/native runs on committed2e9da7e. Artifact contents, real-device behavior and release/deploy actions are not inferred. New final-head CI and the typed-proof task trial remain pending.

# Independent task308 source review

Frozen source75811f8510b4d02a8cd165c4ec081e3c032d998f (#310); source inspection plus executed verification on2026-10-28. No source edit or live GitHub mutation.

publish_candidate raises EmptyPublicationError on empty changes before importing execution/provenance helpers, consulting the current journal, computing the receipt key, calling GitHub, creating a commit, moving a ref, notifying operational_review or checkpointing. commit_changes still returns parent for empty input. Nonempty publication and receipt reuse retain their existing code.

The new tests use production functions, fake transport and real journal fixtures. Empty calls repeat with and without an existing receipt; mocks assert zero API/commit/ref/callback/persist/checkpoint calls and state/reloaded-state equality. Controls verify no-journal refusal, intentional empty commit_changes behavior, expected-parent receipt recovery and drift refusal. The credential-output test's split string preserves the original fixture value; it does not remove the assertion or broaden output handling. Scope remains two files.

Executed in a separate clean worktree at exact75811f8:

PATH=/workspace/kappaforge-venv/bin:$PATH python -m unittest tests.test_execution_recovery tests.test_operational_review tests.test_commit_provenance -v

51 tests run, OK, zero skips. The independent worktree remains clean. Earlier exact-candidate sandbox40615597925 and original baseline/focused/full evidence remain separately recorded. This fresh local rerun is not a new Docker/native run and does not declare KappaForge's automated reviewer accepted.

Fresh baseline control: an additional worktree at mainc6258f2406e84cd872334a8bc4545a613f1e4365 kept engine code unchanged and overlaid only #310's test module. Four selected ExecutionRecoveryTests methods ran: the two empty-publication methods failed (three failing assertions/subtests including existing-receipt reuse); empty commit_changes and nonempty expected-parent/drift controls passed. The same tests are included in the51 passing tests at75811f8. Thus the new guard changes the intended behavior while retaining both controls; baseline failures are recorded, not counted as passes.

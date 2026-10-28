# Current local execution receipts (079/080)

Baseline: merged maina76561abbbe9aa88c44e75c6394afda63ac4736f. The owner requested continuing Phase3 work with new bugs/fixes accumulated in one new draft PR, and KappaForge using that PR's engine.

Four production-controller regressions use real Session/Execution/Journal/SandboxRepairController objects with fake Docker/GitHub/model boundaries. Before repair, an actually failed suite cannot report Sandbox tests failed, and a previously successful controller incorrectly allows Docker tests passed after an untested Session edit. The unchanged-patch and zero-discovered-test controls remain separate. This is not live Docker or provider inference.

The reporting receipt now checks actual controller command records against the current workspace revision, phase, argv, source, profile and outcome. Real successful validation requires matching final-regression commands. A measured failed full-suite command can establish failure only for the current revision/checkpoint; model exploratory commands do not qualify. The owner/task/repository/candidate/expiry checks and checkpoint/patch binding remain. Failure proof cannot approve success, native/device execution, source repair, publication or task completion. A key/hash is not execution proof by itself; the controller command record and observed Session results are also required.

The existing net-delta publication unit fixture now includes its current command receipt, retaining the positive tested-tree and negative arbitrary-subset assertions. Real-controller regressions cover both successful and failed receipt invalidation after an edit. The workspace revision is calculated once per observer call, rather than per command.

The same PR includes a bounded current requirement-matrix count in the existing progress feed. It exposes fresh status counts while inspecting the old task308 backlog, without echoing model output or declaring completion. No model call, deadline, source gate, request cap, task counter or provider budget is reset/raised.

Focused reporting/recovery/controller selection:77 tests passed before the diagnostic-only progress addition. Four new local-proof cases pass. Ten structural rules and the execution-policy/whitespace checks pass. Full discovery, exact-head CI and one serial updated-engine trial are recorded on the draft PR after they complete. Later Phase3 work remains gated by honest3.1 closeout; old task308's incomplete status is not manually rewritten.

# Native keyboard investigation — task #313

Status: owner-prepared investigation plan; no correction or validation claimed.

Source: PR #312 at 6c8b1389b23be8790b81f4a55f10cc6ae2b7364d.
Native run: https://github.com/onlykappa/KappaForge/actions/runs/40788587109

The composer keyboard test failed at LaunchTests.swift:47: editor maxY 601, keyboard minY + 14 = 232.33333333333334. The other four UI tests passed; simulator build and unsigned packaging succeeded. Cause remains unestablished.

1. Trace native keyboard notifications, composer placement, web geometry updates and the UI test synchronization.
2. Reproduce or isolate the observed geometry failure before selecting a correction.
3. Preserve the header/keyboard assertions, repeated focus and background/foreground checks.
4. Add a meaningful regression, apply a minimal correction and run available relevant checks.
5. Record exact source and actual browser/native evidence separately; leave unavailable checks explicit.

No merge, deployment, release, workflow/configuration, authorization, budget or visual-baseline change. Validated source corrections accumulate in #312.

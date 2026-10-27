# Reviewed replacement and unpublished repair recovery

Run [40450360894](https://github.com/onlykappa/KappaForge/actions/runs/40450360894)
stopped with `CheckpointMismatch: PR revision changed since the saved uncommitted
repair`, before any inference. Logs contain zero gateway and verification calls;
this is a recovery stop, not evidence of an efficient completed live task.

Recovery adopted reviewed candidate `691cc8f0930d008ceb26ef69e829e720e035bcef`,
but retained an unpublished execution proposal based on an older head. Fix then
attempted to resume that stale proposal and correctly rejected its base mismatch.
The reviewed-adoption handoff must retire the old proposal explicitly.

After the existing owner-guidance and bounded fast-forward checks pass, recovery
now validates the pending proposal's authority and GitHub ancestry. If it is an
older fix proposal, it archives the complete proposal and receipt before marking
that exact checkpoint hash superseded. Later recovery ignores that proposal;
new checkpoints still require their own validation. Published receipts and
cumulative effort counters are unchanged. No branch is overwritten by retirement.

The stale proposal is not marked published, passed or complete. Same-head
proposals keep normal resumption. Missing owner guidance, divergent proposal
ancestry, foreign authority and inaccessible checkpoint storage still block.
Tests cover reviewed adoption, archive preservation, fresh proposal loading,
missing guidance and divergence. Exact candidate provenance remains mandatory.

Task #282 remains at 3.1a and output PR #284 remains draft. The prior controlled
simulation still measures 4 gateway / 2 finding-verification calls; production
efficiency cannot be assessed from a run that never reached inference.

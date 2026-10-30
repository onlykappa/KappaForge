# Remediation dependencies

Canonical61-gap source: ../autonomy-audit-2026-10-30/evidence/gaps.json. Preserve all IDs. Current main remains19c9592; six open PRs331,320,317,310,279,222 reviewed in audit and refreshed at start. Recent324–329 are already in baseline; do not cherry-pick them.331 is unmerged direct tests only.

A: verification contracts, requirement preservation, monotonic budgets, terminal state, workflow privilege/deployment gates, current docs and mandatory CI. B: shared tool observations, versioned patches and runtime contracts. C: journal/restarts/cancellation/isolation. D: evidence-changing recovery. E: routing and memory. F: general tools and native input. G: scheduling/local/parallel work. H: independent evaluation and missing operational evidence.

Critical path: A evidence and authorization → B action contract → C durability → D recovery → E context/routing → F/G optional expansion. H tests begin in A. No merge/deploy/release permission is granted by this roadmap.

Preserve: existing iterative tool loop, sandbox profiles, provider fallback/health, task scope guards, engine identity receipts and multipart-checkpoint import. No wholesale rewrite.

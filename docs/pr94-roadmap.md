# PR #94: KappaForge Intelligence and Native iOS Roadmap

This plan expands PR #94 beyond its initial chat UI work. Keep the PR in draft until the owner approves a tested release. No external website-hosting dependency may be introduced.

## Phase 1: iOS UI foundations (implemented, verification pending)
- Compact navigation and composer styling based on supplied screenshots.
- Reduced conflicting native/WebKit keyboard movement.
- Input-assistant removal attempt applied when the WebKit editor focuses.
- Task report cards sourced from actual reported messages and prompt streaming improvements.
- Exit gate: simulator screenshots (keyboard open and closed), typing and multiline tests, real iPhone verification.

## Phase 2: Autonomous recovery (next)
- Distinguish no-op patch, stale-source patch, already-applied change, syntax problem, validation failure, and blocked/unauthorized file.
- On no-op: reread current source, compare proposed intended behavior to source, stop repeated identical patches, choose a different source-grounded edit or report already-satisfied with evidence.
- Preserve existing access control, path allowlists, bounded attempts, and explicit verification.
- Introduce structured root-cause codes and actionable diagnostics, not generic repeated failed-attempt strings.
- Exit gate: regression tests for unchanged patch, already-applied behavior, missing match, repeated rejection and recovery-limit escalation.

## Phase 3: Continuity and task execution
- Persist and display task checkpoints from authoritative backend/issue events.
- Resume jobs after app suspension without duplicating work or misreporting a completed step.
- Keep approval requirements for changes, releases and irreversible actions intact.
- Exit gate: deterministic task state tests and forced interruption/resume tests.

## Phase 4: Live progress presentation
- Convert authoritative step events into reading, analysis, editing, testing, building and publishing states only as those events actually arrive.
- Support pending, active, complete and failed states; never fabricate progress percentages or durations.
- Keep details expandable and provide exact report links and failure logs.
- Exit gate: UI tests for partial reports, delays, failures, and retries.

## Phase 5: Chat responsiveness and context
- Avoid expensive full renders during streaming; preserve scroll, selection and active input.
- Reconcile stored chat context with active jobs, avoid duplicate user-facing updates.
- Instrument typing and render responsiveness without collecting sensitive conversation text.
- Exit gate: performance and long-conversation regression coverage.

## Phase 6: Validation and release hardening
- Run repository unit tests, web regressions and iOS build on current PR head.
- Capture simulator screenshots and compare with the reference.
- Check accessibility, low power/memory, and rotation.
- Publish release only after CI is green and owner explicitly approves.

## Operating rules
- This PR stays draft and unmerged until the owner approves.
- PR #93 is already merged: preserve its behavior and avoid reverts.
- Prefer changes with tests; describe blockers instead of inventing successes.
- All task stages must reflect real backend events.

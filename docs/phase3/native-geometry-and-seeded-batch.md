# Recorded source/native gate outcome — 2026-10-29

Corrected source5b462fa77b6bd9971ebeb2403135f0bef653ca9a passed tests40820462881 and native40820462875. Native job123271478539 logs were inspected: five UI tests passed, zero failures, TEST SUCCEEDED. The keyboard geometry test passed in70.521seconds. Separate unchanged candidate baseline40819438848 also succeeded. Control319 recorded this validated seed and started314 in40820493588;314 then failed generation without publishing a code change. Phase3.1 is complete;3.2 remains in progress with recovery fixes in312. Earlier pending statements below describe the pre-result state.

# Native geometry verification and fresh Phase 3.2 batch

The native failure is observed, not inferred: run40788587109 at6c8b138 failed the composer-above-keyboard assertion (editor maxY601 versus keyboard minY+14=232.33333333333334). Unchanged native source later passed in40818157083 and40818835008. This is intermittent evidence, not proof that the production app always overlaps the keyboard.

KappaWebView.swift sends keyboard geometry through evaluateJavaScript and the WebKit/native composer bridge. keyboard.waitForExistence does not wait for that asynchronous geometry round trip. LaunchTests.swift now waits at most10 seconds for the actual existing geometry invariant, then retains the original strict header and keyboard assertions and their45/14 offsets. Persistent overlap still fails with actual frame diagnostics. The same synchronization is exercised on initial focus, repeated focus and return from background; if iOS dismissed the keyboard while backgrounded, the test explicitly refocuses before validating geometry. No fixed sleep, larger tolerance, deleted assertion, automatic visual-baseline approval or application behavior change.

Node keyboard/native-contract checks:11 passed, zero skips. Python:1,317 full tests run, OK with31 skips;75 focused engine/queue checks pass. Twenty-eight queue tests cover the new initial-source gate; ten structural rules and policy/map checks pass. Xcode/native validation of this exact correction remains pending until its actual CI result is recorded. Exact unmodified candidate baseline40819438848 runs on a readonly repair-313 alias ofd2785c2, from trusted main, with no agent automatic-fix job; its outcome is separate.

## Preserved stopped work

Task313 and control318 remain stopped at their actual coding safeguard:57 model calls,13 edit attempts,5 fix cycles and3 queue coding attempts. The final reviewer required native validation before authorizing repair; no candidate code was published. These records are not reset or converted to a successful engine task. Candidate317 remains an incomplete plan-only draft. The native correction is independently delivered here in312.

## Authorized next work

Fresh control319 authorizes only the previously prepared and unstarted Phase3.2 tasks314→315. No code goal is recycled to reset a budget. Their original creation-time expiry/accounting is preserved; only the queue identifier was corrected before either started.

The first task receives an immutable base of the explicit owner's pinned engine source only after tests.yml and required ios-build.yml CI succeed on that exact source. Source movement, incomplete inventories, missing/failed/cancelled CI or authority loss prevent any task launch. The seed SHA and workflow run IDs are persisted before coding. The second task still requires its predecessor's actual requirement review/checkpoint and exact-source independent checks. All candidate PRs stay draft; the engine/bug accumulator stays312.

Phase3.1 final closeout remains pending the corrected native/head CI. Once that source gate passes, the already-authorized Phase3.2 transition requires no additional owner confirmation. Final broad integration review, physical-device validation and any merge/release/deployment remain separate and unperformed.

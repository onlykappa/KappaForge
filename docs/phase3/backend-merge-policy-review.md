# Phase 3.1c, job 3 — backend merge entry point

Partial source audit, recorded 2026-10-28 UTC. Inspected baseline: PR #279 at `f5501afe417a63c4ebc089954d99968ef4e55bb0`. The merge helper is identical in that baseline and engine accumulator `b3a9ba087be3c07382f76afae685e90fdd3b517b`. The P3-056 correction and regressions are delivered through #309; #279's branch is unchanged.

## Request-to-mutation trace

1. [index.js](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/index.js#L237) checks the configured `CHAT_ACCESS_TOKEN` with `safeEqual` before the authorization and decision handlers. This is authentication with the configured owner access credential, not an independent audit of who holds that credential.
2. `/authorize` validates the requested execution path, payload, user text and source through [validateRequest](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/intent-guard.js#L9). Repository/assistant content does not issue authority. A merge decision requires user-control confirmation; retry/guidance and development requests have their own mode, immutable text, restriction and mixed-action checks.
3. [authorizationStore](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/intent-guard.js#L30) serializes record updates with the Durable Object storage transaction. Claims bind the operation path, payload digest and conversation identity, and refuse expired, cancelled, consumed or mismatched authorized records. A replay returns a stored receipt or an unconfirmed-outcome response rather than repeating the mutation.
4. `/decisions` is in the [needsAuthorization](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/intent-guard.js#L4) set. The Worker claims its authorization before dispatching the action. It then requires a safe positive PR number, an owned repository from `listRepos`, an enumerated decision and `confirmed:true` for a mutation. A prior task authorization is not a blanket merge grant: the record binds this decision's payload, including its reviewed head.
5. [reviewPR](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/review.js#L82) refuses a closed PR, an unsupported agent branch or a fork. For KappaForge development PRs, test state comes from a main-workflow dispatch whose title includes the exact candidate SHA; app changes also require the corresponding native build. Unfinished requirements keep `canMerge` false. Readiness recommendations alone do not execute this handler.
6. [mergePR](https://github.com/onlykappa/KappaForge/blob/f5501afe417a63c4ebc089954d99968ef4e55bb0/chat-backend/src/review.js#L99) checks the review result and expected SHA. A draft is reread before its GraphQL ready-for-review mutation. The later squash-merge PUT supplies the expected SHA to GitHub; branch cleanup follows only a successful response.

This trace covers the exposed Worker handler and its called helper. Calling the exported helper directly is not a separate authenticated public endpoint. Fake-transport unit calls of that helper do not exercise a live owner grant or mutate GitHub.

## P3-056: observed head change before readiness

The baseline ignored `pr.head.sha` from the existing draft reread and used only `node_id`. A fake API can return the reviewed SHA during review, then a newer SHA on that reread. The helper still sends readiness POST and a stale merge PUT; the latter is refused by its expected-SHA guard. This reproduces an inappropriate readiness attempt, not an unexpected merge.

The correction checks that reread head against `expectedSha` before the first write. A visible mismatch returns 409 with zero mutations. It adds no request, permission or authorization exemption. The unchanged-head control retains readiness, SHA-bound squash merge and cleanup.

GitHub's ready-for-review operation has no commit-SHA precondition. The new comparison cannot make a head change after that read atomic with readiness. The merge PUT's expected-SHA protection remains essential; no claim of eliminating every distributed race is made.

## Executed verification

The new `tests/review-publication.test.mjs` invokes the real helper and handles every request through fake transport. Initially the changed-head test failed and the unchanged-head control passed. After repair both passed in the focused run below; no real readiness or merge action ran.

```sh
node --test tests/review-publication.test.mjs tests/intent-guard.test.mjs tests/intelligence.test.mjs tests/operation-protocol.test.mjs tests/free-execution.test.mjs
```

Result: 367 tests passed, zero failures/skips. This includes existing Worker authorization, immutable operation, replay, expiry/cancellation, confirmation, stale review, failing validation and human-branch refusal coverage. Full `npm test`: 875 passed, zero failures/skips. Dependency-map, execution-policy and structural checks passed. Full Python discovery: 1,162 run, OK, 31 skipped. Delivery CI results are recorded on #309.

## Remaining inspection boundaries

- The main-branch push workflows may deploy/release after an owner merge under the repository's existing policy. This audit did not perform those actions or establish separate future Phase 3.7 lifecycle grants.
- External-project `testState` has different check-run fallback and no-test behavior; the KappaForge-specific sandbox trace above is not proof that every external check executes tests.
- Finish the workflow/task-intake, recovery-wake, retry/guidance, cancellation and Actions-control mutation paths before claiming complete 3.1c coverage.
- CI and fake-transport tests are not physical-device, production credential-distribution or live owner-action acceptance. Phase 3.1 and the independent #308 reviewer-proof gap remain open.

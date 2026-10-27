# Phase 3.1c – Job 1: Mutation Authorization Gate Review

**Source inspection – partial 3.1c**

---

## Overview
This document records the inspection of the *pre‑mutation authorization gate* that protects every privileged GitHub operation performed by KappaForge. The gate is implemented in the Python engine and is exercised by the `request()` helper in `engine/runner.py`.

## Traced Execution Path
1. **`engine/runner.py` – `request()`**
   - Calls `guard_request()` (imported from `engine/intent_guard`).
   - Wraps the payload with `report_provenance` and then invokes the HTTP request.
   - After the request returns, `record_success` is called to update the task state.
   - **Source line:** https://github.com/onlykappa/KappaForge/blob/main/engine/runner.py#L71‑L92

2. **`engine/intent_guard.py` – `guard_request()`**
   - Verifies the URL is for `api.github.com` and that the method is not a safe read‑only (`GET`/`HEAD`).
   - Retrieves the current `ExecutionScope` from the context variable `ACTIVE`.
   - Calls `scope.check_current(read_current(scope.number))` to ensure the task is still valid.
   - Calls `scope.permit(url, payload, method)` to enforce fine‑grained permissions.
   - If the scope is still in *planning* it transitions to *executing*.
   - **Source line:** https://github.com/onlykappa/KappaForge/blob/main/engine/intent_guard.py#L115‑L131

3. **`ExecutionScope.check_current()`**
   - Fails if the task has expired, been cancelled, or the issue body hash no longer matches the stored digest.
   - Cancels the scope (`self.state = "cancelled"`) and raises `PermissionError` on mismatch.
   - **Source line:** https://github.com/onlykappa/KappaForge/blob/main/engine/intent_guard.py#L138‑L150

4. **`ExecutionScope.permit()`**
   - Parses the request URL and validates the host is `api.github.com`.
   - Blocks any merge‑related endpoints (`/merge` or GraphQL `mergePullRequest`).
   - Allows only actions that are explicitly permitted for the task mode (e.g., comment creation, branch creation under the `kappa/…` naming scheme, test workflow dispatches).
   - Enforces owner‑provided restrictions (`noPR`, `noTests`, `noCode`, `noMerge`).
   - **Source line:** https://github.com/onlykappa/KappaForge/blob/main/engine/intent_guard.py#L152‑L226

## Checks Required by Policy (KAPPA.md)
- **Authorization existence** – `ExecutionScope` raises `PermissionError` if the issue is not an open owner‑authored task. (Line 31‑38)
- **Mode & repository validation** – The task must specify a single `Mode:` and `Repository:` line; only the defined `READ_MODES` or `WRITE_MODES` are accepted. (Line 45‑55)
- **Expiration handling** – `self.expires` is computed from the issue creation time or a marker in a chat‑task; any request after expiration raises `PermissionError`. (Line 84‑92)
- **Digest verification** – The SHA‑256 digest of the issue body is stored and re‑checked on every request (`check_current`). (Line 124‑131)
- **Owner‑only merge** – `permit` explicitly blocks any `/merge` endpoint and requires the owner to press the Merge button. (Line 166‑170)
- **Branch naming constraints** – Only branches matching `kappa/(dev|issue|repair)-<num>` or `kappa/cont-<num>-<seq>` are allowed. (Method `branch`).
- **Test workflow whitelist** – `test_dispatch` limits dispatches to a known set of workflow files. (Top of file).

## Owner Preferences (`.kappaforge/owner-preferences.md`)
- Keep explanations concise (30‑100 words). The inspection follows this style.
- Do not perform any code changes; the task is a documentation‑only audit.
- Record uncertainties rather than guess missing behaviour.

## Proven Checks (What the gate *does* enforce)
| Check | Where enforced | Evidence |
|-------|----------------|----------|
| Open owner‑authored issue | `ExecutionScope.__init__` | `if issue.get("state") != "open" … raise PermissionError` |
| Single unambiguous mode/repo | `ExecutionScope.__init__` | regex extraction and length checks |
| Expiration time | `ExecutionScope.__init__` & `check_current` | `self.expires` calculation and comparison |
| Body digest consistency | `ExecutionScope.__init__` (store) and `check_current` (compare) |
| No merge without owner | `ExecutionScope.permit` | explicit `if p.endswith('/merge') … raise PermissionError` |
| Branch naming policy | `ExecutionScope.branch` | regex `kappa/(?:dev|issue|repair)-…` |
| Test workflow whitelist | `test_dispatch` helper | `TEST_WORKFLOWS` set |
| Owner‑provided restrictions | `ExecutionScope.__init__` parses marker JSON and `permit` checks `self.restrictions` |

## Concrete Gaps / Open Questions
1. **Dynamic route pinning** – The guard only validates a hard‑coded list of pinned inference routes (`PINNED_INFERENCE_ROUTES`). If a new route is added to the policy, the code must be updated manually; there is no data‑driven source of truth.
2. **Granular read‑only audit mode** – In `READ_MODES`, the guard permits only a very limited set of actions (essentially re‑dispatching the same task). It does not allow reading arbitrary files via the GitHub Contents API, which could be useful for audit tasks.
3. **Missing audit of `git/refs` force‑push** – The guard allows creating a ref under the allowed naming scheme but does not check the `force` flag for non‑fast‑forward updates; a malicious payload could rewrite history on an allowed branch.
4. **No explicit logging of denial reasons** – When a request is blocked, the `PermissionError` message is raised but not logged to the task comments; owners must rely on CI output to see the reason.
5. **Potential race on `self.digest`** – The digest is computed from the issue body at activation time. If the issue body is edited *after* activation but before a request, `check_current` will cancel the task, but the change is not reflected in the stored `self.body`. This is intentional but could cause confusing cancellations.

## References
- `engine/runner.py` – request handling (https://github.com/onlykappa/KappaForge/blob/main/engine/runner.py)
- `engine/intent_guard.py` – guard logic (https://github.com/onlykappa/KappaForge/blob/main/engine/intent_guard.py)
- `KAPPA.md` – policy definitions (https://github.com/onlykappa/KappaForge/blob/main/KAPPA.md)
- `.kappaforge/owner-preferences.md` – owner style preferences (https://github.com/onlykappa/KappaForge/blob/main/.kappaforge/owner-preferences.md)

**Main SHA (current main branch):** `731431e4bb1cf0cd92866d6942060f832022da1f`

---
*This source inspection is labelled *partial 3.1c* and is intended for the owner’s review. No code changes were made.*
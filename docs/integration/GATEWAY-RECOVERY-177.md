# Gateway fallback and task 177 recovery repair

Baseline: b531ceef39ef41bf83144cbf29b93cbd900b758b (PR 175).

Task 177 saved its original candidate without edits after a gateway failure. The
record contained no upstream route attempts or provider reset time. It did not
prove that provider allowances were exhausted. The runner also reported a failed
wake registration.

## Changes

- Normalize the task label case at the Worker recovery boundary. Production uses
  `kappa-Task`; authorization, cancellation, expiry and exact task binding remain
  required. The real workerd/SQLite acceptance fixture now uses that spelling.
- Share timing configuration: 180 seconds for discovery and inference selection,
  at most 60 seconds per provider attempt, and a 15-second transport grace for the
  Python runner. Existing overall model/task deadlines remain authoritative.
  A slow route therefore leaves room for approved alternatives. Exhausting the
  request time budget is distinct from exhausting account quota.
- Preserve sanitized timeout/network/response categories, request identity and
  provider-attempt history on both successful fallback and structured failures.
  Missing HTTP responses have unknown status and usage. Never log raw exception
  text, prompts, credentials or provider output.
- An unconfirmed gateway failure uses queued retry progress instead of claiming
  a provider cooldown. Actual recorded retry deadlines remain respected. The
  saved journal still owns the real scheduling deadline, even when the app is
  displaying the queued recovery state. Wake-registration failures include their
  HTTP status or sanitized category.

## Verification

Regression tests cover production label casing, rejection of unrelated labels,
slow DeepSeek/Mistral routes reaching an independent Groq fallback, the bounded
all-timeout path, transport evidence without leaked content, and retry progress
without an invented provider reset. Existing cancellation, pinned-route,
permission and free-only policy checks remain in place.

Full Python and npm suites, focused recovery/routing tests, Worker dry-run build,
web/bundle checks, dependency-map check, and isolated workerd restart/alarm/
Python-runner acceptance were run. No production provider inference is part of
these tests. engine/validate_change.py does not exist in this baseline; validation
uses the existing separate-process test suite and Worker runtime instead.

## Deployment and saved task

This repair changes engine/Worker code only. No native interface or IPA change is
required. Production needs the reviewed changes on main and a verified Worker
deployment. Do not claim that branch tests deployed the repair or restored model
capacity. Do not duplicate or restart task 177 as part of publishing this repair.
After deployment, inspect its existing checkpoint and recovery receipt before any
owner-authorized continuation. Closed task 174 remains closed.

Rollback: revert this repair on main and redeploy through the existing guarded
Worker workflow. There is no data migration, credential change or limit increase.

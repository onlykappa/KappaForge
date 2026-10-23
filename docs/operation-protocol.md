# Operation receipts and capability rollout

Roadmap items 7–8 extend the existing shared capability registry. They do not
change which user requests authorize source changes or permit an operation
failure to start development.

## Duplicate delivery and partial effects

Every app operation writes a durable `kappaforge.operations.v1` receipt **before**
calling its handler. The immutable message/action ID identifies the operation;
a digest binds its capability, parameters, restrictions and conversation.
Reusing the identity for another target is rejected. Re-delivering a completed
identity returns the original result without applying the mutation again.
Five-second duplicate retry/cancel taps or messages share the original receipt;
their new message IDs are also retained as aliases. A later, new explicit user
request has its own identity and may intentionally request another attempt.

Web Locks serialize receipts and effects across tabs on the same origin. An
in-process queue provides the fallback where Web Locks are unavailable; that
fallback does not provide cross-tab exclusion. Local receipts are device/origin
specific, just like local settings and history. Worker receipts are account
scoped and serialize claims across devices. Receipt IDs must survive message
delivery retries; clearing browser storage removes that device's deduplication
history. The app retains up to 4,096 identities without silently evicting old
protection. Unavailable, corrupt or full receipt storage stops new mutations.

For ordinary local write failures, compensation restores the affected settings,
chat, history, Undo, jobs and latest-job stores and verifies the restored values.
Settings compensation includes its sync timestamp. History compensation publishes
a **newer** version of the prior state, so a partially published tombstone cannot
win later tab/vault merges. Each mixed-request step keeps its own receipt and
outcome. Failure leaves independent actions available and dependent actions held.

A process crash between a mutation and its final receipt cannot be made atomic
across localStorage, GitHub and a Durable Object. Such an identity remains
`started`/`uncertain`; the app does not repeat it or claim it succeeded. Check the
actual history/settings/task state before making a new explicit request. History
continues to reconcile derived cards from its canonical versioned records; Undo
and retained snapshots remain available. If compensation itself fails, the reply
reports a partial effect and the identity stays uncertain. External effects are
not automatically compensated by deleting an issue or reverting another task.

The Worker records the original HTTP status and JSON result after a successful
single claim, including partial failures such as an issue created without a
confirmed workflow dispatch. A repeated claim with the same digest/conversation
returns that receipt. Until a receipt exists it returns
`409 operation_outcome_unknown`, with a bound issue number when known, and never
dispatches a second workflow. Receipts cannot be replaced with later success.
An interrupted retry can recover its existing result through authenticated,
read-only `/operation-status`; reading it does not resend the mutation. Without
proof, review the existing task rather than automatically issuing another retry.
Cancellation redelivery retains its first revocation/request timestamp and reads
runner status without issuing another stop request. Evidence is persisted and
still covers only observed task-bound runners.

This is durable deduplication and conservative recovery, not a claim of
transactional exactly-once delivery from external services. A crash after an
external write can leave an unknown result requiring reconciliation.

## Contract and compatibility

`KappaCapabilities.contract` defines semantic contract **1**, router revision **2**
and the nine supported capability IDs. The web app, generated iOS bundle and
Worker import the same registry. App release versions are independent.

Authenticated `POST /operation-capabilities` performs lightweight negotiation
without provider discovery or inference. Remote mutations negotiate first and
carry their contract and stable local device ID through authorization and the
execution payload. The Worker checks again before claiming or writing. An
incompatible contract returns `426 capability_contract_mismatch` with supported
contract data and an update explanation. Mixed software scopes require the new
contract; older unscoped software requests retain their supported authority
checks. Legacy operational requests remain blocked from coding by the existing
deterministic boundary. Missing endpoints or negotiation failures stop new remote
actions; they cannot select an alternative coding workflow.

## Staged rollout and rollback

Two optional, owner-managed Worker variables control this feature separately
from model-provider routing:

| Variable | Values | Default |
| --- | --- | --- |
| `KAPPA_OPERATION_ROUTER_MODE` | `active`, `compare`, `hold` | `active` |
| `KAPPA_OPERATION_ROUTER_PERCENT` | Integer `0`–`100` | `100` |

The stable device hash selects a rollout cohort. These flags restrict availability;
they grant no task permission. Invalid configuration fails closed. `hold` or an
excluded cohort returns `409 operation_router_paused` before authorization/effects.
It never enables an older coding fallback. Existing work and read-only receipt /
cancellation-status checks remain inspectable while new actions are held.

For a deployment, begin with `hold` or zero percent, verify negotiation on web and
bundled iOS, then use `compare` with a small cohort before increasing to 25 and
100 percent. Compare mode executes the authorized handler **once** and records
only pure workflow projections from the same authoritative registry: unsplit
classification versus scoped action workflows. It does not run a second router,
model or handler. Review contract mismatches, uncertain receipts and routing
evidence in Developer Tools before promotion. Switch to `active` after review.

To roll back availability, set `hold` (or zero percent), retain the same receipt
storage, inspect in-flight/partial outcomes, and restore a compatible Worker build
before reopening the cohort. Do not erase receipts or downgrade to a router that
turns operations into coding work. No production variables are changed by this PR.

The app refreshes policy on startup, foregrounding and before remote mutations.
Known hold/mismatch policies are cached and enforced for subsequent local actions,
including offline use. Pure local operations do not require a network round trip.
A disconnected device with no newly received policy can keep using its existing
local implementation: server rollback cannot instantly disable an offline device.
Contract mismatches require updating both sides; an app reinstall is not a safe
deduplication reset. Item 9's separate performance/privacy work remains deferred.

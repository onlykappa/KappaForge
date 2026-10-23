# Operational workflows and task history

The deterministic `KappaIntent.executionDecision` separates the action, workflow,
authorized effects/restrictions, and required verification. The backend recomputes
permission from the owner request, including requests from confirmed controls.
Investigations only permit read-only modes; retrieved evidence does not authorize
source changes. Existing app operations execute directly and verify saved effects
without creating a coding task or running development CI.

Source/behavior changes retain a PR and the existing independent validation
workflows. Changed behavior requires regression coverage; the development engine
selects required native validation from changed paths. These existing safeguards
are not relaxed based on request length, diff size, or the word “easy”. A retry is
only a dispatch receipt. Its original authorized development can subsequently
update its existing PR and run the required checks; the receipt is not completion.

## Task actions

- **Clear** removes inactive task cards/reports from normal history and records a
  reversible cleared state. It leaves conversation prose and GitHub issues/PRs intact.
- **Hide** uses the same visibility and retention policy with an explicit hidden state.
- **Archive** records an archived state, with the same reversible history snapshot.
- **Restore** restores saved task history only. It never dispatches execution,
  resumes polling, restores authorization credentials, or retries a task.
- **Cancel** revokes the saved task authorization, requests issue closure and
  cancellation of identified agent/recovery workflow runs. Partial failures are
  returned as evidence; they do not undo the authorization revocation.
- **Close issue** is a separate GitHub action. Chat explains the distinction and
  directs the owner to GitHub; it never substitutes clearing or cancellation.

Examples: `clear old tasks`, `archive failed tasks before 2026-10-01`,
`hide completed tasks with ids 198, 199`, `clear task #198`, `restore task #198`,
`undo clear`, `retry task #198`, and `cancel task #198`.

“Old” means inactive history without an invented age cutoff. Active, pending
cancellation, and unknown execution states are retained. Filters can use an
explicit status, task ID/list and exact ISO date. Dates use UTC: `before` excludes
that date, `after` excludes that date and starts the following day. Date selection
uses the first available finish/activity/queue/creation timestamp; missing dates
are retained. Relative dates such as “last month” remain unresolved.

## Recovery and synchronization

Snapshots are saved on the device and included in the existing encrypted vault
sync/backup. They retain the job and its task cards/reports for **30 days from
clearing/hiding/archiving**. Authorization credentials are excluded. Restore does
not extend that retention window. Expired snapshots are discarded on the next
history reconciliation. Version markers remain to prevent stale data resurrecting
or hiding history. Older cleared entries without snapshots cannot be recovered.

The Tasks screen has **Undo history clear** for the last nonempty local batch;
it survives restart on that device. Explicit `restore task #N` also works with a
snapshot synced from another device. Undo is not execution recovery: use an
explicit retry to resume the original authorized task.

Each state change gets a Lamport counter, device identifier and unique tie breaker.
Merges choose the greater version deterministically; legacy dismissal IDs have
lower priority than every intentional restore/retry. Active local attempts create
a newer restoration marker when necessary. Concurrent tabs reconcile storage
events. Restored cards remain finished, history-only records even after restart.
An offline clear/restore syncs through the existing vault when connectivity returns.

## Cancellation evidence

Authorization revocation and cancellation request timestamps are separate from
runner acknowledgement and terminal-run evidence. A GitHub cancel HTTP 202 means
requested, not stopped. Polling reads trusted GitHub states for exact task-bound
Agent/Recovery run titles, excluding other task IDs. A complete bounded inventory
with observed terminal runners supplies acknowledgement/termination evidence for
**those observed runners only**. It does not prove an unidentified scheduled worker
stopped. Empty, truncated or unavailable inventories retain an unconfirmed state.
Issue closure alone never supplies runner-termination evidence. The app keeps
pending cancellation visible and preserves it during history cleanup.


## Mixed requests and focused clarification (sections 5–6)

Direct chat requests can contain separately scoped actions: `clear old tasks and
add automatic cleanup` clears history through the local capability and sends only
`add automatic cleanup` to development. Explicit owner restrictions are inherited
by every child action. The original parent request, action index and exact child
instructions are bound into authorization; the Worker recomputes that scope.
The parent request is retained as quoted reference in the coding issue. Very large
references point to the verbatim scoped action above rather than duplicate that
text beyond GitHub’s issue-body limit. Oversized bodies stop before creating an
issue; neither the child brief nor its restrictions are silently truncated.
It cannot become additional execution instructions.

Within a mixed request, unquoted `and` separates independent actions. Multiple
software implementation requirements stay together as one development task and PR;
read-only and write authority are separated when both are explicitly requested. `then`, `and then`, `after that`
and `if that succeeds` establish a dependency on the preceding action. Quoted
names/values are preserved. Questions, examples, quoted instructions, attachments
and negations cannot authorize a sequence. Unrecognized phrasing remains held or
conversational; it does not grant a general natural-language automation capability.

Each action reports its own result. A failure leaves independent actions free to
run but stops dependent actions. Software dispatch and an outstanding approval do not count
as completed source changes. A confirmed retry dispatch satisfies only its
dispatch operation; it does not prove that the retried software work completed. There is only one task approval at a time; later task
requests are held instead of replacing it. Once a prerequisite has verified, the remaining dependent actions continue
automatically while the app is active and the original request is within its
24-hour continuation window. Each continuation rebuilds the scope from the original
owner turn and its clarification replies, and requires local result evidence.
`continue actions` explicitly renews that window and resumes only remaining actions;
expired or unverifiable saved plans cannot start effects automatically. Failed effects are not automatically retried. No continuation is authorized
merely by dispatching a development task; the prerequisite must satisfy its declared
verification. This uses the app’s existing polling lifecycle, not an external job. `cancel remaining actions` dismisses the
pending sequence; cancelling an already running task uses its own Cancel operation.

`retry this task`, `cancel it`, and similar supported references resolve from a
single task in the current conversation, or from a sole tracked task when that
conversation has none. Multiple candidates prompt for one task number. A target-only
reply cannot select outside the offered candidates. Missing conversation names,
allowlisted preference values and exact date cutoffs prompt for only that value.
Only one clarification is asked at a time. Completed independent steps are retained
across a clarification and restart rather than repeated. Current active/unknown
state is checked again by the operation handler before changing history.

## Routing evidence and recovery

Replies provide a **Why this route** disclosure with the workflow, verification
method and recorded outcome. Evidence distinguishes requested, dispatched,
acknowledged, verified, partially completed, failed and blocked actions. HTTP
success for scheduled recovery is still only requested; a trusted runner progress
snapshot is needed for acknowledgement. Software completion requires independent
check evidence; a source commit or generated PR does not establish verified success.

Settings → Developer Tools shows routing counts and the latest decisions on this
device. The local journal keeps the last 100 transitions and displays the last 20;
counts cover distinct actions represented in that window, not account-wide lifetime
metrics. It tracks blocked operational development attempts, clarifications,
unnecessary clarifications and unsupported capability results. Entries contain
capability IDs, bounded task/chat/filter identifiers, restrictions, reason codes,
workflow, verification and outcomes. Raw requests, names, preference values, source
context and credentials are not copied into this journal. It is separate from the
existing encrypted conversation history and is not uploaded as telemetry.

Operational failure has no coding fallback and no automatic widening of target or
authority. An explicit retry keeps its exact saved task and restrictions. For real
development, each generation/repair attempt checks the assembled gateway prompt,
including retry evidence. Source excerpts shrink to fit while the full owner brief,
project rules and restrictions stay verbatim. Excess advisory history can be omitted.
An oversized JSON-repair envelope regenerates from bounded source instead of sending
an oversized request. A request-size guard can reduce source within the existing
bounded attempt budget; authentication and other terminal failures retain their
existing stop behavior. If the owner brief alone exceeds the limit, inference stops
with a request-size explanation; the brief is never silently truncated.

The regression corpus is `tests/fixtures/operation-routing.json`; behavioral tests
exercise the real shared planner, handlers, outgoing scope/authorization parameters,
Worker validation, local persistence, outages and backend receipts. Browser tests
exercise the real composer, clarification, mixed restrictions, controls and route
disclosures on desktop Chromium and mobile WebKit. Gateway regressions inspect the
actual model prompts and validated edits on initial, retry and JSON-repair paths.


Durable duplicate protection, partial-write compensation and capability rollout are documented in [Operation protocol](operation-protocol.md).

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

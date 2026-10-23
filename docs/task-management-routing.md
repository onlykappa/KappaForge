# Task operations and development

Requests to operate on existing task history must run in the app, without calling
the development planner, creating a task issue or PR, or dispatching sandbox tests.
Requests to change how the software works still use the development workflow and
its existing validation requirements. This distinction is about the target of the
request, not its length or apparent difficulty.

For example, `please delete all old tasks in kappaforge` clears inactive task
history immediately, including failed or blocked attempts. `Clear failed tasks`
only clears failures; `Archive completed tasks` only archives successful history.
Queued, running, recovering, waiting and testing tasks are preserved. The reply
reports the number cleared and any active tasks kept. An empty history is a
successful no-op. This works without an AI connection.

Clearing history removes the tracked entries, latest-job reference and their chat
progress/report cards. It preserves ordinary messages, GitHub issues, pull
requests and execution authorizations. Persisted task-ID tombstones prevent
repository refresh or older local records from restoring cleared history. They
also travel through the existing encrypted vault to suppress old synced cards.
No existing storage keys or formats are renamed.

`Add a clear tasks button`, `Fix task deletion`, and `Delete the old tasks API`
are source changes and still produce development PRs. Questions, plans, negations,
quotes and attachments do not authorize history changes. Unresolved app operations
and unavailable remote issue operations explain the missing target or supported
controls; they never fall back to implementing a feature.

The shared intent guard classifies supported operations before the browser's task
planner. Explicit task controls and planner-outage fallbacks cannot convert them
to development. The Worker independently rejects operations at `/authorize` and
`/jobs`, and returns `isTask: false` from `/plan`, including for older clients.
There is no new privileged backend mutation endpoint. Future operational handlers
should follow this pattern rather than adding exceptions to PR/test safeguards.

## PR #200 items 1 and 2

The shared intent guard now exports `KappaCapabilities` (also available as
`KappaIntent.capabilities`), imported by the Worker as `capabilityRegistry`.
Every registered entry declares a stable ID, target, parameter schema, execution
location, authorization, effects, verification and undo availability:

| ID | Scope | Parameters |
| --- | --- | --- |
| `tasks.clear-history` | Local inactive history and existing encrypted sync | `status` enum |
| `tasks.retry` | Recovery of an existing owner task | Positive integer `task` |
| `tasks.cancel` | Existing device-held task authorization | Positive integer `task` |
| `chats.rename` | An explicitly selected conversation | `chat` ID and bounded `title` |
| `settings.update` | Ordinary preferences only | Allowlisted `key` and validated `value` |

Ordinary settings are appearance, response language, weather units and default
weather city. Credentials, authentication, permissions and provider spending
settings are outside this registry. Existing UI controls for other settings keep
their existing policies. Chat and the corresponding UI controls call
`executeAppCapability`; the registry validates immediately before invoking the
handler. Model suggestions must pass `validateProposal`, matching the immutable
user request and resolved target. Models cannot invent missing parameters or
turn source changes into data operations.

Cleanup recognizes “delete every old task”, “delete old tasks please”, “clear out
old tasks” and “clean up old tasks”. An incomplete request such as “change
settings” receives an `unresolved-operation` result, rather than a coding fallback.
Mixed app/data and software requests are split into immutable scoped actions; source-only requirements remain one software task.

“Retry task #198” uses the existing authorization and recovery transport.
“Cancel task #198” requires this device's existing cancellation authorization;
the reply reports revocation rather than claiming the runner has terminated.
Bulk cancellation and remote GitHub issue closure remain unsupported in chat.
“Rename this chat to Work” and the conversation Rename control share a handler.
“Set theme to light” and the appearance control share the same validated handler.

`requestLimits` extracts no-PR, no-tests, no-code and no-merge restrictions from
the direct owner brief, excluding examples, quoted material and attachments.
Compatible local operations execute normally. Incompatible software workflows
stop before planning/job writes and explain the conflict. No-merge limits allow
development but disable automatic merging. Restrictions are carried in saved-task
provenance, retained during renewal and checked again by the Python execution
scope on reload/recovery. A retry cannot silently add new restrictions to an
older task's execution scope; it reports that conflict before dispatch.

Sections 3–4 add Undo, versioned restoration/retry records, history filters and
explicit workflow/authorization/verification decisions. See [Task history and
recovery](task-management.md) for retention, exact action semantics and cancellation
evidence limits. Sections 5–6 implement scoped multi-action requests, focused clarification and local
routing evidence, plus bounded coding-context recovery. Items 7–8 add durable operation receipts, compensation, semantic capability negotiation and rollout controls; see [Operation protocol](operation-protocol.md). Recommendation 9 remains deferred.

Regression coverage: `node --test tests/capability-registry.test.mjs
tests/task-management.test.mjs tests/task-autostart.test.mjs
tests/intent-guard.test.mjs`. `npm run test:web` exercises the real composer and
shared UI controls in Chromium and mobile WebKit without calling coding/model
APIs for app operations.

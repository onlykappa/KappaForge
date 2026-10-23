# Task operations and development

Requests to operate on existing task history must run in the app, without calling
the development planner, creating a task issue or PR, or dispatching sandbox tests.
Requests to change how the software works still use the development workflow and
its existing validation requirements. This distinction is about the target of the
request, not its length or apparent difficulty.

For example, `please delete all old tasks in kappaforge` clears inactive task
history immediately, including failed or blocked attempts. `Clear failed tasks`
only clears failures; `Archive completed tasks` only clears successful history.
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
quotes and attachments do not authorize history changes. Cancellation or remote
issue operations without a matching chat handler explain the supported controls;
they never fall back to implementing a feature.

The shared intent guard classifies supported operations before the browser's task
planner. Explicit task controls and planner-outage fallbacks cannot convert them
to development. The Worker independently rejects operations at `/authorize` and
`/jobs`, and returns `isTask: false` from `/plan`, including for older clients.
There is no new privileged backend mutation endpoint. Future operational handlers
should follow this pattern rather than adding exceptions to PR/test safeguards.

Regression coverage: `node --test tests/task-management.test.mjs
tests/task-autostart.test.mjs tests/intent-guard.test.mjs`.

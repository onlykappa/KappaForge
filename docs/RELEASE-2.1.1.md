# KappaForge Web 2.1.1

- Removed the mobile bottom tabs. The sidebar provides navigation; the composer now sits above the iPhone bottom safe area.
- Job submission no longer adds a chat reply. Existing automatic submission replies are hidden without deleting stored history.
- Audit batches appear as findings in the originating chat, clearly labeled partial. Final audits, project maps, read-only reports, draft PR results, and execution failures are recognized using actual agent report formats.
- Multiple tasks remain tracked when a new one starts. Delivery is persisted and deduplicated after reload, and refreshing resumes when the website returns to the foreground.
- Tracking errors show a report link with automatic backoff. Agent workflow failures post a diagnostic report for explicitly launched owner-authorized tasks.

Regression coverage includes real UI dispatch to fixture APIs, partial/final reports on open GitHub issues, multiple conversations, failures, no submission messages, reload deduplication, sidebar navigation, responsive layout and accessibility. No paid AI calls or native builds are part of this release. Physical iPhone keyboard and Home Screen behavior remain unverified on hardware. Audits still run in batches; partial coverage is never presented as a completed audit.

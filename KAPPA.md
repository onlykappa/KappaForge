# KappaForge project instructions

KappaForge's Develop agent reads this file before every change to this repository. Any of your projects can have one (`KAPPA.md`, `AGENTS.md` or `CLAUDE.md` at the repository root); copy this layout.

Test command: python -m unittest discover -s tests && node --test tests/intelligence.test.mjs chat-backend/vector-index.test.mjs && python scripts/check-web.py

## What lives where
- `preview/` is the web app. `index.html` is only the page layout; the app's code is in `app-state.js` (saved data, repositories, memory, vault), `app-dashboard.js` (GitHub, dashboard, review cards, main `render()`), `app-tasks.js` (task tracking and the task sheet) and `app-main.js` (attachments, sending messages, startup), plus `settings.js`, `ui.js`, `core.js`, `markdown.js` and `stream.js`. They are classic scripts sharing globals and load in the order listed in `index.html`; a function called while a file loads must be defined in that file or an earlier one. After changing it, the same files are copied to `ios/KappaForge/Web/` by `python scripts/bundle-web.py`; edit only `preview/`. The Develop agent copies each changed `preview/` file to `ios/KappaForge/Web/` automatically; never edit the iOS copies directly.
- `chat-backend/src/` is the Cloudflare Worker (chat, tasks, review and merge).
- `engine/` is the Python agent that runs in GitHub Actions.
- `config/app.json` holds the version and app identity; generated files come from `python scripts/configure.py`.

## Where code runs (think about this before designing)
- The Worker runs on Cloudflare servers: it does not know the owner's timezone, location, device or app settings. Anything about the user must be sent by the app with each request.
- The app runs on the owner's iPhone inside the native shell (`ios/`); there is no website any more. Changes reach the phone through a new app release, which is published automatically after each merge to main.
- The agent runs in GitHub Actions with no access to the phone or the Worker's live state.

## Lessons from earlier changes
- A feature must work for every message or request, not just the first one in a chat.
- Respect existing limits (message length caps, token budgets): add to text after validation without pushing it over the cap.
- Every code change needs a test of the new behaviour itself, one that would fail without the change.

## Conventions
- Match the surrounding style: the web app and Worker use compact one-line JavaScript; keep it that way rather than reformatting.
- No new dependencies or build steps without saying so in the summary.
- User data (chats, memory, the vault) must stay backward compatible: never rename storage keys or change the vault format.
- Every user-visible error should say what to do next.

## Safe-Edit Protocol for Core Engine Files
- Scope: Files in engine/ are critical to agent stability.
-Mandatory Validation: Before any change to engine/ is committed, the agent must run python engine/validate_change.py. This script executes the core test suite and verifies that the agent's ability to communicate and execute tasks remains intact.
-Atomic Execution: Changes to engine/ must be applied in a dedicated branch (engine-fix/) and accompanied by a passing test log.
-Emergency Rollback: If a change to engine/ results in a test failure or agent instability, the agent must immediately revert the local branch to the last known good commit and report the failure to the owner.
-Human Review: All changes to engine/ require a manual review and merge by the owner; the agent is prohibited from self-merging any PR that modifies core engine logic.
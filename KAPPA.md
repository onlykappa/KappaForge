# KappaForge project instructions

KappaForge's Develop agent reads this file before every change to this repository. Any of your projects can have one (`KAPPA.md`, `AGENTS.md` or `CLAUDE.md` at the repository root); copy this layout.

Test command: python -m unittest discover -s tests && node --test tests/intelligence.test.mjs chat-backend/vector-index.test.mjs && python scripts/check-web.py

## What lives where
- `preview/` is the web app. `index.html` is only the page layout; the app's code is in `app-state.js` (saved data, repositories, memory, vault), `app-dashboard.js` (GitHub, dashboard, review cards, main `render()`), `app-tasks.js` (task tracking and the task sheet) and `app-main.js` (attachments, sending messages, startup), plus `settings.js`, `ui.js`, `core.js`, `markdown.js` and `stream.js`. They are classic scripts sharing globals and load in the order listed in `index.html`; a function called while a file loads must be defined in that file or an earlier one. After changing it, the same files are copied to `ios/KappaForge/Web/` by `python scripts/bundle-web.py`; edit only `preview/`. The Develop agent copies each changed `preview/` file to `ios/KappaForge/Web/` automatically; never edit the iOS copies directly.
- `chat-backend/src/` is the Cloudflare Worker (chat, tasks, review and merge).
- `engine/` is the Python agent that runs in GitHub Actions.
- `config/app.json` holds the version and app identity; generated files come from `python scripts/configure.py`.

## Conventions
- Match the surrounding style: the web app and Worker use compact one-line JavaScript; keep it that way rather than reformatting.
- No new dependencies or build steps without saying so in the summary.
- User data (chats, memory, the vault) must stay backward compatible: never rename storage keys or change the vault format.
- Every user-visible error should say what to do next.

## Do not touch
- Authentication, the access token check, CORS, and anything that decides who may merge or what gets deployed.
- Workflows, secrets handling, and the provider list (these are locked for the agent anyway).

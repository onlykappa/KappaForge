# Architecture Inventory (Checkpoint 3.1b)

**Inspected main SHA:** `42272f41b30b7d59b5b891ad083f6fccb321c46f`

All links below point to the exact commit in the repository.

---

## 1. Web UI (Browser)
- **Entry point:** `preview/app-dashboard.js`
- **Responsibility:** Boots the web application, initializes UI state, and loads core modules (`preview/ui.js`, `preview/app-tasks.js`). Handles routing and user interactions.
- **Link:** https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/preview/app-dashboard.js

---

## 2. Native iOS Shell
- **Entry point:** `ios/KappaForge/KappaForgeApp.swift`
- **Responsibility:** Provides the native iOS container that hosts the web UI via a WebView, bridges native APIs, and manages app lifecycle on iOS devices.
- **Link:** https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/ios/KappaForge/KappaForgeApp.swift

---

## 3. Cloudflare Worker (Edge)
- **Entry point:** `chat-backend/src/index.js`
- **Responsibility:** Exposes the HTTP request handler for the backend, routes API calls, performs liveness probes, and interacts with GitHub for PR management.
- **Link:** https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/chat-backend/src/index.js

---

## 4. Python Agent (Server)
- **Entry point:** `engine/runner.py`
- **Responsibility:** CLI driver that orchestrates task execution, loads task definitions, and coordinates with `engine/execution.py` and `engine/task_state.py` for state management.
- **Link:** https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/engine/runner.py

---

## 5. Configuration
- **Primary config file:** `preview/settings.js`
- **Additional config:** Various `.kappaforge/*` files store owner preferences and persistent settings.
- **Responsibility:** Holds runtime settings for the web UI and global preferences used by the system.
- **Links:**
  - https://github.com/onlykappa/KappaForge/blob/42272f41b30b7d59b5b891ad083f6fccb321c46f/preview/settings.js
  - https://github.com/onlykappa/KappaForge/tree/42272f41b30b7d59b5b891ad083f6fccb321c46f/.kappaforge

---

## 6. Continuous Integration (CI)
- **Location:** `.github/workflows/`
- **Responsibility:** Defines GitHub Actions workflows for testing, linting, and deployment of the Cloudflare Worker and other components.
- **Uncertainty:** The exact workflow filenames were not enumerated during inspection; they exist under the directory but were not listed explicitly.
- **Link (directory):** https://github.com/onlykappa/KappaForge/tree/42272f41b30b7d59b5b891ad083f6fccb321c46f/.github/workflows

---

### Source Inspection vs. Test Execution
- The above information is derived from static source inspection of the repository at the specified SHA.
- No runtime tests were executed for this documentation; any test‑related behavior is outside the scope of this checkpoint.

### Open Items / Uncertainties
- Exact list of CI workflow files (names and contents) was not captured; reviewer may verify the `.github/workflows` directory for completeness.
- Native iOS entry point is identified, but deeper runtime responsibilities beyond the WebView container are not fully explored.

# KappaForge

> **The iPhone app is now the only interface.** The GitHub Pages website is retired: it is no longer built or deployed, and browser regression tests no longer run. The app's screens live in `preview/` and are bundled into the IPA (`ios/KappaForge/Web/`); the Cloudflare chat backend is unchanged.

A $0-first GitHub Actions AI development assistant controlled from iPad/GitHub.

## Current capability (v0.1)
- Manual and six-hour scheduled task checks.
- Only processes explicitly submitted issues in **this** repository bearing the `kappa-task` label.
- Read-only code inspection for allowlisted public GitHub repositories.
- Gemini model fallback, without paid API fallback.
- Posts findings, suggested code changes, and test suggestions as comments on the task issue.
- **Never pushes to OmniPC, APK Revival, or any target repository. Never auto-merges code.**

## Setup

1. In this repository, open **Settings > Secrets and variables > Actions** and create a secret called `GEMINI_API_KEY` for a free-tier eligible key from [Google AI Studio](https://aistudio.google.com/apikey). Verify your account's applicable free tier before enabling.
2. Open **Issues > New issue** in KappaForge. Describe the task and include an exact `Repository: onlykappa/OmniPC`, `Repository: onlykappa/Apk-revival` or `Repository: onlykappa/KappaForge` line.
3. Add the `kappa-task` label to authorize the task. If that label doesn't exist, create it under **Issues > Labels**.
4. Open **Actions > KappaForge agent > Run workflow**, optionally enter the issue number. It also checks labeled issues automatically every six hours.
5. Read its response on the KappaForge issue. Remove the label to stop further runs.

## Safety and cost

This initial release **does not autonomously commit generated code**, does not create target-repository PRs, and does not have a live web dashboard. Its output is a code-analysis and patch proposal inside KappaForge Issues. The next milestone can add isolated worktree coding and PRs with explicit opt-in. Public Actions runners are normally free under GitHub's published terms; model API free quotas and availability can change. The workflow does not configure a paid fallback.

Tasks are limited to repositories in `config/repositories.json`; retrieved source files and issue text are untrusted and may not override access rules. GitHub token permissions are scoped to reading contents and writing issue comments in KappaForge. For security, do not put secrets into task issues.

## Coding sandbox (v0.2 preview)

KappaForge can generate **actual code** in **KappaForge only**, within `projects/`, `tests/projects/`, or `docs/generated/`. Code generation requires a manually dispatched workflow and an issue created by `onlykappa` with the `kappa-task` label and exactly:

```text
Repository: onlykappa/KappaForge
Mode: code

Build a small Python CLI to organize local notes, including tests.
```

Open **Actions > KappaForge agent > Run workflow**, enter the issue number, and run on `main`. A fresh `kappa/issue-N` branch is created with generated files and a **draft PR**; no automatic merge. If the branch already exists, the runner will refuse to overwrite it.

**GitHub setting required:** In **Settings > Actions > General > Workflow permissions**, select **Allow GitHub Actions to create and approve pull requests** if available. Otherwise GitHub will reject automatic draft PR creation, while the generated branch remains as a checkpoint.

For validation open **Actions > Sandbox branch tests > Run workflow** and enter the exact `kappa/issue-N` branch. This separate workflow runs without `GEMINI_API_KEY` and with read-only repository permissions. PRs created by GitHub Actions' built-in token don't normally trigger push/PR workflows, so validation is intentionally dispatched separately.

Limitations: This is the *first* real coding milestone. It accepts bounded code generation, not multi-session autonomous repair loops; model output may fail JSON validation, and generated code has not been proven correct until separately tested and reviewed. Other repositories remain read-only. Jules is not integrated into this runner yet.

## Owner-approved Self-Repair (experimental)

KappaForge can propose repairs to **its own** limited source files, even when the chat assistant is unavailable. Open KappaForge Chat, enter a task, select **Make a Task**, repository **KappaForge**, and mode **repair**. The request must contain an exact `Repair files:` line with one or two paths chosen from:

- `chat-backend/src/index.js`
- `engine/runner.py`
- `engine/coder.py`
- `engine/full_reader.py`
- `engine/handoff.py`

Example:

```text
Investigate and propose a minimal fix for the GitHub job launcher error.
Repair files: chat-backend/src/index.js
Do not weaken authentication, authorization, or production safeguards.
```

The owner explicitly approves the task. The agent reads the named source, asks Gemini for a bounded replacement, validates allowed paths, creates a **new repair branch and draft pull request**, and posts its link to the issue. It never auto-merges, approves itself, or deploys the repair. Review the diff and run independent tests before merging. The self-repair agent has no permission to change CI workflows, secrets, deployment configurations, or other repositories. It may fail on oversized files, model-output limits, or cases where the necessary repair spans unauthorized files. Repairs are not guaranteed correct.

**Recovery if Chat is down:** Create a GitHub issue in KappaForge manually with `Repository: onlykappa/KappaForge`, `Mode: repair`, and `Repair files: <allowed path>`, label it `kappa-task`, then manually dispatch **Actions → KappaForge agent → Run workflow** with that issue number. The scheduled six-hour run does not apply repairs; explicit launch is required.

## Continuous agent and failure watch (experimental)

KappaForge Chat now accepts **continuous** and **watch** task modes, each requiring an explicit **Approve & Launch** by the owner. Both operate on KappaForge's existing owner-authored `kappa-task` issues. Neither may auto-merge, change production, or access secrets through the model.

- **Mode: continuous**: Resume a read-only repository audit with up to three bounded file batches per GitHub Actions run, storing each checkpoint and findings in issue comments. A completion marker prevents repeat processing. This is a resumable audit workflow, **not yet an unattended code-edit-and-test loop**.
- **Mode: watch**: Inspect the latest 12 GitHub Actions runs for failed, allowlisted workflows on `main`, deduplicate reports by run ID, and post preliminary diagnostic advice on the approved issue. Failure reports **do not** establish a root cause, and repair branches are not created without a separate approved `repair` task.
- **Schedule**: `.github/workflows/continuous.yml` runs every six hours and finds one approved watch issue and one incomplete continuous issue per pass. GitHub schedule timing can be delayed. Manual dispatch can target a particular issue at any time.

Example continuous task:
```text
Repository: onlykappa/KappaForge
Mode: continuous

Inspect the repository in checkpoints, identify verifiable bugs,
and continue the read-only audit across scheduled runs.
```

Example failure-watch task:
```text
Repository: onlykappa/KappaForge
Mode: watch

Track GitHub Actions workflow failures on main, report new failures
to this issue, and suggest targeted investigations. Do not edit code.
```

For live results, open the authorized issue's comments or Dashboard's workflow feed. Stop continuous work by closing the issue or removing the `kappa-task` label. To change code, submit a separate explicit owner-approved `repair` or sandbox `code` task and review its draft PR. GitHub token renewal is not yet automatic.

### Just ask in chat

Tell KappaForge what you want, the way you'd tell a person: "add live date and time to chat", "fix the broken refresh button in OmniPC". When a message asks for work, the AI says what it will do and the task starts on its own (it shows *Task requested*, then progress, the PR, fixes and the merge arrive in the same chat). If the request is unclear it asks you one question first. Ask "did the tests pass?" or "what are you working on?" and it answers from live GitHub data. When a task says **KappaForge needs your help**, just reply in chat; your answer is sent to the task as guidance and a new fix starts. Prefer to approve each task first? Turn off **Settings → AI Models → Tasks**. Everything is still a draft PR; nothing merges until you tap Merge.

### Develop mode: real code changes as draft PRs

Use KappaForge Chat **Make a task**, choose mode **develop**, and describe the feature or fix. After you approve, the agent:

1. Lists the target repository and asks Gemini which files it needs (any file path you name in the task is always read). If the change is too big to make at once, it also plans 2–5 ordered stages; each stage is built on top of the previous ones and they arrive together as one PR.
2. Reads the files it needs from the default branch and asks for precise find/replace edits or new files. When Gemini answers, it reads up to 30 files (files up to 200,000 characters are shown whole, about 600,000 characters in all) and may change up to 20. If Gemini is busy or out of quota, the change is re-planned at sizes every free fallback provider can handle: 12 files read, 8 changed, files over 60,000 characters shown as relevant excerpts.
3. Rejects edits that don't match exactly once, overwrite files it never read, or touch protected paths (`.github/`, the agent's own guardrail files, `wrangler.toml`, lockfiles, `.env` files). Python, JSON and JavaScript are syntax-checked (parsed only, never run); invalid output is retried up to three times with the rejection reason.
4. Commits everything as one commit on a fresh `kappa/dev-N` branch and opens a **draft PR**. The default branch is never written. KappaForge PRs get the sandbox tests dispatched automatically.

### Working on your other projects

- **Project instructions:** put a `KAPPA.md` (or `AGENTS.md` / `CLAUDE.md`) at a repository's root with its conventions, what not to touch, and a `Test command:` line. Develop reads it before every change. See this repository's `KAPPA.md` for the layout.
- **Tests for any project:** development PRs in other repositories are tested by KappaForge's **Project tests** workflow. One job downloads the exact commit with your token; a second job, with no token and no secrets, runs the `Test command:` from `KAPPA.md`, or detects `npm test`, `pytest`/`unittest`, `go test` or `cargo test`. The review card shows the result, offers **Run tests** and **Fix it**, and warns when a project has no tests. If KappaForge hasn't tested a commit, the card falls back to the project's own GitHub checks.

### Privacy, limits and notifications

- **Which providers may see your code.** Gemini is always used first. When Gemini is busy, source code (Develop, Fix it, audits, analysis) may go to **every** free fallback provider, for public and private repositories alike, for maximum uptime. Some of them, especially the keyless ones (Kilo, LLM7, OVH), may log prompts. To narrow this, set GitHub Actions *variables* (Settings → Secrets and variables → Actions → Variables): `KAPPA_CODE_PROVIDERS` and `KAPPA_PRIVATE_CODE_PROVIDERS`, comma-separated provider ids such as `groq,cerebras`. Chat has its own per-device switches under Settings → Models.
- **Using every model your accounts offer (opt-in, may cost money).** By default each provider only routes its reviewed free models, at most two per provider. List provider ids in `KAPPA_ALL_MODEL_PROVIDERS` (for example `gemini,mistral,nvidia,ollama`, or `*` for every enabled provider; `*` leaves free-model gateways such as OpenRouter and Kilo on their free models, so name them to include their paid models) to route every chat model those accounts list instead, including paid ones; billing then follows each provider's own account settings. Set it as a Worker variable for chat and the coding gateway, and as a GitHub Actions variable for the direct coding runner. Provider, channel and private-code permissions still apply. Each request tries each model at most once and at most 64 routes in total (`maxRouteAttempts` in `config/providers.json`), and stops trying a provider after it rejects the key (HTTP 401). A model that rejects requests (HTTP 400/402/403/404/422, where 402 is a paid model without credits) is rested on its own; after two such failures in a row it is skipped for six hours. For Workers AI, also set the Worker variable `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` secret with Workers AI Read permission; without them the two built-in Workers AI models are used.
- **Other repositories' secrets.** A pushed branch runs that repository's own GitHub checks with its secrets. Before pushing anything to another repository, KappaForge stops if the change reads secrets or environment variables, touches login code, runs programs, or contacts a web address, and tells you why. To allow an intended change, add `Allow flagged changes: yes` to the task issue and comment `/audit-code`.
- **Daily cap.** At most 100 agent runs (tasks plus Fix it) per UTC day, so a burst can't use up every free quota. Set the Worker variable `DAILY_TASK_LIMIT` to change it (`0` removes the cap).
- **Discord.** Merges, closes and Undo are announced through the webhook connected in the app. For PR ready, fix ready, stopped changes, test results and failures, also add the same webhook URL as the Actions secret `DISCORD_WEBHOOK_URL`.

### Free fallback AI providers

Gemini is tried first. When it is busy or out of free quota, chat, task planning and the coding agent move on to free providers listed in `config/providers.json`, in this order: Cloudflare Workers AI (built in, no key, chat only), Ollama Cloud, NVIDIA NIM, Kilo Code's free pool, UnoRouter, Mistral, Groq, OpenRouter free models, Requesty, Z AI, Cerebras, ModelScope, SiliconFlow and Hugging Face, each only when its key is configured (Kilo needs none); then the keyless safety net of LLM7.io and OVHcloud AI Endpoints. The coding agent (2.2.8) asks the providers marked `strong` first (the best free coding models: DeepSeek V4 Pro and Kimi K3 on Ollama Cloud, Nemotron 3 Ultra on NVIDIA and Kilo), then full-size Gemini Flash, then Gemini Flash-Lite, then the rest, switching down the list mid-task whenever a model is rate-limited, down or keeps giving bad answers; each provider only receives prompts that fit its `context` window and answers up to its `maxOutput`. Models are discovered live from each provider; nothing is assumed from published lists, which change often. Z AI is pinned to its free `glm-4.7-flash` because the same key also reaches paid models. File and image attachments always use Gemini. ModelScope and SiliconFlow are hosted in China and marked `"privateCode": false`: they never receive code from a private repository unless you add them to `KAPPA_PRIVATE_CODE_PROVIDERS` yourself. Hugging Face is pinned to two small models because free accounts only get about $0.10 of credit a month; when it runs out the router rests the model (HTTP 402) and moves on. It forwards prompts to third-party hosts, so it is marked the same way. The provider list follows [awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis).

**When every model is out of quota.** A development task never just gives up on a rate limit. Validated stages are saved on the draft PR as they finish, and the task's **PROGRESS.md** (a bot comment on the task issue, edited in place) records the plan with each step ticked off, the files changed, the models used and why the run paused. The task then waits for the provider cooldown and resumes automatically on the next recovery scan; the resumed run reads PROGRESS.md and the saved branch and continues from the first unfinished step with whichever model is free. Waiting out a provider limit or outage has its own allowance of 12 automatic resumes, separate from the 3 allowed for other failures, and each wait is still capped by the project's `maxWaitSeconds` (6 hours) and the task's authorization expiry. PROGRESS.md stays on the issue, so it never ends up in your code.

**Keeping up with the free list.** **Actions → Free LLM list drift** runs every Monday. It compares `config/providers.json` with [awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) and opens (or updates) one `free-llm-drift` issue when a provider KappaForge doesn't use appears or a pinned free model drops off the list. It needs no keys and never edits the config.

To see which models really answer, run **Actions → Check AI providers → Run workflow**: it sends every model the agent would use one tiny request (a few words of free quota each) and lists the result in the run's summary.

To add a provider, create a key at its site and save it under the same name in **both** places: the Cloudflare Worker (Settings → Variables and Secrets, type Secret) for chat, and GitHub Actions secrets for the coding agent. These free-tier keys do not expire unless you revoke them, so each one is set once. Never put a key in a link, issue or chat: anyone holding it can spend your quota.

| Provider | Key name | Get a key |
|---|---|---|
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys |
| Cerebras | `CEREBRAS_API_KEY` | https://cloud.cerebras.ai |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys |
| Mistral | `MISTRAL_API_KEY` | https://console.mistral.ai/api-keys |
| NVIDIA NIM | `NVIDIA_API_KEY` | https://build.nvidia.com |
| UnoRouter (free models) | `UNOROUTER_API_KEY` | https://unorouter.com |
| Requesty (free models) | `REQUESTY_API_KEY` | https://www.requesty.ai/free-models |
| Ollama Cloud | `OLLAMA_API_KEY` | https://ollama.com/settings/keys |
| Z AI | `ZAI_API_KEY` | https://z.ai/manage-apikey/apikey-list |
| ModelScope (free Qwen3.5, China-hosted) | `MODELSCOPE_API_KEY` | https://modelscope.cn/my/myaccesstoken |
| SiliconFlow (free Qwen3-8B, China-hosted) | `SILICONFLOW_API_KEY` | https://cloud.siliconflow.cn/account/ak |
| Hugging Face (about $0.10 free credit a month) | `HUGGINGFACE_API_KEY` | https://huggingface.co/settings/tokens |
| LLM7.io (optional, raises limits) | `LLM7_API_KEY` | https://token.llm7.io |
| Kilo Code (optional, raises limits) | `KILO_API_KEY` | https://app.kilo.ai |
| OVHcloud | none | works without a key |

**Settings → Models** shows which providers are configured and their models, links to each missing key's signup page, lets you pick a specific `provider:model`, and has a per-device switch to stop prompts going to any provider. Some free tiers log prompts or use them to improve their models (Kilo's free pool may route to such providers, and its NVIDIA models are logged); switch those off for private code. The coding agent in GitHub Actions does not read that per-device switch, so it will use the keyless providers when every keyed route is exhausted.

**Reviewing and merging from the app.** Each development PR appears under **Code reviews & approvals** on the Dashboard. **Review & merge** shows the agent's plain-English *What this does* summary (also posted in your chat), the changed files and the test result for the PR's latest commit:

- **Merge** appears only when the tests passed on that exact commit. The Worker re-checks this, refuses if the PR changed since you opened the card, and only merges `kappa/dev-N` agent branches. KappaForge merges redeploy the app and Worker.
- **Tests fix themselves.** When the sandbox tests fail on a development PR, KappaForge starts **Fix it** automatically: it reads the failed test output, pushes a fix to the same PR, explains it under *Latest fix* and re-runs the tests, up to three times. Discord says "Tests passed, Merge is ready" only once they pass. If they still fail, it stops and posts **KappaForge needs your help** on the task with what is failing; reply with a comment starting `Guidance:` and tap **Fix it**, and each guidance comment allows one more attempt. You can still tap **Fix it** yourself at any time. Nothing merges until you tap Merge.

The Worker's `GITHUB_JOB_TOKEN` needs **Contents** and **Pull requests** read/write for Merge. Sandbox tests run the Python and Worker suites and the web syntax and bundle checks against the exact commit.

Every repository owned by `onlykappa` is in scope, including ones created later: the app loads the list from the Worker (most recently pushed first, archived repositories hidden) and the agent accepts any `onlykappa/<name>` target. Repair, sandbox code and continuous modes stay limited to KappaForge.

KappaForge itself works with the built-in Actions token. To develop in any other repository, add an Actions secret named `KAPPA_CODER_TOKEN`: a fine-grained token with **Contents** and **Pull requests** read/write. Choose **All repositories** so new projects are covered automatically. Their own CI then runs on the draft PR.

### Owner-approved continuous coding milestones (experimental)

Use KappaForge Chat **Make a task**, select repository **KappaForge**, mode **continuous-code**, and approve a task containing numbered independent steps. Each invocation prepares at most **one** draft PR for a standalone milestone in KappaForge's isolated `projects/`, `tests/projects/`, or `docs/generated/` sandbox. It dispatches `Sandbox branch tests` separately without AI secrets. The six-hour scheduled workflow resumes later steps; you can also manually rerun the workflow. **Nothing is auto-merged or deployed.**

Example task:
```text
Step 1: Build a standard-library-only Python calculator CLI with unit tests
Step 2: Build a standalone notes organizer CLI with unit tests
Step 3: Build a standalone JSON settings validator CLI with unit tests
```

Each step is intentionally independent, branching from main, and produces a separate draft PR. Steps do not inherit unmerged code from previous steps. Stop future work by removing the `kappa-task` label or closing the issue. Branches without a completed PR require human recovery; the agent will never silently overwrite a partial branch. Unattended processing can be delayed by GitHub scheduling, model quota, and Actions limits. This is bounded asynchronous coding, **not yet a general multi-iteration bug-fixing agent with autonomous test repair**.

## Mobile Control Center and build verification

KappaForge's mobile Dashboard now shows recent agent activity, open draft PRs, review/approval links, test runs and recent Cloudflare/GitHub Pages deployments. It previews short code patches from public KappaForge PRs; full diff and merge controls remain in GitHub. Recent status refreshes while Dashboard is visible, subject to GitHub API limits.

Chat remembers the latest launched issue number in browser storage, reads public issue comments, and shows checkpoint/draft PR updates and a review link.

Sandbox coding checks generated path scope and Python syntax before opening a draft PR and attempts one correction for invalid AI output. It then dispatches independent sandbox tests. **There is not yet an automatic post-test bug-fixing loop.** Failed independent tests require a separate approved task. KappaForge does not auto-merge, approve, or deploy generated PRs.

## Folder and archive import (experimental)

KappaForge Chat has a **Folder** picker for directory trees and a **Files** picker for large artifacts. The initial implementation inventories up to **500 files / 300 MB** locally on the user's device and sends a capped manifest plus a few short text excerpts to Gemini. ZIP-compatible formats (ZIP, APK, JAR, IPA and AAB) can be indexed via their ZIP central directory without executing or extracting binaries. Other binary/archive formats provide metadata only. Direct inline PDF and image limits remain **1 MB each**, three attachments total.

**Important limitations:** This is not a multi-gigabyte cloud upload service, a full recursive archive extractor, or an autonomous reverse-engineering environment. The large artifacts do not leave the browser; the model receives only the curated file manifest/excerpts. Some compressed/ZIP64/encrypted archives cannot be indexed. Full deep analysis of executables, app behavior and large projects requires a separate isolated worker, object storage and user-approved resource budgets. Never execute unknown uploads on the privileged GitHub Actions runner.

## Autonomous sandbox debugging (experimental)

KappaForge now has a **bounded follow-up repair loop** for generated sandbox draft PRs. When an independently dispatched `Sandbox branch tests` workflow fails, the scheduled continuous agent can inspect failed step names and the existing generated source, request a revised implementation, validate safe path scope and Python syntax, and commit a correction to the same draft branch. It dispatches a fresh independent test with the precise branch SHA. Maximum **two repair attempts per PR**. Exact tested SHA checks prevent applying feedback from stale builds, and attempt markers in PR comments prevent duplicate work. The privileged repair agent never executes generated code. It cannot edit workflow files or other repositories, and **never auto-merges or deploys**. Failure details currently use step names, not full test logs; repairs may not succeed.

## Repository project maps (experimental)

A new `project-map` task mode inventories up to 300 text/source paths and inspects up to 20 selected files from one of the three authorized public repositories, extracting Python symbols, imports and other code structure. It posts a report back to the approved GitHub issue. The Chat AI planner can select this mode when asked to understand project architecture. It does **not yet build a searchable index over an entire uploaded archive**, infer runtime behavior, or reverse engineer binaries. The import inventory for browser-uploaded files remains a separate limited feature.

## Compact iPhone Chat and project memory

The mobile Chat interface now uses a smaller header, composer, action controls, chat bubbles, and bottom navigation so conversations occupy more screen space. The attachment and folder controls remain available.

Read-only `project-map` reports now include a bounded, **SHA-qualified architecture memory snapshot** and a comparison with the preceding snapshot on **the same approved issue**. Memory is stored in GitHub issue comments rather than in generated code or privileged secrets. The snapshot records paths, file summaries, symbols, and imports from the project index. It cannot claim to remember details never indexed, and this is not yet cross-project, cross-task semantic memory.

The sandbox debugging engine now passes bounded, structured failed-job and failed-step metadata to Gemini rather than only a list of step names. Full log inspection and verified root-cause identification remain future work; failed-step metadata can be incomplete or misleading. All sandbox path, exact-SHA, retry-cap, review, and no-auto-merge restrictions remain in force.

## Installable iPhone web app, update check (v0.5.0)

KappaForge now includes a web-app manifest, a same-origin SVG icon, and a network-first service worker that **does not cache private chat traffic or bearer credentials**. On iPhone, open KappaForge in Safari, tap Share, then **Add to Home Screen** and choose **Open as Web App** when offered. It launches from an icon in a standalone window, without Safari's tab/navigation chrome. This is a home-screen web app (PWA), **not yet a native iOS binary**.

The top **⇩ Check updates** button fetches `preview/version.json` without browser caching. When the remote version differs from the version bundled in the loaded page, it offers **Apply update and restart**, which reloads the app and checks for a new service worker. The app checks on startup and when returning to the foreground. Deployments must bump **both** `APP_VERSION` in `preview/index.html` and `version` in `preview/version.json` for update prompts to work. It cannot restart the whole iOS process or silently update an App Store app.

## Project memory across tasks

Authorized project-map tasks can find the most recent SHA-verified architecture snapshot in the same task, or in one of the latest 12 authorized owner-authored project-map issues targeting the **same repository**. A new snapshot and bounded added/removed path comparison are then posted in the active task's issue comments. This is a structured memory of scanned files, symbols, and imports, not a full semantic search engine and not a source of unverified historical claims.

## Memory and cross-device encrypted backups (v0.6.0)

The **🧠 Memory** control in the KappaForge Chat header provides four explicit actions: save a remembered fact, review/remove local facts, save an encrypted cloud backup, and restore/merge one on another device.

- Chat histories and manually saved memory notes are kept in browser storage until backed up. The **Save to cloud** action encrypts up to 280 KB of serialized history (up to 60 conversations) with AES-256-GCM using a passphrase-derived PBKDF2 key, then sends only ciphertext to a Cloudflare Durable Object. The server cannot recover the passphrase or read the backup.
- **Restore** uses the same private Worker URL, `CHAT_ACCESS_TOKEN`, and vault passphrase. It decrypts locally and merges chats by conversation ID and recent timestamp, then combines notes without duplicates. It does not silently delete local conversations.
- Backup is **manual** rather than a live per-message sync. Memory notes must currently be added explicitly, and they are inserted as user-provided context on future chat requests. The app does not silently infer or persist personal facts. Do not put passwords or API keys in notes.
- The Worker Durable Object `MEMORY` binding is configured in `chat-backend/wrangler.toml`. The API is guarded by the existing private chat bearer token. Cloud storage holds one owner vault, not independent user accounts. Changing the secret or backend address without migration may block access to older backups. Losing the passphrase makes the ciphertext unrecoverable.
- This is an experimental cloud backup and long-term user-managed note system, not continuous automatic synchronization, a searchable vector database, or a complete native iOS Keychain migration.


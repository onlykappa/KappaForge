# PR-first lifecycle: implementation, audit and live simulations (2026-10-23)

Roadmap item 5 from #207. Owner decision: *a draft PR opens with the goal and plan first, then the code is written on it, then the owner reviews it.*

## What changed

| Area | Change |
| --- | --- |
| `engine/developer.py` `produce_development_pr` | After planning, the plan is saved as the branch's first commit (it changes no files) and the draft PR opens with **Goal**, **Plan** (stages and their files), **Design notes** and a **Status** checklist, before any code. If the draft cannot be opened, the task stops before code generation and the half-made branch is removed. |
| Checkpoints | Stages commit on top of the plan. When the first stage lands, the draft's review record changes from *not started* to *checkpoint saved*, so an interrupted run is repaired, never restarted over existing code. |
| Final update | Keeps the goal and plan above the results and ticks the checklist. It **never** marks the draft ready or merges. |
| `engine/runner.py` resume | A run that stopped after opening the draft but before saving code continues on that draft (only this task's open draft with no file changes); it is never sent to repair. |
| `fix_pull_request` | Commit message and PR note say whether checks failed or only unfinished work was continued (they used to always claim failed tests: the #205 false-premise class). |
| Gateway evidence | Uncoded 503s now record what answered: the Worker's own message, Cloudflare's problem-details error (code, name, title), or for non-JSON pages the content type, size, ray ID and HTML title. Never body text. |
| Worker | The shared request counter's failure carries `routing_state_unavailable` and is logged with its storage status, for coding and chat. |
| `tools/lifecycle_simulation.py` + workflow | Live simulation harness (below). |

## Audit findings (fixed in this PR unless stated)

1. **Authorization and private chat would have been published.** The plan's Goal copied the task issue body, which carries the signed `kappa-authorization` marker, the earlier conversation quoted as background, and control lines. The Goal is now the request alone. Test: `test_the_goal_never_carries_authorization_chat_context_or_control_lines`.
2. **An interrupted run could restart over saved code.** With the PR opened before code, the draft said "not started" until the final update; a crash after a stage landed would have looked like a fresh start. The first stage now updates the record.
3. **Design shown twice** on the final body; now once, under the heading the repair flow already reads.
4. **Repair claimed failed tests that never failed** (commit and PR note); now states the real trigger.
5. **Gateway 503s were unexplainable** (also unresolved in #207): bodies were discarded. Evidence is now recorded (see above).
6. **Harness false green (run 2).** Every scenario failed before any inference (the journal's task re-check needed `GITHUB_TOKEN`) yet the workflow passed. Fixed; a scenario that fails before any model request now fails the run, and a test drives the real gateway client path with only HTTP faked.
7. **Open, not fixed here: gateway reliability under load.** Runs 1, 3 and 4 met 19 HTTP 503s with no provider attempt; run 5 (late evening) met none. Their bodies were JSON without the Worker's `error` field and came with a Retry-After, which matches Cloudflare's own problem-details errors rather than any Worker branch. The Worker reads, parses and rewrites its whole routing state (seven days of request, outcome and lease rows in one Durable Object value) on every request, so CPU per request grows with traffic; a platform resource limit under load fits all observations. The engine now records the Cloudflare error code, so the next occurrence names it. Proposed fix (separate PR): split that state into per-day/per-request keys or SQLite rows so a request touches only what it needs. Chat uses the same counter.
8. **Open, not fixed here: the self-review under-claims finished work.** In run 5 the medium and complex drafts were titled *incomplete* although every hidden test passed: the reviewer's evidence quotes elide lines with `...` or span several lines, so the exact-quote check rejects them (`Requirement evidence does not match executable current source`). This is the safe direction (never over-claims), but it marks correct work unfinished and would send it to repair. Proposed fix: ask the reviewer for one contiguous source line per requirement and accept a quote whose non-elided lines all appear in order in the file; keep the executable-token check.

## Live simulations

Real engine, real gateway inference (production providers), the production recovery journal, simulated GitHub (every write recorded in order; any real GitHub request refused), generated code judged in networkless credential-free Docker containers with the AI's own tests and with **hidden acceptance tests** it never saw. Reference solutions prove the hidden tests are fair (`HiddenAcceptanceTests`).

Scenarios:
- **easy**: add two temperature conversions with absolute-zero validation (Python).
- **medium**: cart subtotal validation, case-insensitive discount codes, rounded tax (JavaScript).
- **complex**: inventory removals, low stock, audit history, CSV quoting, numbered history report, cart discounts and item count (Python + JavaScript), with lifecycle asks ("open a draft first, keep it as a draft, notify me").

| Run | Commit | Scenario | Result | Tokens (gateway-measured) | Own tests | Hidden acceptance | PR rules |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `292876d` | easy | draft PR | 7,192 | Py 6/6 | **Py 4/4** | 8/8 |
| | | medium | gateway 503 (no journal yet) | 22,173 | – | – | 8/8 |
| | | complex | gateway 503 on first call | 0 | – | – | – |
| 2 | `5144045` | all | harness bug: nothing ran (false green) | 0 | – | – | – |
| 3 | `81144b3` | easy | gateway 503 ×4 | 1,344 | – | – | 8/8 |
| | | medium | gateway 503 ×4 | 8,348 | – | – | 8/8 |
| | | complex | **draft PR, 6 files**, resumed once | 89,506 | Py 6/7 (AI's own CSV test wrong), JS pass | **Py + JS all pass** | 8/8 |
| 4 | `357eab0` | easy | **draft PR** | 41,118 | Py 11/11 | **Py 4/4** | 8/8 |
| | | medium | code on draft, then gateway 503 after 3 resumes | 98,857 | JS 16/17 | JS 8/9 (SAVE10 rounding: 895 vs 896) | 8/8 |
| | | complex | 6 files on draft, then gateway 503 after 3 resumes | 68,400 | Py 12/12, JS 5/5 | Py 7/8 (`remove(1.5)` not rejected), JS 5/5 | 8/8 |
| 5 | `a945896` | easy | **draft PR** | 7,677 | Py pass | **Py pass** | 8/8 |
| | | medium | **draft PR** | 58,927 | JS pass | **JS pass** | 8/8 |
| | | complex | **draft PR, 6 files, 3 providers** | 147,774 | Py pass, JS pass | **Py + JS all pass** | 8/8 |

**Gateway-measured tokens across all live runs: 551,316** (runs 1–4: 336,938; run 5: 214,378, with 31 of 31 requests answered). Counts are prompt + output as reported by the providers through the gateway.

**Run 5 verdict: 3/3 scenarios passed every hidden acceptance test, every PR rule held, no gateway failure.**

What the runs establish:
- **Every PR rule held in every scenario that reached GitHub**: the draft opened before any code with no file changes and showed the goal and plan; it stayed a draft; nothing was merged; `main` never moved; no real GitHub request was made.
- KappaForge processed large loads across four providers (Ollama, Mistral, Groq, Gemini), switched models on invalid answers, resumed after gateway failures on the same draft, and repaired interrupted work.
- The hidden tests caught real model mistakes the models' own tests missed (rounding, fractional quantity). The engine's review flagged unfinished requirements honestly (some reviews under-claimed work that the hidden tests then accepted).
- The PR asks in the complex task (open a draft first, keep it a draft, notify me) never became code work (#213) in any run.
- The dominant failure is the gateway under load (finding 7), not the engine or the models; the main quality gap is the reviewer's evidence format (finding 8).

Reproduce: push to the `lifecycle-simulation` branch or run the *Lifecycle simulation* workflow by hand. The full JSON report is the run's artifact.

## Weather cleanup (#117 / #111), included in this PR

#117 was closed because it could not work: an unreachable route, a callback-based `getCurrentPosition` used with `await`, coordinates never sent, units dropped on reload, and a test that only tested a mock. #195 rebuilt weather around typed or saved cities. Three things from #111 were still missing; this PR adds them:

- **Location, asked once and only for weather.** The app asks for one location reading only when a weather question names no city and you have no saved city. It never asks for other messages and never tracks in the background. The reading is rounded to about 1 km, sent only with that message and never saved.
  - iOS uses a native one-shot CoreLocation request (`LocationRequester.swift`); the iOS permission prompt explains why location is needed.
  - Browsers use `navigator.geolocation`, correctly wrapped in a Promise.
  - New setting *Use my location for weather*: **Ask the first time** / **Allowed** / **Off**.
- **Permission denied:** the setting turns **Off**, KappaForge never asks again, and the reply says so and asks for a city; typing the city answers it.
- **Unavailable or timed out:** the reply says so plainly, and it can ask again next time.
- **Which location the Worker uses:** a typed city, then the saved city, then the device location. Bad coordinates are refused before any outside request.
- **Feels like** now appears in current conditions; it is left out when Open-Meteo doesn't send it.
- **Tests** (`tests/weather.test.mjs`, `tests/weather-location.test.mjs`):
  - the coordinates path and which location wins;
  - bad coordinates and the feels-like rules;
  - that the app and the Worker agree on what counts as a weather question;
  - the browser and native location paths (granted, denied, unavailable, timeout);
  - the real chat send handler for granted, denied, "never ask again", unavailable, and non-weather or city questions;
  - the iOS permission declaration and the absence of any background-location API.

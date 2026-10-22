# Task #191: repair the autonomous weather mission

This is the implementation roadmap and evidence for draft PR #195. It is separate
from #194's OpenRouter/premium work. The owner requested implementation on
2026-10-22. Keep this PR a draft. No merge, production deployment, release, paid
inference, old-journal migration or restart of task #191 is included.

## Evidence and root causes

- [Original task, bot progress and failure ledger](https://github.com/onlykappa/KappaForge/issues/191).
- [Incomplete weather checkpoint #192](https://github.com/onlykappa/KappaForge/pull/192),
  candidate `3d9ef29b2125c2976501633bb7f129b9514178b7`.
- [Failed run](https://github.com/onlykappa/KappaForge/actions/runs/39805542149),
  code job `119917745997`, plus the owner's screenshot of repair round 2.
- Baseline main: `677a4f8579204ddce4432062b8eb97363b99b9dc`.

The missing edit anchor contained the literal `/authorization`. Recovery searched
that source excerpt for authorization words and persisted `blocked_authorization`.
A later unread-file error then attempted an invalid transition back to recovering;
terminal reporting masked the original error with another transition exception.
The initial patch fixed individual exceptions. The continuation also preserves
the diagnosis through aggregate generation failures and final checkpoint saves.
Actual permission denials still stop; no state-machine protection is relaxed.

The run announced switching away from Ollama but selected it again: Python's
`skip` list was dropped on the integrated gateway path. Exclusions now cross that
boundary, are validated and applied before route attempts, and returned excluded
routes are rejected. An excluded pinned route stops rather than broadening scope.

The saved weather patch in #192 had duplicate handlers before normal app auth,
no app/tool integration, and an undiscovered test using unimported `test`/`expect`.
The review's blanket claim that the path allowlist made the route unreachable
was inaccurate for those early handlers. The checker now distinguishes missing
allowlist entries, pre-authentication handlers and duplicate handlers.

## Ordered roadmap

- [x] 1. Inspect the screenshot, task, trusted ledger, saved code and workflow logs;
  establish the causal chain before modifying recovery.
- [x] 2. Use typed edit and unread-source failures; retain their meaning through
  aggregate generation errors. Preserve exact uniqueness, read-before-write,
  protected paths, authorization expiry, pinned routes and retry budgets.
- [x] 3. Regress source-bearing authorization words, journal persistence/reload,
  unread-file recovery, aggregate failure and genuine authorization denial.
- [x] 4. Carry rejected-model exclusions through Python and the integrated gateway.
  Test exclusions, all routes excluded, malformed input, pinned route refusal,
  excluded response rejection and the actual gateway/Durable Object path.
- [x] 5. Audit the original requirements against #192 and replace its incomplete
  approach with the authenticated implementation below. Detect pre-auth and
  duplicate routes accurately. Preserve unavailable requirement review as an
  incomplete result and include its redacted diagnostic.
- [x] 6. Implement a callable weather registry, discovery through `/capabilities`,
  and invocation directly from the existing authenticated `/chat` route. No new
  weather HTTP handler is needed. Geocode the explicit city
  before any saved default. Ask for a city when none is known, handle its followup,
  and never assume/request GPS. Save city and units through the actual app settings.
- [x] 7. Add current, hourly and seven-day weather, precipitation probability, wind,
  local timestamps, C/F handling, finite/ranged coordinates, upstream validation,
  cancellation, an 8-second operation timeout, and a bounded 5-minute cache.
  Wire real-module tests into the standard npm suite. Sync the iOS web bundle.
- [x] 8. Preserve original failure, saved candidate and PR in final progress/notes.
  Failure diagnostic writes cannot replace the original error. Show warnings as
  warnings in both snapshots and plain text. Label incomplete draft summaries as
  unverified agent claims rather than claiming successful behavior or testing.
- [x] 9. Run local full suites, independent baseline-derived validation scripts,
  web/bundle checks, dependency-map checks, and a real API test through the exact
  authenticated chat handler. Review new-commit Linux CI before promotion.

## Requirement / implementation / evidence matrix

| Task #191 requirement | Implementation | Evidence |
| --- | --- | --- |
| Discover and invoke a real weather capability | `weatherTools`, `invokeWeatherTool`, authenticated `/capabilities` discovery and `/chat` invocation | `tests/weather.test.mjs`: discovery/auth tests |
| Normal app conversation uses weather data | existing app `/chat` request invokes tool and returns formatted JSON reply | full Worker handler integration tests; live check |
| Explicit city, saved fallback, no assumed GPS | `weatherArguments`, city followup, sanitized `weatherCity` setting | location precedence, missing location and followup tests |
| C/F preference handling | explicit unit wording, saved units, browser locale for auto | sanitizer and request/response unit tests |
| Current conditions, wind and timestamps | validated Open-Meteo current data and local timezone | real-module tests and live Spokane Valley response |
| Hourly/daily forecasts and rain probability | normalized hourly/seven-day series; requested hourly/week/tomorrow formatting | forecast/date/probability assertions |
| Free public API and correct geocoding | fixed Open-Meteo HTTPS origins, no model inference or API key | captured upstream URLs and explicit live check |
| Timeouts, caching and graceful failure | shared 8-second signal, caller cancellation, 64-entry/5-minute cache, validated responses | cache expiry/units/bounds, malformed data, error and cancellation tests |
| Preserve chat, routing, secrets, existing authorization | normal auth/CORS/method checks, existing authenticated chat route, bounded exclusions | full JS/Python suites and negative authorization tests |
| Honest autonomous recovery and progress | typed failures, exclusion propagation, final notes, warning rendering, incomplete-summary labels | `tests/test_task_191.py`, existing recovery and simulated-task suites |
| Independent verification and live proof | ordinary tests plus optional `node tools/check-weather.mjs` | exact results below; production deployment remains pending |

## Reconciliation with #192

This PR implements the weather feature from the trusted main baseline. Do not
merge #192's duplicate unauthenticated handlers or broken test into it. The old
PR stays an incomplete historical checkpoint; this draft supersedes that weather
implementation and preserves its task/run references. Task #191 is not marked
complete or automatically restarted by this PR.

## Validation

The initial classifier regressions fail against the original classifier and pass
with the fix. The continuation exercises actual routing and Worker boundaries,
not a weather implementation written inside a test. Full suite results are
recorded in the PR description after final validation.

The explicit live test `node tools/check-weather.mjs` passed on 2026-10-22 at
16:31:25 UTC through the local authenticated `/chat` handler and real geocoding
and forecast APIs: Spokane Valley, Washington, United States; timezone
America/Los_Angeles; current data timestamp 2026-10-22 09:30 local; 168 hourly
entries and 7 daily entries. The reply used actual temperature/wind data and
included its source and timestamp. No deployed Worker or paid model was called.

The earlier Windows repository-map fixture failure is fixed by using GitHub-style
POSIX paths in its input; its behavioral assertions are unchanged. The optional
real ast-grep tests are skipped locally when the binary is absent; Linux CI
installs the pinned binary. `engine/validate_change.py`, referenced in KAPPA.md,
does not exist at the baseline; no successful run of that missing script is claimed.

## Remaining rollout gates

- [ ] Review all applicable CI results for this PR's final head.
- [ ] Owner approval to merge/deploy; then verify weather in the deployed app.
- [ ] Install/release the updated iOS web bundle if needed for the new settings UI.
- [ ] If task #191 is explicitly resumed later, revalidate current authorization,
  exact task scope and saved candidate. Never blanket-unblock old journals.

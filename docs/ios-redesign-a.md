# iOS redesign, Direction A (Grouped) with the Today task card

## Goal
Make Menu, Dashboard and Chat look and feel like a first-party Apple app, using only the existing
`preview/` HTML, CSS and plain JS (no framework, no new build step), inside WKWebView on iOS 17+.
The native UITextView composer stays as it is.

The owner chose Direction A from the mockups (inset grouped lists, graphite accent, few cards) with one change:
the chat task card uses the Direction B layout (large ring, title, live timer, step list and capsule
buttons), in grey instead of purple.

Mockups: https://claude.ai/artifact/BeNLXnmJe7qwNrNug2GAjK

## Branch
- `feat/ios-redesign-a`, based on `main` after PR #102 was squash-merged (731f0bb). It started on PR #102's
  branch; `main` was merged in (no history rewrite), and the PR now targets `main`.

## Rules
- Phones (max-width 840px) get the new navigation. Wider screens keep the sidebar layout.
- At most 3 glass surfaces per screen (top bar, tab bar or composer, sheet). Content stays solid.
  Under Reduce Transparency every glass surface is a solid fill.
- Apple type ramp in rem against Body 17, so it follows Dynamic Type.
- Graphite accent. Green, orange, red and blue mark state only.
- Spring-like transitions (`cubic-bezier(.32,.72,0,1)`, 350ms). Reduce Motion removes movement.
- Safe areas, the Dynamic Island and the home indicator respected; nothing hidden behind the composer or keyboard.
- No invented features. Test data in fixtures and screenshots is labelled as such.

## Plan and status
Status keys: `[x]` done and tested, `[~]` in progress, `[ ]` not started.

1. [x] **Design layer** `preview/ios.css`, loaded after `design.css`: graphite tokens for dark and light,
   the type ramp, glass rules, `html.rt` solid fallback, Reduce Motion. Neutralises the purple literals in
   `design.css` so the whole app turns grey.
2. [x] **Navigation on phones**: floating tab bar (Chats, Dashboard, Tasks, Reviews, More) in the existing
   `.mobile-nav`; a Chats list page (search, new chat, history) and a More page (Projects, Saved items,
   Settings, Account, Help) replace the slide-in sidebar; an open chat is a pushed view with a back button and
   no tab bar; large titles collapse into the inline title on scroll.
3. [x] **Dashboard**: repository picker (from `/repos`), segmented control Today | Pull requests | Builds.
   - Today: 2-column widgets (running tasks, failing checks, PRs to review, builds today) and grouped lists.
   - Pull requests: last 7 days for the chosen repository. Opened, Merged and closed, and Pushed (commits on
     the default branch), through the existing read-only `/github` proxy. No backend change.
   - Builds: the existing live Actions panels.
4. [x] **Chat task card**: `renderExecutionActivity` and `renderTaskActivity` adopt the Today layout
   (large ring, tag, title, task number and step count, live timer, step list with the current stage bar,
   capsule actions). Every `data-task-*` hook, live region, timer attribute and label stays.
5. [x] **Sheets** with medium and large detents for the repository picker and run details.
6. [~] **Native**: `KappaWebView` reports Reduce Transparency to the page (`html.rt`); composer font 17.
7. [x] Tests for the new navigation, dashboard data shaping and card markup; `scripts/bundle-web.py`;
   check-web; dependency map.
8. [~] Native simulator screenshots from the iOS build CI, compared against the mockups.

### Where it lives
- `preview/ios.css`: tokens, ramp, glass, lists, widgets, sheets, tab bar, the Today task card.
- `preview/app-shell.js`: `SHELL_TAB_OF`, `shellPushed`, `shellBack`, `renderChatList`, `renderMorePage`, `renderTabBar`, `applyShell`.
- `preview/app-dashboard.js`: `dashboardSummary` (picker, segments), `todayView`, `pullsView`, `buildsView`, `iosSheet`, `repoSheet`, `bindDashboard`.
  `agentTasksPanel`, `buildsPanel` and `controlCenter` are unchanged (Builds keeps review, merge and undo).
- `preview/pulls-core.js`: `KappaPulls.activity` (opened, merged, closed, pushed).
- `preview/ui.js`: `heroRing`; `renderExecutionActivity` header; measured progress inside the card.
- Native: `KappaWebView.reduceTransparencySource`, `observeReduceTransparency`; `ProgressFixture` adds `testing` and `ready`;
  `LaunchTests` navigates with Back and the tab bar and captures the redesigned screens.

## Needs the owner's OK (not in this PR)
- Pushes to PR branches (not only the default branch): the `/github` read proxy would need to allow
  `pulls/<n>/commits`.
- Builds and live Actions for repositories other than KappaForge: `/actions` is allow-listed.

## Optional later
- Native Liquid Glass (iOS 26 SDK) for the tab bar and composer.

## Tests performed
Baseline on PR #102 head `a652da0`: `npm test` 187 pass; Python suite 153 OK; check-web and dependency map pass.
All Node test files 298 of 299 (`tests/ui-chat.test.mjs` needs `jsdom`, which was not installed).

After this round (local):
- `npm test` 193 pass (new `tests/ios-redesign.test.mjs`); all Node test files 305 pass (with `jsdom` installed);
- Python suite OK; check-web (bundle and duplicate-global guard) passed; dependency map current;
- `npm run test:web` PASS on desktop and on the mobile pass (390×844). The mobile pass ran on Chromium here;
  CI runs it on WebKit. The mobile steps now navigate with Back, the tab bar and More.
- Browser screenshots of the real app at 393×852 and 440×956, dark and light, with test data: no page errors and
  no horizontal overflow. The simulator fixture's JavaScript was run in the app for all five card states.
- Not run locally: the Swift build and simulator UI tests (no Xcode on Linux). They run in the iOS CI workflow.

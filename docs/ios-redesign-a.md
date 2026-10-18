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
- `feat/ios-redesign-a`, stacked on PR #102 (`feat/pr103-live-task-progress`), because the task card being
  restyled is the one PR #102 introduces. When #102 merges, this PR retargets to `main`.

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

1. [ ] **Design layer** `preview/ios.css`, loaded after `design.css`: graphite tokens for dark and light,
   the type ramp, glass rules, `html.rt` solid fallback, Reduce Motion. Neutralises the purple literals in
   `design.css` so the whole app turns grey.
2. [ ] **Navigation on phones**: floating tab bar (Chats, Dashboard, Tasks, Reviews, More) in the existing
   `.mobile-nav`; a Chats list page (search, new chat, history) and a More page (Projects, Saved items,
   Settings, Account, Help) replace the slide-in sidebar; an open chat is a pushed view with a back button and
   no tab bar; large titles collapse into the inline title on scroll.
3. [ ] **Dashboard**: repository picker (from `/repos`), segmented control Today | Pull requests | Builds.
   - Today: 2-column widgets (running tasks, failing checks, PRs to review, builds today) and grouped lists.
   - Pull requests: last 7 days for the chosen repository. Opened, Merged and closed, and Pushed (commits on
     the default branch), through the existing read-only `/github` proxy. No backend change.
   - Builds: the existing live Actions panels.
4. [ ] **Chat task card**: `renderExecutionActivity` and `renderTaskActivity` adopt the Today layout
   (large ring, tag, title, task number and step count, live timer, step list with the current stage bar,
   capsule actions). Every `data-task-*` hook, live region, timer attribute and label stays.
5. [ ] **Sheets** with medium and large detents for the repository picker and run details.
6. [ ] **Native**: `KappaWebView` reports Reduce Transparency to the page (`html.rt`); composer font 17.
7. [ ] Tests for the new navigation, dashboard data shaping and card markup; `scripts/bundle-web.py`;
   check-web; dependency map.
8. [ ] Native simulator screenshots from the iOS build CI, compared against the mockups.

## Needs the owner's OK (not in this PR)
- Pushes to PR branches (not only the default branch): the `/github` read proxy would need to allow
  `pulls/<n>/commits`.
- Builds and live Actions for repositories other than KappaForge: `/actions` is allow-listed.

## Optional later
- Native Liquid Glass (iOS 26 SDK) for the tab bar and composer.

## Tests performed
Baseline on PR #102 head `a652da0`: `npm test` 187 pass; Python suite 153 OK; check-web and dependency map pass.
All Node test files 298 of 299 (`tests/ui-chat.test.mjs` needs `jsdom`, which is not installed here).

# KappaForge 2.1.0 · OLED & Glass

Web-only release. Native builds and IPA publication remain paused at the owner's request. The shared frontend is staged for later reuse; no iOS build is required for this update.

- A true black default theme with restrained translucent surfaces, violet accents and a complete light appearance. Existing explicit appearance preferences are preserved.
- Compact centered navigation with New Chat on the right. Settings lives under the sidebar profile, alongside Account & Profile and Help & About.
- Search conversation titles and message text. Save or unsave messages through contextual menus, then revisit them in Saved Items. Saved flags remain inside existing chat data and encrypted backups.
- A glass sidebar with close control, backdrop, keyboard focus management, Escape support, edge swipe gestures and conversation shortcuts.
- Compact user bubbles, borderless assistant replies, safe Markdown headings, links, lists, code blocks and scrollable tables. Raw HTML and unsafe URL protocols are never executed.
- Contextual copy, retry, save and explain actions. Retrying preserves the earlier response and resends the preceding text request; file-based requests require reattaching originals.
- A compact expanding glass composer with real file/folder import, saved routing preference, development task planning and a send control. Visual viewport handling moves it above the mobile keyboard and hides the tab bar while necessary.
- Floating glass tabs for Chat, Dashboard, Projects, Tasks and Reviews. Dashboard, Settings, usage charts, dialogs, repository views and diagnostics share the same design tokens.
- Reduced Motion support and opaque fallbacks when blur/transparency is unavailable. No new third-party runtime/CDN dependency is required by the interface.

Validation includes backend/unit regressions, existing Python tests, desktop Chromium and mobile WebKit flows, simulated iPhone safe-area and swipe checks, Markdown security checks, WCAG-tagged axe audits, appearance persistence, responsive layouts, saved items, search, profile, navigation and authenticated chat fixtures.

Physical iPhone Home Screen gestures, keyboard transitions, browser-specific glass compositing and installed native behavior remain unverified on hardware. Browser tests use deterministic provider/GitHub fixtures and make no paid AI calls. All chat keys, vault encryption, authentication, credentials and backend operations remain in place.

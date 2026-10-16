# KappaForge Web 2.1.2

- AI replies stream from Gemini through the authenticated Worker and appear progressively in the existing conversation. Larger buffered chunks are revealed smoothly; Reduced Motion keeps updates immediate as data arrives.
- The send button becomes Stop during generation. Stopping aborts the browser request and provider stream. Partial output is retained with a clear interruption/stopped message, including after reopening the page.
- Final Markdown and contextual actions appear when a reply ends. Streaming updates only the receiving bubble, keeps scroll position when reading earlier messages, and stays attached to its original chat while navigating.
- Existing JSON-only backend responses still work, with progressive display. The client never resends a paid request merely because streaming is unavailable.
- Provider token metadata is recorded once per attempt, including failed or cancelled attempts. Missing tokens/costs remain unavailable. Existing two-attempt routing remains bounded; a partial streamed reply is never automatically replayed on a fallback model.

Validated with provider fixtures for early token delivery, fragmented UTF-8/SSE frames, final usage metadata, cancellation, incomplete responses and JSON fallback. Desktop Chromium and mobile WebKit regression flows cover visible progressive output and Stop. No paid provider call or physical iPhone test is required by this test suite; real-device transport/keyboard behavior remains unverified. Native builds remain paused.

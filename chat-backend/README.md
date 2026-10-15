# KappaForge private live chat backend

KappaForge Pages is public and static. Gemini access MUST run server-side.
This first live-chat backend uses a Cloudflare Worker, separate from the GitHub agent.

## Deploy once

1. Create a free Cloudflare account and open **Workers & Pages**.
2. Create a Worker named `kappaforge-chat` (or any available name).
3. Replace its starter JavaScript with `chat-backend/src/index.js` from this repository. Deploy it.
4. In the Worker's **Settings > Variables and Secrets**, create **encrypted secrets**:
   - `GEMINI_API_KEY`: your Gemini API key. Do not copy it into GitHub Pages or frontend code.
   - `CHAT_ACCESS_TOKEN`: generate a **new**, long, random, unique value of at least 32 characters. Do not reuse your GitHub password or Gemini key. Keep this private.
5. Copy your Worker URL (typically `https://kappaforge-chat.<account>.workers.dev`).
6. Open [KappaForge Preview](https://onlykappa.github.io/KappaForge/), tap **Connect AI**, and enter that URL and the access token.
7. Send a message. The Worker responds using `gemini-2.5-flash-lite` if your API account supports it.

No GitHub Actions workflow secrets are exposed. The iOS SwiftUI native app is not yet connected. This is for the web preview only.

## Security and limitations

- The Worker checks the browser Origin and compares a private access token before using Gemini. Origin checking alone is **not** authentication.
- The frontend holds the token in sessionStorage, which clears when the tab session ends. Messages and chat history remain in localStorage on the device; avoid sensitive content on shared devices.
- The Worker is reachable on the internet, so treat this as a private personal-use prototype rather than a high-security production identity system. Rotate the token if leaked, and use Cloudflare's built-in protections to restrict traffic.
- The backend has no GitHub write privileges. Chat can plan work, but it does **not** independently code, run tests, create issues, or trigger workflows.
- Gemini API quotas and Cloudflare free-tier limits apply. No zero-cost guarantee if your accounts have paid billing enabled.
- Set Cloudflare Worker usage limits / rate limits as needed to protect quota. The Worker bounds each request to 20 messages and short responses but does not enforce per-user rate limits.
- To disconnect: close the tab, or remove `kappaforge.backend` / `kappaforge.access` session keys. To remove saved conversations, clear Safari website data for the preview origin.

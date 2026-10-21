# Gateway and Actions 1.0.0 — acceptance pending

This backend/Actions component release is separate from the iPhone version. Keep its GitHub release draft until the app-started acceptance gate in the Phase 5 checkpoint is observed. When published, use `make_latest=false`; preserve the latest IPA release.

Chat and cloud coding share the provider registry, free-model policy, durable quota reservations, cooldowns and normalized gateway errors. Authorized execution stays in Actions, uses a separate runner credential, and cannot bypass the gateway with provider keys. Existing task authorization, private-code permissions, cancellation, expiry and recovery remain enforced.

An exact current-user `Inference route: groq:openai/gpt-oss-120b` line selects Groq for chat/planning and the coding task with fallback disabled, even when the installed app retains a Gemini preference. No Model manager or new IPA is required. Saved preferences and server permissions remain authoritative.

Review no longer spends another inference call on source already supplied completely. Self-review repair can correct its own new bounded document while retaining denial for pre-existing files. Deployment compares opaque binding fingerprints before/after upload; snapshots/logs contain no secret values.

Production Groq inference passed. The release smoke produced its exact authorized candidate but stopped during self-review and required independent source review. This does not prove autonomous recovery or app-started acceptance. See the [Phase 5 checkpoint](integration/OMNIROUTE-PHASE5-CHECKPOINT.md) for exact evidence and limitations.

OmniRoute's standalone Next.js app, desktop shell, SQLite driver, local credentials and background services remain separate. Unperformed Linux hosting tests remain unverified. No additional hosting provider is required.

# Task #169: gateway request sizing and provider diagnostics

Baseline main: `682201d3f49fcbfaccb80676066307dc58607778` (PR #167).
Branch: `codex/provider-policy-diagnostics`, isolated checkout.
This repair does not execute or implement the weather task, merge its old draft,
rewrite its authorization, reset recovery state, or send provider inference.

## Confirmed failure

Owner-started [task #169](https://github.com/onlykappa/KappaForge/issues/169),
[Actions 39541753519](https://github.com/onlykappa/KappaForge/actions/runs/39541753519),
recorded a successful planning request to `gemini:gemini-3.1-flash-lite`:
36595 prompt characters and 9685 provider-reported tokens. The following generation
request carried 357645 prompt characters and received HTTP 413 without a structured
error code. The authenticated Worker's 200000-byte ingress cap rejected it before
inference routing or a provider reservation. This is a gateway request-size failure;
it does not establish provider capacity, account quota exhaustion, or a cooldown.
The old runner translated it as unclassified failure/provider_outage and stopped.

The supplied task text is 3200 characters before scope-line quoting and ends
mid-sentence at “Inspect the native iOS bridge an”. The owner supplied the same text
again during diagnosis. No missing requirements were invented or silently appended.
An older saved chat message can retain earlier truncation after an app update;
the exact origin of this truncated input has not been independently observed.

## Implementation

- The shared registry records the existing 200000-byte request cap. Limits are
  not increased. Python checks UTF-16 length, JSON escaping/byte size and the
  conservative context estimate before transport.
- Generation selects fewer exact source excerpts using existing source-selection
  and partial-source edit guards. Owner task, repository instructions and recovery
  history are preserved. Review similarly selects bounded source/diff evidence;
  missing evidence remains incomplete. This is no semantic prompt compression.
- Oversized protected instructions fail explicitly before a provider call rather
  than being silently cut. Worker 413 responses carry `request_too_large` and
  gateway_guard/context_limit provenance; recovery distinguishes request sizing
  from provider outage. UTF-8 byte limits are enforced even without Content-Length.
- Capabilities add sanitized eligibility reasons and discovery status. Existing
  callers retain the same `enabled`, `models`, permissions and authentication fields.
- Settings distinguishes intentional exclusions, disabled device choices, missing
  keys, HTTP401 authentication rejection, HTTP403 access denial, cooldown, network
  failure and unverified discovery. An empty model list never establishes bad keys.
  Policy-excluded providers are informational, without a misleading repair card.
  Credential guidance keeps keys in Worker secrets; coding uses the gateway.

## Provider evidence

Owner confirmed the configured providers use free routes and have no card details.
That is owner-supplied account evidence; no billing console or secret value was read.
No plan, credit, payment setting, dashboard variable or provider key is changed.

- **Mistral:** add only `mistral-small-latest`, intersected with discovery and all
  existing free/channel/private-code allowlists. The official [Free-mode quickstart](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
  documents that model and no-card Free access. [JSON mode](https://docs.mistral.ai/studio/conversations/structured-output/json_mode)
  documents the supported response format. Existing account-scoped reservations,
  caps and cooldowns apply. Owner account status is accepted as confirmed free;
  no live inference or account-specific remaining allowance is verified here.
  [Subscription documentation](https://docs.mistral.ai/admin/billing-usage/subscriptions)
  explains that pay-as-you-go can consume prepaid credits after included usage.
  This repair never enables it or authorizes paid usage. An account later switched
  to paid usage must be removed from free permissions.
- **Ollama:** [Free pricing](https://ollama.com/pricing) includes starter usage and a
  smaller starter-model set; purchased credits unlock additional models. Public
  `/api/tags` catalog metadata does not identify this account's starter eligibility.
  Existing preferred models cannot all be declared free from catalog presence.
  Keep excluded pending exact account-eligible starter-model IDs, displaying review
  pending rather than invalid key. No local Ollama installation is required for cloud API.
- **NVIDIA:** [FAQ](https://docs.api.nvidia.com/nim/docs/product) describes free
  prototyping/development access. [API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
  sections 1.2/1.4 restrict production use and describe trial/credit conditions.
  Keep excluded from the general production gateway pending suitable use/access
  evidence. This is an access/usage-policy question, not a claim the key is invalid.
- **OpenRouter:** existing `:free` filtering remains. If absent from owner channel
  allowlists, label policy exclusion. Do not widen dashboard variables automatically.

## Validation and operation

Focused fixtures cover the observed large-source geometry, exact task tail and
guide preservation, bounded review, UTF-8/JSON byte limits, no network on oversized
requests, explicit gateway error provenance, policy exclusions, legacy metadata,
authentication/access/rate-limit distinctions, and Mistral Small JSON-only selection.
No inference, weather dispatch or state reset is part of validation.

Full Linux/browser/native CI passed before promotion. Windows checks retain
the previously documented parser CRLF and temporary-file sharing baseline differences.
The diagnostic UI is bundled, so it requires a new IPA; the Actions request-sizing
repair takes effect from merged main. Worker deployment must preserve existing
bindings and pass health/authentication checks without inference. Publication and
runtime evidence must be recorded before telling the owner to retry.

## Promotion evidence

[PR #170](https://github.com/onlykappa/KappaForge/pull/170) merged as
`03182fb2305187e4e93a880c030e36e0be86b9d4`. The Git tree matches tested head
`649670ba4ffbf9fae0b6c36e929d2d0a639d04b5` (`1d871c8f73f9b038e30d4b05510f31d08f0eb303`).
[PR Linux/browser CI](https://github.com/onlykappa/KappaForge/actions/runs/39543552349)
passed 362 Python and 365 JavaScript tests and Chromium/mobile Safari regressions.
[PR native CI](https://github.com/onlykappa/KappaForge/actions/runs/39543552362)
passed simulator/device builds, four UI tests with zero failures, nonblank launch
and IPA packaging. [Main CI](https://github.com/onlykappa/KappaForge/actions/runs/39545174337)
passed independently.

[Worker deployment](https://github.com/onlykappa/KappaForge/actions/runs/39545174469)
passed at version `f8b7ad28-4bbf-4385-b361-48349a5cc228` on the exact merged source.
Pre/post metadata verified all 18 bindings, including nine secret bindings,
were preserved. Health passed; the saved Actions URL matched
`https://kappaforge-chat.ballaking1738.workers.dev` (optional trailing slash).
Unauthenticated and invalid inference credentials failed; an authenticated
malformed request returned HTTP400 without routing. Groq configuration/guard
diagnostics passed with no active cooldown, not a capacity guarantee. Provider
remaining allowance remains unknown. No inference was sent by this repair.

[Main native/release](https://github.com/onlykappa/KappaForge/actions/runs/39545174419)
passed, including four UI tests with zero failures, and published
[v2.2.14](https://github.com/onlykappa/KappaForge/releases/tag/v2.2.14)
at 2026-10-21 04:51:40 UTC from the exact merged source. The published
[KappaForge-unsigned.ipa](https://github.com/onlykappa/KappaForge/releases/download/v2.2.14/KappaForge-unsigned.ipa)
is asset 661386799, 273898 bytes. Downloaded SHA-256 matched GitHub's digest:
`a450d2d6548e377ed40b2207a26fa530b71d1f1408a71f95568d9c58ae76bbc1`.
Independent inspection passed archive CRC, arm64 executable, icons, bundle ID
`com.onlykappa.KappaForge`, version 2.2.14/build20, and all 23 shared frontend files
against the merged Git blobs plus reproduced release-version metadata. A PR build
artifact was not substituted for the published update. GitHub's latest native
release resolves to v2.2.14. Device installation remains an owner action.

Install: Settings -> Updates -> Check for updates -> Download IPA for SideStore ->
Install with SideStore (or import the IPA from Files). Use the same signing
identity/team and install over the current app; do not uninstall. Reopen and
confirm version 2.2.14. Then the existing explicit command `Retry task #169.`
creates fresh authorization and resumes the saved task. This instruction is not
executed by this repair. Task #169 remains stopped; its brief/checkpoint and
any unrelated weather/acceptance drafts are unchanged. The supplied brief still
ends mid-sentence as recorded above; no missing requirements were inferred.

Rollback: revert this scoped change through the same checked deployment workflow;
retain secrets, allowlists and DO storage. Remove Mistral from approved channel
permissions if the owner changes its account to paid usage. Never restore direct-key
fallback, clear task checkpoints or restart the weather task automatically.

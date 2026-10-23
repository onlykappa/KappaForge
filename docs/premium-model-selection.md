# Premium: automatic reviewed open models through OpenRouter

## Owner intent and scope

OpenRouter is the only service funded for Premium. Prefer DeepSeek V4.1 Flash for coding rescue, while retaining
automatic selection when a reviewed alternative better fits the request or remaining budget. This does not turn
Premium on, purchase credits, raise existing billing caps, or make ordinary chat and audits paid. Owners can now
explicitly edit their caps in the existing Models settings page.

## Audit before extending the existing features

The owner requested checking the repository for each recommendation before adding it:

| Requested improvement | Existing feature | Targeted extension |
| --- | --- | --- |
| Adjustable limits | Config defaults and atomic billing ledger | Owner-authenticated limits update and existing settings UI; daily limit added to the same ledger |
| Spendable balance | `openrouterAccount` already fetched credits and usage | Same reader now verifies account balance, key/provider limits, isolates its cache per key, and refreshes before dispatch |
| Billing recovery | Ledger already supported `reconcile` | Bounded Durable Object alarms drive that operation; matching generation evidence is required |
| Selection explanation | Rescue response already carried a policy and generic fallback flag | Concrete skipped-model reasons and explanation saved in the existing offer/receipt and rendered in Usage |
| Model health | Shared routing reservations/outcomes already provided cooldowns | Paid rescues now use those mechanisms, with a separate paid quota pool so free-route exhaustion does not block funded rescue |

No second model selector was added. The existing Preferred model control continues to govern regular requests;
Premium rescue keeps its automatic reviewed policy. There is no parallel billing, account or health subsystem.

There is no verified universal "best model." OpenRouter usage rankings measure adoption, and publisher benchmarks
depend on their tasks and harnesses. This implementation selects the highest-priority **reviewed coding model that
is eligible now**. It does not scrape popularity rankings or admit arbitrary new models from their names.

## Before and after

Previously `pickPremium` accepted broad model-family prefixes and picked the lowest estimated maximum charge.
A cheaper, older candidate could win over the requested DeepSeek model. A lookalike model ID from a different
publisher could also match a family. The Premium toggle was rendered inside a hidden legacy settings block.

Now `config/providers.json` contains an exact-ID, ordered open-weight catalog, license and weights link for each entry:

| Preference | OpenRouter model ID | License |
| --- | --- | --- |
| 1 | `deepseek/deepseek-v4.1-flash-1017` | MIT |
| 2 | `deepseek/deepseek-v4.1-flash` | MIT |
| 3 | `z-ai/glm-5.3-flash` | MIT |
| 4 | `qwen/qwen3-coder` | Apache-2.0 |

This order is a coding-rescue product preference reviewed on 2026-10-22, not a claim that these four models have
been independently benchmarked in KappaForge. DeepSeek's current snapshot is preferred; the base variant provides
availability and price flexibility, GLM offers another current open-weight coding family, and Qwen is a coding fallback.
All four exact IDs, context sizes, token-limit support and current pricing were checked against OpenRouter's public
catalog without sending inference or spending credits.

## Selection and dispatch

1. Keep the existing free-first recovery flow. Premium is limited to recorded coding blockers (`check` or `proposal`).
2. Require the owner's stored Premium setting or one-step approval, free evidence from multiple models, a configured
   OpenRouter key, shared billing storage, and permission to send private code to OpenRouter.
3. Fetch OpenRouter's catalog (one-hour cache). After expiry, a failed refresh refuses selection; stale data is not used.
4. Retain only exact reviewed IDs with known prompt/completion prices, text output, published `max_tokens` support,
   and enough context for the conservative input bound plus twice the allowed output.
5. Enforce the existing $1.50/M input and $3/M output price ceilings. Account for the highest published scheduled
   override, request fees and reasoning prices. No discount or cache hit is assumed.
6. Calculate each candidate's maximum charge and discard candidates that cannot fit the remaining task/month caps.
   Pick the first eligible reviewed model, regardless of cheaper lower-priority candidates.
7. Refresh verified OpenRouter account/key budgets before paid dispatch. Subtract local pending reservations, check
   existing shared route health/concurrency, then recheck authorization and owner limits and reserve the maximum
   atomically. Send one request to
   `https://openrouter.ai/api/v1/chat/completions`, using only `OPENROUTER_API_KEY`.
8. Set OpenRouter `provider.max_price` and `require_parameters:true`, so an upstream endpoint cannot silently ignore
   the output limit or exceed the quoted routing prices. OpenRouter may choose another endpoint for the same model
   within these constraints; KappaForge does not send a fallback paid model after dispatch.
9. Settle reported cost; retain uncertain charges at their reserved maximum. Continue subsequent task steps on free routes.

For example, if DeepSeek is absent, too expensive or too small for the prompt, a fitting reviewed fallback can win.
If no candidate fits, Premium reports refusal and dispatches nothing. Funding OpenRouter does not bypass the
existing free-route evidence requirement or KappaForge's shared gateway request limits.

## Billing and free-path protections

Defaults remain $1/task and $5/calendar-month UTC; the new daily default is $5 UTC, which adds no restriction below
the existing monthly cap. Owners can save each limit from $0 to $100 (up to six decimals). Zero pauses spending under
that limit. Saving limits does not enable Premium, and toggling Premium does not reset saved limits. Limits need not
be ordered: the smallest remaining applicable allowance wins. A single-step approval obeys the same limits.

The existing one-rescue-per-step, single-use approval, cancellation and atomic reservation rules remain.
Quote and reservation decisions read persisted owner limits, never caller-supplied caps. A limit lowered after a
quote applies at reservation, including when concurrent tasks already have pending holds. Daily accounting derives
from the original UTC dispatch dates of existing holds; no destructive migration or duplicate daily ledger is needed.
Prompt reservations use a UTF-8 byte-token bound with framing room for up to 64 messages: when the messages are at
hand, their actual UTF-8 byte length (a byte-level tokenizer emits at most one token per byte), otherwise three bytes
per character. Characters divided by two was not a safe upper bound for code or multilingual text, and three bytes per
character overstated ASCII code about sixfold, pushing moderate prompts past every reviewed model's context. Unresolved paid responses are
not retried or assumed free. No tests in this change spend credits.

The account reader requires a verified balance and key budget, checks all reported provider budgets, and returns the
smallest allowance and its limiting factor. When `/credits` cannot be read with the key, a credit limit on the key
itself (enforced by OpenRouter) bounds spending; with neither, dispatch stays blocked. Missing, malformed or stale
account evidence blocks dispatch. Charges the snapshot may not show yet count against it atomically: requests in
flight, unresolved ones that ended within ten minutes of the check, and charges confirmed since it. Two local requests
cannot each reserve the same funds. An unresolved charge older than that is already reflected in OpenRouter's balance,
so it is not subtracted again (it still counts at its maximum toward the owner's task, daily and monthly limits). OpenRouter remains the authority for simultaneous spending by other
apps and provider-side in-flight limits; a local preflight cannot lock the external account.

## Bounded billing reconciliation

The existing `owner-v1` Durable Object schedules billing alarms; task recovery continues on its separate `recovery-v1`
object. The alarm handler selects the appropriate existing store, so billing never displaces task recovery's alarm.
The hold and its alarm are committed in the same existing SQLite transaction: an alarm persistence failure aborts
the reservation before any paid dispatch. A local workerd/SQLite smoke check verifies the production bundle's
hold/alarm persistence, object eviction/restart, saved limits and settlement without contacting a provider.
One due billing row is claimed per wake, with its next attempt persisted before the read-only generation lookup.
Known generation IDs are checked at most 12 times with exponential backoff over at most 24 hours. Only a matching
generation ID, model and valid provider-reported cost can settle a hold. A duplicate alarm is safe and never sends
inference. A crash before settlement or a lost response leaves the maximum counted.

Holds without a saved generation ID cannot be reconciled automatically: after the request deadline they become
unresolved and need review. Exhausted or unverifiable lookups also remain unresolved with a visible review status;
they do not poll forever or expire to zero. Old pending records use the same recovery path. Existing confirmed
records and stored owner settings retain their format and keys.

An old `KAPPA_ALL_MODEL_PROVIDERS=openrouter` setting can no longer admit paid OpenRouter models into ordinary
chat, coding or probes. OpenRouter's ordinary catalog requires a free variant with verified zero pricing, including
legacy deployments. Audits cannot bypass this by asking an excluded or unlisted OpenRouter name directly, even
when the name ends in `:free`. Other services' existing free routes and permissions are unchanged; Premium never
selects their keys or endpoints.

## Settings and observability

Settings → Models shows a visible **Premium · OpenRouter** group with the toggle, automatic-selection policy,
preferred model, example eligible model, free-first behavior, account allowance and editable spending caps. Missing backend policy or credentials
disable activation. Failed setting saves revert the control and show an error. The example is illustrative: each
actual rescue reselects using its own prompt and remaining budget.

`/capabilities.premium` includes the billing provider, selection policy version, review date, preferred ID/name and
example ID/name. Rescue responses include the actual model, policy and whether higher-priority candidates were
ineligible. Existing offers and Usage receipts retain concrete reasons such as unavailable, context limit, price ceiling,
budget and cooldown, alongside the actual paid model, quoted maximum and confirmed/uncertain cost. No secret is exposed in this metadata.
Existing durable Premium settings, approvals and billing history retain their storage format and keys.

## Updating the preference

To review a newer model, verify its exact OpenRouter ID, published weights/license, coding suitability, supported
parameters, context and price behavior. Add or reorder its entry in `routing.premium.models`, update `reviewedAt`
and the rationale here, and update the selection tests. New catalog entries are not promoted automatically simply
because they are newer or have a familiar family prefix. This is the maintenance point for evolving the policy.

## Verification and release

Behavioral coverage checks quality over price, deterministic selection, unavailable/overpriced/context/budget fallback,
exact-ID isolation, unknown prices, scheduled pricing, Unicode reservations, provider/key isolation, free-only ordinary
catalogs, audit/probe billing protection, authorization, caps, concurrent reservations, and billing uncertainty.
Browser tests exercise visible settings, enable/disable, backend persistence across reload, and failed-save rollback
on desktop Chromium and mobile WebKit. Existing operation and task tests remain in the full suite.

Deploy the Worker for routing behavior. Install a newly built IPA for the visible settings on an iPhone; the generated
web bundle is synchronized in this PR. This branch starts from main independently of #201 and can be reviewed or
merged separately. Neither opening this PR nor running the mocked tests enables Premium or deploys the backend.

## Primary references

- [OpenRouter coding usage rankings](https://openrouter.ai/collections/programming/)
- [DeepSeek V4.1 Flash 1017](https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017)
- [DeepSeek weights and license](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017)
- [GLM weights and license](https://huggingface.co/zai-org/GLM-5.3-Flash)
- [Qwen weights and license](https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct)
- [OpenRouter provider routing and parameter enforcement](https://openrouter.ai/docs/guides/routing/provider-selection)

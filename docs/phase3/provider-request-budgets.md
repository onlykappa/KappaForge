# Provider-aware coding request admission

Task #301's first run stopped locally at 20,872/20,000 UTF-16 characters during
recovery planning. The request was not sent; that engine cutoff was not a
Cloudflare or model context limit. Owner-authorized direct diagnostics subsequently
bypassed the gateway without changing production settings.

## Measured receipts

- [Direct Groq access and size test](https://github.com/onlykappa/KappaForge/actions/runs/40528961952):
  after explicit client headers, 20,000 synthetic source characters passed with
  5,067 input tokens. At 40,000 characters Groq returned HTTP 413, TPM limit 8,000,
  requested 10,084. The earlier 403's body was discarded by the old diagnostic;
  successful access after the header change does not prove its internal cause.
- [Direct 35,000-character Groq test](https://github.com/onlykappa/KappaForge/actions/runs/40531333457):
  HTTP 413, TPM limit 8,000, requested 9,072. Preserve the registry's existing
  8,000-token Groq allowance; it matches observed account/model enforcement.
- [All-provider 35,000-character test](https://github.com/onlykappa/KappaForge/actions/runs/40531690613),
  diagnostic head `c1e959914ea1a9fbcb6f3fb0a09a71b45e4e930d`: 15 providers
  evaluated, 12 inference attempts, identical synthetic Python text, 256 output
  tokens. OpenRouter's free Nemotron route completed (8,762 input tokens), as did
  Ollama gpt-oss:120b (8,812). OVH accepted 9,677 input tokens but truncated its
  answer. Groq refused the size; Gemini returned 503; Mistral, ZAI and Unorouter
  returned 429; Workers AI and LLM7 returned 401. NVIDIA had a transport/response
  error and Kilo an unusable response. Cerebras and Requesty lacked Actions
  credentials. Metered Hugging Face was not called. A green diagnostic job means
  observations were collected, not that every provider passed.

These samples do not establish universal character maxima, full coding response
capacity, or production CPU safety. No provider quota is raised because another
provider accepted a request. No new paid route is enabled. The temporary diagnostic
workflow and its secret bindings remain isolated from this production repair.

## Admission behavior

The engine uses the existing shared transport boundary (100,000 UTF-16 characters,
200,000 serialized bytes), replacing the independent 20,000-character cutoff.
This is a construction ceiling, not a claim that any model can accept that size.
Pinned-route bounds, learned role-specific resource ceilings, complete owner
instructions, serialized byte checks and durable proposal counters remain enforced.

Before reserving quota or calling a coding provider, the Worker bounds input
using UTF-8 bytes plus per-message framing. It reserves the route's answer budget
and a 256-token safety allowance, then checks the smaller provider/model context
and any configured free-request token allowance. This conservative byte bound
replaces chars/3.5 for coding admission; it is not an exact tokenizer measurement.
Gemini's discovered model context/output bounds now apply here too. Unsupported
routes are skipped without an inference request. The router does not silently
cut an answer budget to squeeze it into Groq's smaller allowance. Existing model
and provider output maxima still apply.

Shared token-per-minute reservations include bounded input, reserved output and
safety allowance instead of only a rough input estimate. Remaining account quota,
authentication, provider availability, mandatory validation, publication provenance,
paid-inference prohibition and the 12-proposal small-document effort limit remain
independent gates. Cloudflare CPU 300000 ms, configured subrequests 10000000 and
both disabled global day/minute throttles are unchanged; no deployment-plan limit
is inferred from a prompt test.

## Regression evidence

Separate test processes exercise complete source/owner preservation above the old
20k boundary, the 35k Groq-versus-larger-model routing decision, full output
reservation, Unicode bytes, smaller model contexts and outputs, serialized byte
rejection, learned envelopes, pinned caps and operational receipts. These are
scripted tests without live provider calls. The direct runs above are the live
measurements; production call savings and task #301 completion remain unmeasured
until the repaired engine and Worker are active and the task is resumed.

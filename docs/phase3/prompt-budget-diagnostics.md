# Prompt sizing and rejection evidence

Task #282 (run 40392083363, commit 3a70287) generated its documentation change with a successful 19,889-character coding prompt. The subsequent checking step was rejected locally before inference. Five earlier gateway calls succeeded. This was not a request-count exhaustion report. The original rejection did not retain the rejected size or distinguish character and byte checks; its exact overage cannot be recovered from the logs.

The default engine ceiling is 20,000 UTF-16 code units for the complete prompt, including the owner brief, instructions, source and task-state envelope. It is not a 20,000-character allowance for source alone. Learned per-role resource limits or pinned-route limits can lower it. Gateway configuration also limits prompts to 100,000 code units, total estimated context to 32,768 tokens and serialized requests to 200,000 bytes. The engine's sizing check reserves 8,192 output tokens when deriving its context allowance. These are separate checks, not interchangeable units.

Local sizing accounts for JSON-escaped prompt bytes plus 4,096 bytes of request-envelope allowance. The actual serialized request is checked separately immediately before sending. An 18,000-character planning target provides headroom but is not a guarantee: builders must check the final envelope against both character and byte limits.

Future rejected prompts emit `KAPPA_PROMPT_BUDGET` JSON to the workflow log. Fields identify measured prompt characters, effective character cap, escaped JSON bytes, byte allowance, request-byte cap, role, resource cap and failed checks. `sent:false` means the rejected request was not sent; it does not imply no earlier requests ran. A rejection at the final serialization boundary reports exact `requestBytes` and `requestByteCap` instead of an estimate.

The exception message includes actual/cap counts and failed checks, so existing failure reports and recovery events retain the numbers too. Prompt text, source, response bodies and credentials are excluded. This diagnostic change does not increase any limit or truncate owner instructions.

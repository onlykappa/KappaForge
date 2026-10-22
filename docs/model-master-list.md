# KappaForge model master list

From the live model audit on 22 October 2026: every model got a one-word check, every model that did not answer was
checked again one by one (90-second wait, larger reply allowance, the provider's own error message). Use this list when
adding providers: a model under Removed failed for a permanent reason and is listed in that provider's `removedModels`
in `config/providers.json`.

**106 kept** (92 working, 14 unavailable today) and **90 removed**, out of 196.

| Provider | Kept | Working | Unavailable today | Removed |
|---|---|---|---|---|
| Google Gemini | 12 | 9 | 3 | 2 |
| Groq | 4 | 4 | 0 | 0 |
| Mistral | 14 | 12 | 2 | 4 |
| Cloudflare Workers AI | 23 | 22 | 1 | 14 |
| NVIDIA Build | 16 | 13 | 3 | 52 |
| OpenRouter | 14 | 11 | 3 | 3 |
| Kilo Code | 13 | 12 | 1 | 1 |
| Ollama Cloud | 9 | 8 | 1 | 14 |
| Z.ai | 1 | 1 | 0 | 0 |

## Kept models

### Google Gemini (12)

| Model | Status | Notes |
|---|---|---|
| `gemini-3-flash-preview` | Working | Answered the live check |
| `gemini-3.1-flash-lite` | Working | Answered the live check |
| `gemini-3.5-flash` | Working | Answered the live check |
| `gemini-3.5-flash-lite` | Working | Answered the live check |
| `gemini-flash-lite-latest` | Working | Answered the live check |
| `gemma-4-26b-a4b-it` | Working | Answered the live check |
| `gemini-3.1-flash-lite-preview` | Working (after fix) | Answered on the one-by-one check |
| `gemini-3.6-flash` | Working (after fix) | Answered on the one-by-one check |
| `gemini-3.8-flash` | Working (after fix) | Cold start or busy: first try overloaded, answered on the second |
| `gemini-flash-latest` | Kept: unavailable today | Provider overloaded or erroring today: kept: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. |
| `gemini-pro-latest` | Kept: unavailable today | Maxed out right now (rate limit): kept: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to:  To monitor your current usa |
| `gemma-4-31b-it` | Kept: unavailable today | Provider overloaded or erroring today: kept: Internal error encountered. |

### Groq (4)

| Model | Status | Notes |
|---|---|---|
| `allam-2-7b` | Working | Answered the live check |
| `openai/gpt-oss-120b` | Working | Answered the live check |
| `openai/gpt-oss-20b` | Working | Answered the live check |
| `qwen/qwen3.8-27b` | Working | Answered the live check |

### Mistral (14)

| Model | Status | Notes |
|---|---|---|
| `codestral-2508` | Working | Answered the live check |
| `codestral-latest` | Working | Answered the live check |
| `ministral-14b-2512` | Working | Answered the live check |
| `ministral-14b-latest` | Working | Answered the live check |
| `ministral-3b-2512` | Working | Answered the live check |
| `ministral-3b-latest` | Working | Answered the live check |
| `ministral-8b-2512` | Working | Answered the live check |
| `ministral-8b-latest` | Working | Answered the live check |
| `mistral-code-fim-latest` | Working | Answered the live check |
| `mistral-code-latest` | Working | Answered the live check |
| `voxtral-small-2507` | Working | Answered the live check |
| `voxtral-small-latest` | Working | Answered the live check |
| `mistral-small-2603` | Kept: unavailable today | Maxed out right now (rate limit): kept: Rate limit exceeded |
| `mistral-small-latest` | Kept: unavailable today | Maxed out right now (rate limit): kept: Rate limit exceeded |

### Cloudflare Workers AI (23)

| Model | Status | Notes |
|---|---|---|
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | Working | Answered the live check |
| `@cf/daily-co/phonellm-mini-alpha-2` | Working | Answered the live check |
| `@cf/google/gemma-2b-it-lora` | Working | Answered the live check |
| `@cf/google/gemma-7b-it-lora` | Working | Answered the live check |
| `@cf/ibm-granite/granite-4.0-h-micro` | Working | Answered the live check |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | Working | Answered the live check |
| `@cf/meta/llama-3.2-1b-instruct` | Working | Answered the live check |
| `@cf/meta/llama-3.2-3b-instruct` | Working | Answered the live check |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Working | Answered the live check |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Working | Answered the live check |
| `@cf/mistral/mistral-7b-instruct-v0.2-lora` | Working | Answered the live check |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Working | Answered the live check |
| `@cf/nvidia/nemotron-3-120b-a12b` | Working | Answered the live check |
| `@cf/openai/gpt-oss-120b` | Working | Answered the live check |
| `@cf/openai/gpt-oss-20b` | Working | Answered the live check |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | Working | Answered the live check |
| `@cf/qwen/qwen3.8-27b` | Working | Answered the live check |
| `@cf/qwen/qwq-32b` | Working | Answered the live check |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `@cf/google/gemma-4-26b-a4b-it` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `@cf/qwen/qwen3-30b-a3b-fp8` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `@cf/zai-org/glm-4.7-flash` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `@cf/meta/llama-3.2-11b-vision-instruct` | Kept: unavailable today | Provider overloaded or erroring today: kept: 5016: Prior to using this model, you must submit the prompt 'agree'. By submitting ‘agree’, you hereby agree to the llama-3.2-11b-vision-instruct Comm |

### NVIDIA Build (16)

| Model | Status | Notes |
|---|---|---|
| `meta/llama-3.2-11b-vision-instruct` | Working | Answered the live check |
| `nvidia/ising-calibration-1.5-31b` | Working | Answered the live check |
| `nvidia/nemotron-3-ultra-550b-a55b` | Working | Answered the live check |
| `nvidia/nemotron-parse-2.0` | Working | Answered the live check |
| `nvidia/riva-translate-4b-instruct-v2` | Working | Answered the live check |
| `z-ai/glm-5.3` | Working | Answered the live check |
| `z-ai/glm-5.3-flash` | Working | Answered the live check |
| `meta/muse-glimmer-30b` | Working (after fix) | Slow starter: needed more than 25s |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | Working (after fix) | Slow starter: needed more than 25s |
| `openai/gpt-oss-20b` | Working (after fix) | Cold start or busy: first try hung 90s, answered on the second |
| `poolside/laguna-xs-2.1` | Working (after fix) | Cold start or busy: first try overloaded, answered on the second |
| `stepfun-ai/step-5-preview` | Working (after fix) | Cold start or busy: first try hung 90s, answered on the second |
| `deepseek-ai/deepseek-v4.1-flash` | Kept: unavailable today | Hung twice (90s each) on the provider's side: kept, skipped while it hangs |
| `google/gemma-4-31b-it` | Kept: unavailable today | Hung twice (90s each) on the provider's side: kept, skipped while it hangs |
| `meta/llama-3.2-90b-vision-instruct` | Kept: unavailable today | Hung twice (90s each) on the provider's side: kept, skipped while it hangs |

### OpenRouter (14)

| Model | Status | Notes |
|---|---|---|
| `cohere/north-mini-code:free` | Working | Answered the live check |
| `dots-studio/dots-3-note-preview:free` | Working | Answered the live check |
| `liquid/lfm-2.5-2.6b:free` | Working | Answered the live check |
| `minimax/minimax-m3.1-flash:free` | Working | Answered the live check |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Working | Answered the live check |
| `openrouter/free` | Working | Answered the live check |
| `poolside/laguna-s-2.1:free` | Working | Answered the live check |
| `recursive/flint-v1.0:free` | Working | Answered the live check |
| `google/gemma-4-31b-it:free` | Working (after fix) | Answered on the one-by-one check |
| `nvidia/nemotron-3.5-lightning:free` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `nvidia/nemotron-3.5-super-vl:free` | Working (after fix) | Answered on the one-by-one check |
| `google/gemma-4-26b-a4b-it:free` | Kept: unavailable today | Maxed out right now (rate limit): kept: Provider returned error |
| `poolside/laguna-xs-2.1:free` | Kept: unavailable today | Maxed out right now (rate limit): kept: Provider returned error |
| `xingchen-agi/xing4.0-29b-a4b:free` | Kept: unavailable today | Maxed out right now (rate limit): kept: Provider returned error |

### Kilo Code (13)

| Model | Status | Notes |
|---|---|---|
| `cohere/north-mini-code:free` | Working | Answered the live check |
| `dots-studio/dots-3-note-preview:free` | Working | Answered the live check |
| `liquid/lfm-2.5-2.6b:free` | Working | Answered the live check |
| `minimax/minimax-m3.1-flash:free` | Working | Answered the live check |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Working | Answered the live check |
| `nvidia/nemotron-3.5-super-vl:free` | Working | Answered the live check |
| `openrouter/free` | Working | Answered the live check |
| `poolside/laguna-s-2.1:free` | Working | Answered the live check |
| `recursive/flint-v1.0:free` | Working | Answered the live check |
| `xingchen-agi/xing4.0-29b-a4b:free` | Working | Answered the live check |
| `kilo-auto/free` | Working (after fix) | Answered on the one-by-one check |
| `nvidia/nemotron-3.5-lightning:free` | Working (after fix) | Thinking model: needed more room to reply (the quick check allowed 64 tokens) |
| `poolside/laguna-xs-2.1:free` | Kept: unavailable today | Maxed out right now (rate limit): kept: Provider returned error |

### Ollama Cloud (9)

| Model | Status | Notes |
|---|---|---|
| `beam` | Working | Answered the live check |
| `gemma4:31b` | Working | Answered the live check |
| `gpt-oss:120b` | Working | Answered the live check |
| `gpt-oss:20b` | Working | Answered the live check |
| `minimax-m3.1-flash` | Working | Answered the live check |
| `nemotron-3-nano:30b` | Working | Answered the live check |
| `nemotron-3-super` | Working | Answered the live check |
| `nemotron-3-ultra` | Working | Answered the live check |
| `mistral-large-4` | Kept: unavailable today | Provider is still rolling it out: kept: This model is currently being rolled out and is not yet available to you. Please check back later. |

### Z.ai (1)

| Model | Status | Notes |
|---|---|---|
| `glm-4.7-flash` | Working (after fix) | Answered on the one-by-one check |

## Removed models

### Google Gemini (2)

| Model | Reason | Provider's message |
|---|---|---|
| `gemini-2.5-flash` | Retired by the provider | This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features |
| `gemini-2.5-flash-lite` | Retired by the provider | This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the lates |

### Mistral (4)

| Model | Reason | Provider's message |
|---|---|---|
| `voxtral-mini-2602` | Not a chat model | Invalid model: voxtral-mini-2602 |
| `voxtral-mini-latest` | Not a chat model | Invalid model: voxtral-mini-latest |
| `voxtral-mini-realtime-2602` | Not a chat model | Invalid model: voxtral-mini-realtime-2602 |
| `voxtral-mini-realtime-latest` | Not a chat model | Invalid model: voxtral-mini-realtime-latest |

### Cloudflare Workers AI (14)

| Model | Reason | Provider's message |
|---|---|---|
| `@cf/swiss-ai/apertus-v1.5-8b` | Account not allowed | 5018: This account is not allowed to access @cf/swiss-ai/apertus-v1.5-8b. |
| `@cf/meta-llama/llama-2-7b-chat-hf-lora` | Empty replies even with room | Replied empty twice, even with 1,024 tokens of room |
| `@cf/utter-project/eurollm-9b-it` | No model config at the provider | 4003: AI model does not have config |
| `@cf/cloudflare/clairic` | Not a chat model | 5006: Error: required properties at '/' are 'model,fields' |
| `@cf/cloudflare/clef` | Not a chat model | 5006: Error: required properties at '/' are 'model,state,questions' |
| `@cf/cloudflare/clef-flash` | Not a chat model | 5006: Error: required properties at '/' are 'model,state,questions' |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | Paid plan only | 5035: Model @cf/deepseek-ai/deepseek-v4-flash-0731 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | Paid plan only | 5035: Model @cf/deepseek-ai/deepseek-v4-pro-0813 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Paid plan only | 5035: Model @cf/deepseek-ai/deepseek-v4.1-flash-1017 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/moonshotai/kimi-k2.6` | Paid plan only | 5035: Model @cf/moonshotai/kimi-k2.6 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/moonshotai/kimi-k2.7-code` | Paid plan only | 5035: Model @cf/moonshotai/kimi-k2.7-code is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/zai-org/glm-5.2` | Paid plan only | 5035: Model @cf/zai-org/glm-5.2 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/zai-org/glm-5.3` | Paid plan only | 5035: Model @cf/zai-org/glm-5.3 is not available on the Workers Free plan. (needs the paid Workers plan) |
| `@cf/zai-org/glm-5.3-flash` | Paid plan only | 5035: Model @cf/zai-org/glm-5.3-flash is not available on the Workers Free plan. (needs the paid Workers plan) |

### NVIDIA Build (52)

| Model | Reason | Provider's message |
|---|---|---|
| `google/diffusiongemma-26b-a4b-it` | Not a chat model | No answer within 90s |
| `nvidia/ai-synthetic-video-detector` | Not a chat model | Internal error while making inference request |
| `nvidia/nemotron-parse` | Not a chat model | Expected exactly one message. Expected exactly one message. |
| `01-ai/yi-large` | Not hosted for this account (404) | Not found for this account |
| `adept/fuyu-8b` | Not hosted for this account (404) | Not found for this account |
| `ai21labs/jamba-1.5-large-instruct` | Not hosted for this account (404) | Not found for this account |
| `aisingapore/sea-lion-7b-instruct` | Not hosted for this account (404) | Not found for this account |
| `bigcode/starcoder2-15b` | Not hosted for this account (404) | 404 page not found |
| `databricks/dbrx-instruct` | Not hosted for this account (404) | Not found for this account |
| `deepseek-ai/deepseek-coder-6.7b-instruct` | Not hosted for this account (404) | Not found for this account |
| `google/codegemma-1.1-7b` | Not hosted for this account (404) | Not found for this account |
| `google/codegemma-7b` | Not hosted for this account (404) | Not found for this account |
| `google/deplot` | Not hosted for this account (404) | Not found for this account |
| `google/gemma-2b` | Not hosted for this account (404) | Not found for this account |
| `google/gemma-3-12b-it` | Not hosted for this account (404) | Not found for this account |
| `google/gemma-3-4b-it` | Not hosted for this account (404) | Not found for this account |
| `google/recurrentgemma-2b` | Not hosted for this account (404) | Not found for this account |
| `ibm/granite-3.0-3b-a800m-instruct` | Not hosted for this account (404) | Not found for this account |
| `ibm/granite-3.0-8b-instruct` | Not hosted for this account (404) | Not found for this account |
| `ibm/granite-34b-code-instruct` | Not hosted for this account (404) | Not found for this account |
| `ibm/granite-8b-code-instruct` | Not hosted for this account (404) | Not found for this account |
| `meta/codellama-70b` | Not hosted for this account (404) | Not found for this account |
| `meta/llama2-70b` | Not hosted for this account (404) | Not found for this account |
| `microsoft/kosmos-2` | Not hosted for this account (404) | Not found for this account |
| `microsoft/phi-3-vision-128k-instruct` | Not hosted for this account (404) | Not found for this account |
| `microsoft/phi-3.5-moe-instruct` | Not hosted for this account (404) | Not found for this account |
| `mistralai/codestral-22b-instruct-v0.1` | Not hosted for this account (404) | Not found for this account |
| `mistralai/mistral-7b-instruct-v0.3` | Not hosted for this account (404) | Not found for this account |
| `mistralai/mistral-large` | Not hosted for this account (404) | Not found for this account |
| `mistralai/mistral-large-2-instruct` | Not hosted for this account (404) | Not found for this account |
| `mistralai/mixtral-8x22b-v0.1` | Not hosted for this account (404) | Not found for this account |
| `moonshotai/kimi-k2.6` | Not hosted for this account (404) | Not found for this account |
| `nv-mistralai/mistral-nemo-12b-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/cosmos-reason2-8b` | Not hosted for this account (404) | Not found for this account |
| `nvidia/llama-3.1-nemotron-51b-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/llama-3.1-nemotron-70b-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | Not hosted for this account (404) | Not found for this account |
| `nvidia/llama3-chatqa-1.5-70b` | Not hosted for this account (404) | Not found for this account |
| `nvidia/mistral-nemo-minitron-8b-8k-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/nemotron-3-super-120b-a12b` | Not hosted for this account (404) | Not found for this account |
| `nvidia/nemotron-4-340b-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/nemotron-4-340b-reward` | Not hosted for this account (404) | Not found for this account |
| `nvidia/nemotron-nano-3-30b-a3b` | Not hosted for this account (404) | Not found for this account |
| `nvidia/neva-22b` | Not hosted for this account (404) | Not found for this account |
| `nvidia/nvclip` | Not hosted for this account (404) | 404 page not found |
| `nvidia/riva-translate-4b-instruct` | Not hosted for this account (404) | Not found for this account |
| `nvidia/vila` | Not hosted for this account (404) | Not found for this account |
| `writer/palmyra-creative-122b` | Not hosted for this account (404) | Not found for this account |
| `writer/palmyra-fin-70b-32k` | Not hosted for this account (404) | Not found for this account |
| `writer/palmyra-med-70b` | Not hosted for this account (404) | Not found for this account |
| `writer/palmyra-med-70b-32k` | Not hosted for this account (404) | Not found for this account |
| `zyphra/zamba2-7b-instruct` | Not hosted for this account (404) | Not found for this account |

### OpenRouter (3)

| Model | Reason | Provider's message |
|---|---|---|
| `thinkingmachines/inkling-small:free` | Only available inside agent tools | thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on |
| `thinkingmachines/inkling:free` | Only available inside agent tools | thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on |
| `nvidia/nemotron-3-super-120b-a12b:free` | Retired by the provider | Provider returned error |

### Kilo Code (1)

| Model | Reason | Provider's message |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b:free` | Retired by the provider | Provider returned error |

### Ollama Cloud (14)

| Model | Reason | Provider's message |
|---|---|---|
| `deepseek-v4-pro:0813` | Needs payment (402) | Needs paid credits (402) |
| `deepseek-v4.1-flash` | Needs payment (402) | Needs paid credits (402) |
| `deepseek-v4.1-flash:1017` | Needs payment (402) | Needs paid credits (402) |
| `glm-5.2` | Needs payment (402) | Needs paid credits (402) |
| `glm-5.3` | Needs payment (402) | Needs paid credits (402) |
| `glm-5.3-flash` | Needs payment (402) | Needs paid credits (402) |
| `kimi-k2.6` | Needs payment (402) | Needs paid credits (402) |
| `kimi-k2.7-code` | Needs payment (402) | Needs paid credits (402) |
| `kimi-k3` | Needs payment (402) | Needs paid credits (402) |
| `minimax-m2.7` | Needs payment (402) | Needs paid credits (402) |
| `minimax-m3` | Needs payment (402) | Needs paid credits (402) |
| `mistral-large-3:675b` | Needs payment (402) | Needs paid credits (402) |
| `muse-spark-open` | Needs payment (402) | Needs paid credits (402) |
| `clef:27b` | Not a chat model | clef:27b is a decision model and only supports /v1/systemone |

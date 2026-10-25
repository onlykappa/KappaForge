# Evaluation of OpenCoder-llm/OpenCoder-llm

**Verdict: skip it.** Nothing in the repository is worth adopting into KappaForge as it stands. One idea it prompted is
recorded below for later. The repository was last updated on 2024-12-09.

Reviewed on a read-only shallow clone (the code, README files, scripts and data files in the repository). The
OpenCoder paper and the separate `opc_data_filtering` repository were **not** read, so nothing here judges them.

## What it is

A "cookbook" for training an open code model. The model weights and datasets live on Hugging Face. The repository
itself holds two small code pieces:

- `OpenCodeEval`: an evaluator for code models (HumanEval and HumanEval+, MBPP and MBPP+, BigCodeBench, and 180
  LeetCode problems from 2024), scored with pass@k.
- `sft`: fine-tuning scripts and DeepSpeed configs.

## Why it does not fit KappaForge

| Piece | Why not |
| --- | --- |
| Model weights (1.5B and 8B) | Need GPUs. KappaForge uses free hosted models, and `config/providers.json` already routes to much newer ones |
| Datasets and `sft` scripts | Only useful for training a model, which KappaForge does not do |
| Code execution (`eval/execution.py`) | The standard HumanEval-style guard; its own comment says it is "NOT a security sandbox". KappaForge's isolated Docker sandbox is much stronger |
| Output sanitizer (`sanitize.py`) | Extracts the longest valid Python snippet from free-form model text. KappaForge's models return structured JSON edits |
| Benchmarks | Single-function Python puzzles from 2021 to 2024, almost certainly present in the training data of current models, so they would no longer separate good models from bad ones for repository repair work |

## Problems found in the repository

- `OpenCodeEval/src/backend/openai.py` is not an OpenAI backend. It imports and loads vLLM (a GPU model server) and
  never calls an API, and `main.py` only uses the vLLM backend. The README's "OpenAI API integration (coming soon)"
  is accurate: the evaluator cannot test hosted models as it stands.
- The `OpenCodeEval` README badges are placeholders (`yourusername`, "tests passing", links to a `docs/` and `tests/`
  that do not exist).
- `sft/README.md` is empty, and `sft/scripts/stage2_example.sh` points at `configs/stage3.json`, which is not in the
  repository (it has `zero1.json` and `zero3.json`).
- 14 compiled `__pycache__` files are committed.

## One idea worth keeping: a measured model scorecard

KappaForge ranks its free models for each role (`code`, `verify`, `review`, `diagnose`, `light`) with a hand-written
list (`routing.roleRanking` in `config/providers.json`). `engine/provider_check.py` only checks that a model
*answers* (it asks for "OK"), not that it writes or repairs code well. So the ranking is opinion, not measurement.

A scheduled GitHub workflow could score every model in `roleRanking` on a small repair benchmark and report the
results, for a human to use when changing the ranking. Suggested shape, if this is ever built:

1. **Use KappaForge's own fixtures** (`tests/fixtures/sandbox/invoice-service` and `shop-service`) in the real
   sandbox, not public puzzles. They measure what KappaForge actually does: investigate a failing project and repair
   it. Add a few more fixtures over time, written fresh so models have not seen them.
2. **Score with pass@k.** The unbiased pass@k estimator (`1 - C(n-c, k) / C(n, k)`, from the Codex paper) is about ten
   lines and is the one piece of OpenCodeEval worth copying.
3. **Run on GitHub-hosted runners** with the existing free-first admission, a small fixed request budget per model,
   and no paid or metered capacity.
4. **Report, do not auto-route.** Publish a table and let the owner decide, so a noisy run cannot silently reorder
   production routing.

This is a suggestion only; nothing is built for it.

# Preserve context when inference routes change

This follow-up is stacked on #224 and includes the newer #223 fixes through a
merge of its branch. Neither parent branch is modified by this work.

The requested review-before-stop behavior already exists in #224: repeated or
alternating source/evidence triggers one fresh loop review, continuation needs a
concrete different approach, and saved retry limits survive restart. Added tests
explicitly reject late loop decisions after source or owner-guidance changes.

## Shared contract

`runner.run_model` now opens a controller-owned inference call around both current
execution paths: direct provider routing (including Gemini and OpenAI-compatible
fallback endpoints), and the integrated Worker gateway. Its immutable stamp binds
the owner goal, repository/task/branch/candidate, role, stage, current observations
and the exact rendered prompt. The call checks this stamp before each inference
request/retry and again before returning any planner, coder or reviewer answer.

Fallback changes the model, not the task. It sends the same rendered context.
Changed authority, source checkpoints, PR/check observations, actions or stages
invalidate the answer and require reconciliation. A different task's journal
cannot charge model budget or dispatch a request. Stale-context errors remain
terminal; they are not classified as provider outages or retried on another model.

The contract uses ContextVars for per-call isolation and restores the enclosing
call after exit. Routing events and provider rejection diagnostics do not invalidate
their own call; freshness compares observations rather than the diagnostic revision.
Existing prompt,
authorization, provider-selection, deadline and recovery budgets remain in force.

## Handoff history

Shared task state includes at most eight controller events: started, attempted,
answered, failed or discarded. Each has a call ID, engine, route and context hash.
There are no prompts, model output or exception messages in these events. Source
and goal text are not added to the durable routing history. Bounded events are
saved with the existing task journal and restored only for the same task and goal.
Saved events remain historical diagnostics, never PR/check receipts or permission
to edit. Rendering can omit older events to preserve the existing context budget.

## Limits and validation

This supplies a common contract for KappaForge's existing inference routes. It
does not add Claude Code, Codex SDK or Pi process adapters. A future execution
adapter must use the same inference boundary and call `inference_attempt` before
each dispatch. No Cindy code or additional runtime package is vendored.

The pattern is informed by Cindy's [shared-agent runtime rules](https://github.com/makecindy/cindy/blob/main/docs/dev-rules/maker-core-and-agent-behavior.md)
and [loop-review implementation](https://github.com/makecindy/cindy/blob/main/packages/maker-core/src/agents/shared/tool-loop-review.ts).

Validation: 603 Python tests passed locally (five existing Docker/tooling skips),
and all 822 Node tests passed. Thirteen added regressions cover real direct-provider failover with identical
prompts, direct/gateway handoff history, stale answers for all model roles, changed
goal/action/stage/receipts, foreign journals, terminal pre-dispatch rejection,
private-text exclusion, bounded recovery history and late loop decisions.

# Phase 2 section 6: owner clarification and resume

When a development task hits a material ambiguity, it stops with **NEEDS_CLARIFICATION**: it asks the owner one
question and waits, instead of guessing. The ambiguity can be about how to implement the change, whether it is
authorized, what behavior is expected, or whether it is safe. Only that task pauses. When the owner answers, the task
resumes from its checkpoint with the answer. The saved plan, candidate, sandbox state and repair history are reused,
not rebuilt.

The code is in `engine/clarification.py`; the pipeline hooks are in `engine/developer.py` and
`engine/sandbox_repair_controller.py`.

## When a question is asked

A question can come from two places:

| Phase | Source | What is saved |
| --- | --- | --- |
| Planning, before any code | The planner's single model call may return `clarify: {kind, question, why, evidence}`. No extra request is spent | Task plan (with the question as an open question), requirement classification, recovery journal |
| Repair, mid-sandbox | The repair loop's `ask_owner` tool, offered only when a checkpoint exists | All of the above, plus the execution checkpoint: candidate patch, sandbox phase, attempts and repair history |

**Deterministic checks (`clarification.validate`)** refuse a question that:
- has a kind other than `implementation`, `authorization`, `expected_behavior` or `safety`;
- is not exactly one concise question (10–300 characters, one question mark), or does not say why it blocks a correct change;
- is an implementation or expected-behavior question about something a convention or the repository settles: naming, formatting, style, tabs or spaces, colours, file or folder placement, case styles and similar;
- asks permission for an owner-only action (merge, deploy, release, change access). KappaForge never does these, so there is nothing to ask;
- repeats a question this task already asked.

The convention filter uses specific convention cues; a broad word such as “order” does not make a question trivial.
For example, refund allocation order is business behavior and remains an owner question when the task leaves it open.

There is no cap on the number of questions: a task asks as many as it genuinely needs over its life, one
at a time, and each waits for the owner's answer before the next can be asked.

A refused question becomes a decision: the planner proceeds and the feed says "Decided without asking the owner: …".
In repair, the tool returns `invalid` and the loop continues. Without a recovery journal there is nothing to resume
exactly, so the task proceeds with the most conservative reading and says so.

## Asking

`clarification.ask`:
1. saves the question with the checkpoint;
2. posts one task comment headed **"KappaForge has a question"**, with the question, why it is asked, the evidence,
   and how to answer;
3. sets the journal status to `needs_clarification`.

That status is the recovery state `paused`, shown in the app as blocked. The recovery scanner only resumes `waiting`
tasks, so it never auto-resumes a paused one. The runner keeps the status when the run returns.

**No draft PR, commit or branch is made while the task waits.** On the iPhone, the app reads the comment as a
`question` report:
- the chat shows **"Question for you · answer with Send guidance"**;
- a toast announces it, and the task needs attention;
- the dashboard says "Paused · answer its question with Send guidance".

The comment lives on GitHub, so a phone that was offline sees the question when it reconnects.

## Waiting

Every run of a paused task first calls `clarification.resume`, before any model call, repair attempt or sandbox run.
With no answer, it says "Still waiting for your answer" and stops. A duplicate wake or an old Retry therefore costs
nothing. **Silence is never an answer.** There is no timeout that turns waiting into approval.

## Answering

The answer is the owner's own guidance, which is the existing path:
- the app's **Send guidance** goes through the owner-authorized `/guidance` route;
- that posts a `Guidance:` comment as the owner and dispatches the task.

Only the first owner `Guidance:` comment posted after the question counts. Comment ids only grow, so "after" is exact.
Comments by anyone else, by the bot, or from before the question are ignored. The comments are fetched since the
question was asked, so the answer is found however long the task's history is.

The answer is saved in the journal (`status: answered`, `answer`, `answerComment`). The task then resumes:
- **Same checkpoint.** The answer joins the task text in an *OWNER ANSWERS TO KAPPAFORGE'S QUESTIONS* section.
  `execution.task_digest` leaves that section out of every checkpoint identity: the generation plan, execution
  checkpoint and task plan. Answering therefore resumes the same saved work instead of invalidating it. Ordinary
  guidance still changes the task, as before.
- **Planning-phase question:** the planner runs again with the answer, because the answer can change what to read and
  build. The task plan records an `owner` revision: the question moves from open questions to completed, with the answer.
- **Repair-phase question:** the repair loop continues from its saved phase, with its history noting the question and
  the answer in its prompt. The earlier attempt still counts, and the candidate is not regenerated.
- **Requirement review:** it receives the answer as owner guidance.

The same protocol applies to **Fix it** on an existing draft PR: questions are posted rather than reported as failed
sandbox runs; no check polling, proposal or sandbox work occurs while waiting. The owner's answer resumes the saved
fix candidate and history. A final review checks any changed patch and the answered assumptions before publication.

**An answer grants nothing.** The authorization guard decides every write exactly as before. "Yes, merge it" in an
answer is guidance text, and API merges stay refused.

## Tests

`tests/test_clarification.py` (17) covers:
- **Question checks:** material questions are accepted once; convention questions are decided, not asked; owner-only and malformed questions are refused.
- **Answers:** only the owner's guidance after the question counts; silence is never an answer; answers leave checkpoint identities unchanged.
- **Asking:** one comment; the task is marked waiting and never auto-resumed; the question is bound to its request.
- **Resuming:** a run waits, then records the answer, and the answer is persisted.
- **Repair pause:** the paused repair keeps its candidate, phase, attempts and history, then resumes with one action and finishes.
- **Refused tool calls:** a convention question through `ask_owner` is refused and the repair continues; without a checkpoint, `ask_owner` is not offered.
- **End to end:** an ambiguous task pauses with no code and no PR; a dispatch with no answer calls no model; a non-owner reply is ignored; the owner's answer resumes the task; the answer reaches the planner and the writer in its own section; one draft PR follows, and its plan records the `owner` revision.
- **Repair-phase pipeline:** no PR and no branch.
- **No permission:** an answer cannot enable a merge.
- **Planner:** it proposes a question in its single call.

`tests/clarification-ui.test.mjs` covers the app: the question is its own report status, it keeps the task open, it
needs attention, and only the agent can post one.

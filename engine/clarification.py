"""Owner clarification and resume (Phase 2 section 6).

When a material ambiguity blocks a correct change (how to implement it, whether it is authorized, what behavior is
expected, or whether it is safe), a development task stops with NEEDS_CLARIFICATION instead of guessing. It saves its
checkpoint, records the ambiguity and the evidence for it, and asks the owner one concise question on the task, where
the KappaForge app shows it (the comment stays on GitHub, so a phone that was offline sees it when it reconnects).

Only that task pauses. While the question is open, a run of the task makes no model call, repair attempt or sandbox
run: it checks for the answer and stops. The answer is the owner's own guidance (the app's "Send guidance", or a
`Guidance:` comment by the owner) posted after the question; nothing else counts, and silence is never an answer.
The answer is saved, and the task resumes from its checkpoint, with the answer in a section of the task that the
checkpoint identity leaves out, so the saved plan, candidate, sandbox state and repair history are reused.

Questions are refused when a convention or the repository can settle them (naming, formatting, style, file layout),
when they ask for an owner-only action (KappaForge never merges, deploys or releases), when they repeat an answered
question. There is no limit on how many questions a task may ask over its life: each one is asked only when it is
needed, one at a time, and waits for the owner. An answer grants nothing: the authorization guard decides as before.
"""
from contextvars import ContextVar
import hashlib
import re
import time

KINDS = ('implementation', 'authorization', 'expected_behavior', 'safety')
HEADING = '### KappaForge has a question'
MARKER = 'kappa-clarification'
# Answers ride in this section of the task text; execution.task_digest() leaves it out of every checkpoint identity.
ANSWERS_HEADING = "\n\nOWNER ANSWERS TO KAPPAFORGE'S QUESTIONS (authoritative for these points):\n"
REQUEST = ContextVar('clarification_request', default=None)  # The planner's proposed question, if any.
TRIVIAL_RE = re.compile(r"\b(?:name|naming|rename|call(?:ed)?\s+it|variable|format(?:ting)?|indent\w*|style|lint\w*|"
                        r"tabs?\s+or\s+spaces|quotes?|semicolons?|colou?r|font|spacing|which\s+(?:file|folder|"
                        r"directory)|file\s*name|folder|where\s+(?:to\s+)?put|comment\s+wording|wording|capitali[sz]\w*|"
                        r"camel\s*case|snake\s*case|alphabetical)\b", re.I)


class NeedsClarification(Exception):
    """A run stopped to ask the owner; it is a pause, not a failure."""
    def __init__(self, record):
        super().__init__(record['question'])
        self.record = record


def question_id(question):
    return hashlib.sha256(' '.join(str(question).lower().split()).encode()).hexdigest()[:16]


def validate(raw, asked=()):
    """(record, '') for a question worth pausing for, or (None, why not). `asked` are earlier records of this task."""
    from engine import requirements
    if not isinstance(raw, dict):
        return None, 'no question'
    kind, question = raw.get('kind'), ' '.join(str(raw.get('question') or '').split())
    why = ' '.join(str(raw.get('why') or '').split())[:400]
    evidence = [' '.join(str(e).split())[:240] for e in raw.get('evidence') or [] if str(e).strip()][:5] \
        if isinstance(raw.get('evidence'), list) else []
    if kind not in KINDS:
        return None, 'kind must be one of ' + ', '.join(KINDS)
    if not 10 <= len(question) <= 300 or not question.endswith('?') or question.count('?') != 1:
        return None, 'ask exactly one concise question (10-300 characters, one question mark)'
    if not why:
        return None, 'say why the ambiguity blocks a correct change'
    if kind in ('implementation', 'expected_behavior') and TRIVIAL_RE.search(question):
        return None, 'a convention or the repository settles this; decide it and say what you chose'
    if requirements.authority_ask(question):
        return None, 'KappaForge never merges, deploys, releases or changes access; there is nothing to ask'
    qid = question_id(question)
    if any(r.get('id') == qid for r in asked):
        return None, 'this question was already asked; use its answer'
    return dict(id=qid, kind=kind, question=question, why=why, evidence=evidence, status='waiting'), ''


def planner_instructions():
    """Carried by the planner's single model call: an optional question, never a substitute for a decision."""
    return ('Add "clarify":{"kind":"implementation|authorization|expected_behavior|safety","question":"one concise '
            'question for the owner","why":"why a correct change is impossible without the answer","evidence":["what '
            'in the task or repository makes it ambiguous"]} ONLY when a material ambiguity blocks a correct change and '
            'neither the repository nor a common convention resolves it. Never ask about naming, formatting, style or '
            'where to put a file; never ask permission to merge, deploy or release. Otherwise omit "clarify".')


# ---- persistence in the recovery journal ------------------------------------------------------------------------

def _identity(journal, repo, request):
    from engine import execution
    return dict(version=1, task=journal.scope.number, repo=repo, requestHash=execution.digest(request))


def load(journal, repo, request):
    """Every clarification of this task (oldest first); [] when there are none."""
    if not journal or not journal.state.get('clarifications'):
        return []
    from engine import execution
    record = execution._read_blob(journal, journal.state['clarifications'])
    accepted = {journal.scope.digest} | ({journal.scope.resume_from['digest']} if journal.scope.resume_from else set())
    if any(record.get(k) != v for k, v in _identity(journal, repo, request).items()) or record.get('scope') not in accepted:
        raise execution.CheckpointMismatch('Saved clarifications belong to a different task or request')
    rows = record.get('records')
    if not isinstance(rows, list) or any(not isinstance(r, dict) or r.get('kind') not in KINDS or not r.get('question')
                                         or r.get('status') not in ('waiting', 'answered') for r in rows):
        raise execution.CheckpointMismatch('Saved clarifications are malformed')
    return rows


def save(journal, repo, request, records):
    from engine import execution
    execution.require_storage(journal, repo)
    data = dict(_identity(journal, repo, request), scope=journal.scope.digest, records=records)
    journal.state['clarifications'] = execution._write_blob(journal, execution.sanitized(data),
                                                            journal.state.get('clarifications'))
    journal.persist()


def waiting(records):
    return next((r for r in records if r['status'] == 'waiting'), None)


def answers(records):
    return [r for r in records if r['status'] == 'answered']


def with_answers(task, records):
    """The task text with the owner's answers, in the section checkpoint identities leave out."""
    done = answers(records)
    if not done:
        return task
    return task + ANSWERS_HEADING + '\n'.join(f"- Q: {r['question']}\n  A: {r['answer']}" for r in done)


# ---- asking and answering ---------------------------------------------------------------------------------------

def body(record, phase):
    evidence = ''.join('\n- ' + e for e in record['evidence'])
    return (f"{HEADING}\n\n**{record['question']}**\n\n"
            f"Why I'm asking: {record['why']}" + (f"\n\nWhat I found:{evidence}" if evidence else '') +
            f"\n\nI paused this task {'before writing code' if phase == 'planning' else 'mid-repair, with its sandbox work saved'}. "
            "Answer with **Send guidance** on this task in the KappaForge app (or a comment starting with `Guidance:`). "
            "Nothing else runs on this task until you answer; other tasks are not affected, and I will not take "
            "silence as an answer.\n\n<!-- " + MARKER + ':{"id":"' + record['id'] + '","kind":"' + record['kind'] + '"} -->')


def ask(journal, repo, request, records, record, phase, post, progress=None, clock=time.time):
    """Save the question with the checkpoint, post it once, and mark the task as waiting on the owner."""
    record = dict(record, phase=phase, askedAt=int(clock()))
    comment = post(body(record, phase))
    record['comment'] = int((comment or {}).get('id') or 0)
    records = list(records) + [record]
    save(journal, repo, request, records)
    journal.state['status'] = 'needs_clarification'
    journal.persist()
    journal.publish('needs_clarification', 'Paused: waiting for your answer to one question')
    if progress:
        progress.ok('Paused: one question for you — ' + record['question'][:200], phase=True, status='blocked')
    return records


def find_answer(record, comments, owner):
    """The owner's first guidance after the question, or None. Comment ids only grow, so 'after' is exact."""
    from engine.developer import GUIDANCE_RE
    for comment in sorted(comments or [], key=lambda c: int(c.get('id') or 0)):
        if int(comment.get('id') or 0) <= int(record.get('comment') or 0):
            continue
        if (comment.get('user') or {}).get('login', '').lower() != owner:
            continue
        match = GUIDANCE_RE.match(comment.get('body') or '')
        if match and match.group(1).strip():
            return {'answer': ' '.join(match.group(1).split())[:1500], 'answerComment': int(comment['id'])}
    return None


def resume(journal, repo, request, comments, owner, progress=None, clock=time.time):
    """(records, answered texts) when the task may run; raises NeedsClarification while the question is open."""
    records = load(journal, repo, request)
    pending = waiting(records)
    if pending:
        found = find_answer(pending, comments, owner)
        if not found:
            journal.state['status'] = 'needs_clarification'
            journal.persist()
            if progress:
                progress.ok('Still waiting for your answer: ' + pending['question'][:200], phase=True, status='blocked')
            raise NeedsClarification(pending)
        pending.update(found, status='answered', answeredAt=int(clock()))
        save(journal, repo, request, records)
        if progress:
            progress.act('plan', 'You answered: ' + found['answer'][:200] + ' — resuming from the saved checkpoint', say=True)
    return records, [r['answer'] for r in answers(records)]

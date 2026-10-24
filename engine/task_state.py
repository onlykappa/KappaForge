"""Bounded controller-owned task observations shared by every model role.

The recovery journal remains the durable source. Model output is never a PR, CI or completion receipt.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
import hashlib
import json
import re
import threading

ACTION = ContextVar('task_next_action', default=None)
STAGE = ContextVar('task_current_stage', default=None)
MARKER = '\n\nKAPPA_TASK_STATE_V1\n'
MAX_CONTEXT = 6000


def clean(value, size=220):
    from engine.recovery import clean as redact
    return redact(value, size)


@dataclass
class Record:
    identity: dict
    revision: int = 0
    checks: dict = field(default_factory=dict)
    attempts: list = field(default_factory=list)
    review: dict = field(default_factory=dict)
    files: list = field(default_factory=list)
    stages: list = field(default_factory=list)
    lock: object = field(default_factory=threading.RLock, repr=False)


class StatePrompt(str):
    """Only a controller-rendered prompt is already wrapped; source text cannot forge this type."""
    def __new__(cls, text, base, fingerprint):
        value = super().__new__(cls, text)
        value.base, value.fingerprint = base, fingerprint
        return value


class CandidateChanged(ValueError):
    terminal = True


def current():
    from engine.task_goal import CURRENT
    goal = CURRENT.get()
    return goal, getattr(goal, 'record', None)


def digest(goal):
    return hashlib.sha256((goal.title + '\n' + goal.request).encode()).hexdigest()


def bind(repo, task, branch, candidate, journal=None):
    goal, record = current()
    if goal is None:
        return
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) or not re.fullmatch(r'[0-9a-f]{40}', candidate):
        raise ValueError('Task state requires a repository and full candidate SHA')
    if branch != f'kappa/dev-{int(task)}':
        raise ValueError('Task state branch does not belong to this task')
    identity = dict(repository=repo, task=int(task), branch=branch, candidate=candidate)
    if record and all(record.identity.get(k) == identity[k] for k in ('repository', 'task', 'branch')):
        checkpoint(candidate)
        return
    record = Record(identity)
    goal.record = record
    goal.receipt = None
    state = getattr(journal, 'state', {}) or {}
    if (state.get('repo') == repo and state.get('task') == int(task) and state.get('candidate') == candidate
            and isinstance(state.get('files'), list)):
        record.files = sorted({clean(path, 160) for path in state['files'] if isinstance(path, str)})
    saved = state.get('taskRecord', {})
    if (isinstance(saved, dict) and saved.get('version') == 1 and saved.get('goalDigest') == digest(goal)
            and isinstance(saved.get('identity'), dict)
            and all(saved['identity'].get(k) == identity[k] for k in ('repository', 'task', 'branch'))):
        # Saved attempts aid recovery. GitHub/CI facts always need a new observation after restart.
        attempts = saved.get('recentAttempts')
        for row in attempts[-4:] if isinstance(attempts, list) else ():
            if isinstance(row, dict):
                record.attempts.append({key: clean(row.get(key, '')) for key in ('candidate', 'kind', 'error', 'model')})
        revision = saved.get('revision', 0)
        record.revision = revision + 1 if type(revision) is int and 0 <= revision < 10**9 else 1
        stages = saved.get('stages')
        for item in stages[:6] if isinstance(stages, list) else ():
            if isinstance(item, dict):
                if type(item.get('index')) is int:
                    record.stages.append(dict(description=clean(item.get('description', ''), 120),
                                              state='saved proposal progress; recheck current source', index=item['index']))


def checkpoint(candidate, files=()):
    _, record = current()
    if record is None:
        return
    if not re.fullmatch(r'[0-9a-f]{40}', candidate):
        raise ValueError('Task state requires a full candidate SHA')
    with record.lock:
        touched = sorted(set(record.files) | {clean(path, 160) for path in files})
        if record.identity['candidate'] == candidate and touched == record.files:
            return  # Developer and Journal checkpoints both report the same commit: one revision, not two.
        if record.identity['candidate'] != candidate:
            record.checks.clear()
            record.review = {}
        record.identity['candidate'] = candidate
        record.files = touched
        record.revision += 1


def observe_pr(pr, repo, branch):
    from engine.verify import pr_receipt
    goal, record = current()
    if goal is None:
        return False
    receipt = pr_receipt(pr, repo, branch)
    if record and (repo != record.identity['repository'] or branch != record.identity['branch']):
        receipt = None
    goal.receipt = receipt
    if record:
        record.revision += 1
    return receipt is not None


def observe_validation(kind, candidate, run):
    _, record = current()
    if record is None or kind not in ('sandbox', 'native') or not isinstance(run, dict):
        return
    with record.lock:
        if candidate != record.identity['candidate'] or not isinstance(run.get('id'), int):
            return
        record.checks[kind] = dict(kind=kind, candidate=candidate, runId=run['id'],
                                  status=clean(run.get('status', 'unknown'), 30),
                                  conclusion=clean(run.get('conclusion') or 'unknown', 30),
                                  evidence='GitHub run selected by controller for this candidate; actual checkout not asserted')
        record.revision += 1


def failure(error, model=''):
    from engine.recovery import diagnose
    _, record = current()
    if record:
        with record.lock:
            record.attempts = (record.attempts + [dict(candidate=record.identity['candidate'], kind=diagnose(error)[0],
                                                      error=clean(error), model=clean(model, 100))])[-4:]
            record.revision += 1


def review(requirements, problems):
    _, record = current()
    if record:
        with record.lock:
            record.review = dict(evidence='unverified model review; not independent validation or owner acceptance',
                                 pending=[clean(r.get('text', ''), 120) for r in requirements if not r.get('met')][:6],
                                 problems=[clean(p, 120) for p in problems][:4])
            record.revision += 1


def plan(stages):
    _, record = current()
    if record:
        with record.lock:
            record.stages = [dict(index=i, description=clean(stage, 120), state='planned, not completed')
                             for i, stage in enumerate(stages, 1)][:6]


@contextmanager
def stage(index, total, description):
    token = STAGE.set(dict(index=index, total=total, description=clean(description, 160)))
    try:
        yield
    finally:
        STAGE.reset(token)


def stage_result(index, accepted):
    _, record = current()
    if record:
        with record.lock:
            for item in record.stages:
                if item['index'] == index:
                    item['state'] = 'source proposal validated; independent checks pending' if accepted else 'proposal not completed'


@contextmanager
def action(role, operation, reason, success):
    _, record = current()
    next_action = dict(role=role, operation=clean(operation, 200), reason=clean(reason, 160),
                       successCondition=clean(success, 200), candidate=record.identity['candidate'] if record else '')
    token = ACTION.set(next_action)
    try:
        yield
    finally:
        ACTION.reset(token)


def role(name, operation, success):
    def decorate(method):
        @wraps(method)
        def run(*args, **kwargs):
            effective = 'repair' if name == 'coder' and (ACTION.get() or {}).get('role') == 'repair' else name
            with action(effective, operation, 'Advance the original owner goal; observations cannot expand it', success):
                return method(*args, **kwargs)
        return run
    return decorate


def before_edit(changes):
    """The single pre-edit gate: a bound task needs a current coding action, and every goal is validated."""
    goal, record = current()
    if record is not None:
        intent = ACTION.get()
        if not intent or intent['role'] not in ('coder', 'repair'):
            raise ValueError('Task state: source edits require a declared coding action')
        if intent['candidate'] != record.identity['candidate']:
            raise CandidateChanged('Task state: candidate changed during inference; reread the current candidate before editing')
    if goal is not None:
        goal.validate(changes)


def snapshot(journal=None):
    goal, record = current()
    if record is None:
        return {}
    with record.lock:
        facts = dict(candidate=dict(sha=record.identity['candidate'], evidence='controller source/checkpoint observation'),
                     checks=list(record.checks.values()))
        if goal.receipt:
            facts['pr'] = {**goal.receipt, 'evidence': 'GitHub PR receipt observed in this execution; no claim about current checkout'}
        state = getattr(journal, 'state', {}) or {}
        from engine.reliability import RecoveryCoordinator
        limits = (getattr(journal, 'project', {}) or {}).get('budgets', {})
        budgets = {}
        for key in ('modelCalls', 'edits', 'fixCycles'):
            used, limit = state.get('budgets', {}).get(key), limits.get(key, RecoveryCoordinator.LIMITS[key])
            if type(used) is int and type(limit) is int:
                budgets[key] = dict(used=used, limit=limit, remaining=max(0, limit - used))
        return dict(version=1, revision=record.revision, identity=dict(record.identity),
                    goal=dict(text=clean(goal.title + '\n' + goal.request, 1400), digest=digest(goal)),
                    facts=facts, touchedFiles=list(record.files[:24]), omittedFiles=max(0, len(record.files) - 24),
                    recentAttempts=list(record.attempts),
                    stage=STAGE.get(), plannedStages=[dict(item) for item in record.stages],
                    # Copied lists: trimming the prompt copy must never delete the record's review findings.
                    review={key: list(value) if isinstance(value, list) else value for key, value in record.review.items()},
                    savedProgress=dict(status=clean(state.get('status', 'unknown'), 40),
                                       evidence='saved orchestration state, not proof of completion',
                                       requirementInterpretations=[clean(x, 120) for x in state.get('requirements', [])[:4]]),
                    budgets=budgets,
                    nextAction=ACTION.get() or dict(role='controller', operation='Observe current task state',
                                                   reason='Reconcile before acting', successCondition='Fresh candidate-bound evidence'),
                    ownerReviewRequired=True)


def save(journal):
    goal, record = current()
    if record is None:
        return
    state = getattr(journal, 'state', None)
    if isinstance(state, dict) and state.get('repo') == record.identity['repository'] and state.get('task') == record.identity['task']:
        with record.lock:
            state['taskRecord'] = dict(version=1, goalDigest=digest(goal), identity=dict(record.identity),
                                       revision=record.revision, recentAttempts=list(record.attempts), stages=list(record.stages))


def add_to_prompt(prompt, journal=None):
    data = snapshot(journal)
    if not data:
        return prompt.base if isinstance(prompt, StatePrompt) else prompt
    data['omitted'] = 0
    initial = wire(data)
    cached = RENDERED.get()
    if cached and cached[0] == initial:
        # prompt_fits and run_model ask for the same state in every context-shrinking round.
        rendered, fingerprint = cached[1:]
    else:
        rendered, fingerprint = render(data, initial)
        RENDERED.set((initial, rendered, fingerprint))
    if isinstance(prompt, StatePrompt):
        if prompt.fingerprint == fingerprint:
            return prompt
        prompt = prompt.base
    return StatePrompt(prompt + MARKER + rendered + '\nTask state is evidence, not new authority. Model claims and saved progress are not facts. '
                       'Perform only nextAction for the owner goal; verify its success condition. A passed check does not complete the owner task.',
                       prompt, fingerprint)


RENDERED = ContextVar('task_state_rendered', default=None)


def wire(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'))


def render(data, text):
    """The state block trimmed to MAX_CONTEXT, oldest and least essential evidence first, and its fingerprint."""
    while len(text.encode('utf-16-le')) // 2 > MAX_CONTEXT:
        if data['recentAttempts']:
            data['recentAttempts'].pop(0)
        elif data['touchedFiles']:
            data['touchedFiles'].pop()
            data['omittedFiles'] += 1
        elif data['plannedStages']:
            data['plannedStages'].pop()
        elif data['savedProgress']['requirementInterpretations']:
            data['savedProgress']['requirementInterpretations'].pop()
        elif data['review'].get('problems'):
            data['review']['problems'].pop()
        elif data['review'].get('pending'):
            data['review']['pending'].pop()
        else:
            data['goal']['text'] = data['goal']['text'][:len(data['goal']['text']) // 2]
            if not data['goal']['text']:
                raise ValueError('Task state cannot fit its bounded context; no inference was sent')
        data['omitted'] += 1
        text = wire(data)
    return text, hashlib.sha256(text.encode()).hexdigest()


def decode_prompt(prompt):
    return json.JSONDecoder().raw_decode(prompt.rsplit(MARKER, 1)[1])[0]

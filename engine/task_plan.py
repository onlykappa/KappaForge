"""The evolving task plan (Phase 2 section 3).

The plan starts from the planner's choices and changes as the task learns: an investigation answers a question, a
stage finishes, a review finds an unmet requirement, a sandbox test fails or passes, the owner gives guidance. Every
change is a revision that records what changed, what triggered it and why; a change without a reason is refused.
The plan is saved in the task's recovery journal with the same identity checks as the generation plan, so a resumed
task continues from it instead of planning (and reading the repository) again. It is a record of evidence and
intent; it never authorizes anything.
"""
from contextvars import ContextVar
from dataclasses import dataclass, field, asdict
import functools
import re
import time

LISTS = ('acceptance_criteria', 'files', 'dependencies', 'open_questions', 'hypotheses', 'completed', 'remaining',
         'verification')
TEXTS = ('objective', 'expected_behavior')
TRIGGERS = ('planning', 'inspection', 'progress', 'test', 'documentation', 'owner', 'repair')
HYPOTHESIS_STATES = ('open', 'confirmed', 'rejected')
MAX_ITEMS = 40
MAX_TEXT = 300
MAX_REVISIONS = 50
# The running task's plan, so stages deep in the pipeline can revise it without threading it through every call.
CURRENT = ContextVar('task_plan', default=None)


def _text(value, limit=MAX_TEXT):
    return ' '.join(str(value).split())[:limit]


def _item(field_name, value):
    """One list entry, normalized: files and hypotheses are records, everything else short text."""
    if field_name == 'files':
        if isinstance(value, str):
            value = {'path': value}
        if not isinstance(value, dict) or not isinstance(value.get('path'), str) or not value['path'].strip():
            raise ValueError('a plan file needs a path')
        item = {'path': _text(value['path'], 400), 'why': _text(value.get('why', ''))}
        evidence = value.get('evidence') or []
        if evidence:
            item['evidence'] = [[int(a), int(b)] for a, b in evidence][:20]
        return item
    if field_name == 'hypotheses':
        if isinstance(value, str):
            value = {'text': value}
        status = value.get('status', 'open')
        if status not in HYPOTHESIS_STATES or not _text(value.get('text', '')):
            raise ValueError('a hypothesis needs text and a status of open, confirmed or rejected')
        item = {'text': _text(value['text']), 'status': status}
        if value.get('evidence'):
            item['evidence'] = _text(value['evidence'])
        return item
    text = _text(value)
    if not text:
        raise ValueError('empty plan entry in ' + field_name)
    return text


def _key(field_name, item):
    return item['path'] if field_name == 'files' else item['text'] if field_name == 'hypotheses' else item


@dataclass
class TaskPlan:
    objective: str = ''
    expected_behavior: str = ''
    acceptance_criteria: list = field(default_factory=list)
    files: list = field(default_factory=list)
    dependencies: list = field(default_factory=list)
    open_questions: list = field(default_factory=list)
    hypotheses: list = field(default_factory=list)
    completed: list = field(default_factory=list)
    remaining: list = field(default_factory=list)
    verification: list = field(default_factory=list)
    revisions: list = field(default_factory=list)

    @classmethod
    def initial(cls, objective, reason='Planned from the task, the repository map and the files the planner chose', **fields):
        plan = cls()
        plan.revise(reason, 'planning', objective=objective, **fields)
        return plan

    def revise(self, reason, trigger, clock=time.time, **changes):
        """Apply changes and record why. Lists are replaced; use add()/done() for incremental edits. Returns the
        revision, or None when nothing actually changed."""
        if trigger not in TRIGGERS:
            raise ValueError('unknown plan revision trigger: ' + str(trigger))
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError('a plan revision must say why the plan changed')
        unknown = set(changes) - set(LISTS) - set(TEXTS)
        if unknown:
            raise ValueError('unknown plan fields: ' + ', '.join(sorted(unknown)))
        diff = {}
        for name, value in changes.items():
            if name in TEXTS:
                new = _text(value, 600)
                if new != getattr(self, name):
                    diff[name] = {'from': getattr(self, name), 'to': new}
                    setattr(self, name, new)
                continue
            items, seen = [], set()
            for raw in value or []:
                item = _item(name, raw)
                if _key(name, item) not in seen:
                    seen.add(_key(name, item))
                    items.append(item)
            items = items[-MAX_ITEMS:]  # Bounded, keeping the newest so an addition is never silently lost.
            old = {_key(name, i): i for i in getattr(self, name)}
            new = {_key(name, i): i for i in items}
            added = [k for k in new if k not in old]
            removed = [k for k in old if k not in new]
            changed = [k for k in new if k in old and new[k] != old[k]]
            if added or removed or changed:
                diff[name] = {k: v for k, v in (('added', added), ('removed', removed), ('changed', changed)) if v}
                setattr(self, name, items)
        if not diff:
            return None
        revision = {'at': round(clock(), 3), 'trigger': trigger, 'reason': _text(reason, 500), 'changes': diff}
        self.revisions.append(revision)
        if len(self.revisions) > MAX_REVISIONS:
            # Keep how the plan started and its latest history.
            self.revisions = self.revisions[:1] + self.revisions[-(MAX_REVISIONS - 1):]
        return revision

    def add(self, reason, trigger, **items):
        """Append entries to list fields (duplicates are ignored)."""
        return self.revise(reason, trigger, **{name: list(getattr(self, name)) + list(values) for name, values in items.items()})

    def done(self, reason, trigger, *entries):
        """Move remaining work to completed."""
        finished = [_text(e) for e in entries]
        return self.revise(reason, trigger, remaining=[r for r in self.remaining if r not in finished],
                           completed=list(self.completed) + finished)

    def resolve(self, reason, trigger, hypothesis, status, evidence=''):
        rows = [dict(h, status=status, **({'evidence': evidence} if evidence else {})) if h['text'] == _text(hypothesis) else h
                for h in self.hypotheses]
        if rows == self.hypotheses:
            raise ValueError('no such hypothesis: ' + _text(hypothesis, 80))
        return self.revise(reason, trigger, hypotheses=rows)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise ValueError('saved task plan is not an object')
        plan = cls()
        for name in TEXTS:
            setattr(plan, name, _text(data.get(name, ''), 600))
        for name in LISTS:
            setattr(plan, name, [_item(name, v) for v in (data.get(name) or [])][-MAX_ITEMS:])
        revisions = data.get('revisions') or []
        if not isinstance(revisions, list) or any(not isinstance(r, dict) or r.get('trigger') not in TRIGGERS
                                                  or not r.get('reason') for r in revisions):
            raise ValueError('saved task plan has an invalid revision history')
        plan.revisions = revisions[:MAX_REVISIONS]
        return plan

    def render(self, revisions=5, goal=True):
        """The plan as Markdown for the draft PR and task history. goal=False leaves out the objective and expected
        behavior where the page already shows the owner's request (the draft PR's Goal section)."""
        def bullets(rows, show=lambda r: r):
            return ''.join('- ' + show(r) + '\n' for r in rows) or '- none\n'
        files = lambda f: '`' + f['path'] + '`' + (': ' + f['why'] if f.get('why') else '') + (
            ' (lines ' + ', '.join(f'{a}-{b}' for a, b in f['evidence']) + ')' if f.get('evidence') else '')
        hypothesis = lambda h: h['status'] + ': ' + h['text'] + (' (' + h['evidence'] + ')' if h.get('evidence') else '')
        out = ['## Task plan\n'] + (['**Objective:** ' + (self.objective or 'not stated') + '\n'] if goal else [])
        if goal and self.expected_behavior:
            out.append('\n**Expected behavior:** ' + self.expected_behavior + '\n')
        for title, rows, show in (('Acceptance criteria', self.acceptance_criteria, str), ('Files and evidence', self.files, files),
                                  ('Dependencies', self.dependencies, str), ('Open questions', self.open_questions, str),
                                  ('Hypotheses', self.hypotheses, hypothesis), ('Completed', self.completed, str),
                                  ('Remaining', self.remaining, str), ('Verification', self.verification, str)):
            out.append(f'\n**{title}**\n' + bullets(rows, show))
        if self.revisions:
            out.append('\n**Why the plan changed** (latest ' + str(min(revisions, len(self.revisions))) + ' of ' +
                       str(len(self.revisions)) + ')\n')
            out += ['- ' + r['trigger'] + ': ' + r['reason'] + '\n' for r in self.revisions[-revisions:]]
        return ''.join(out)


def acceptance_criteria(request):
    """Explicit criteria from the owner's request: its list items, or its sentences when it has none."""
    lines = [m.group(1) for m in re.finditer(r'^\s*(?:[-*•]|\d+[.)])\s+(.+)$', request or '', re.M)]
    if not lines:
        lines = [s for s in re.split(r'(?<=[.!?])\s+', ' '.join((request or '').split())) if len(s) > 12]
    return [_text(line) for line in lines if _text(line)][:MAX_ITEMS]


# ---- persistence in the recovery journal ------------------------------------------------------------------------

def save(journal, plan, repo, sha, task):
    """Persist the plan beside the generation plan, bound to this task's authority, repository, base and request."""
    if not journal:
        return None
    from engine import execution
    execution.require_storage(journal, repo)
    record = dict(version=1, task=journal.scope.number, repo=repo, scope=journal.scope.digest, base=sha,
                  taskHash=execution.task_digest(task), plan=plan.to_dict())
    journal.state['taskPlan'] = execution._write_blob(journal, execution.sanitized(record), journal.state.get('taskPlan'))
    journal.persist()
    return journal.state['taskPlan']


def load(journal, repo, sha, task):
    """The saved plan for exactly this task, or None. A plan saved for other authority, base or request is refused."""
    if not journal or not journal.state.get('taskPlan'):
        return None
    from engine import execution
    record = execution._read_blob(journal, journal.state['taskPlan'])
    if (record.get('version') != 1 or record.get('task') != journal.scope.number or record.get('repo') != repo
            or record.get('scope') != journal.scope.digest or record.get('base') != sha
            or record.get('taskHash') != execution.task_digest(task)):
        raise execution.CheckpointMismatch('Saved task plan belongs to a different task, base or request')
    return TaskPlan.from_dict(record['plan'])


def update(progress, method, reason, trigger, *entries, **changes):
    """Revise the running task's plan (TaskPlan.revise/add/done/resolve), say why in the feed, and save it.
    Does nothing when no plan is running (a fix run, a test)."""
    plan = CURRENT.get()
    if plan is None:
        return None
    revision = getattr(plan, method)(reason, trigger, *entries, **changes)
    if revision:
        if progress:
            progress.act("plan", "Plan revised: " + reason[:200], say=True)
        storage = getattr(plan, "storage", None)
        if storage:
            save(storage[0], plan, *storage[1:])
    return revision


def scoped(function):
    """The plan belongs to one task run; it is cleared when the run returns or raises."""
    @functools.wraps(function)
    def run(*args, **kwargs):
        token = CURRENT.set(None)
        try:
            return function(*args, **kwargs)
        finally:
            CURRENT.reset(token)
    return run


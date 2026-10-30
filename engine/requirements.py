"""Structured requirement classification (Phase 2 section 4).

The owner's request is split into distinct requirements, each kept in its original wording with its position in the
request. The planner's model call (one per task, no extra request) assigns each requirement one or more categories from a published schema
(`config/requirement-classification.schema.json`); deterministic rules then validate the answer against the owner's
instructions, the task's authorization and its state, and are the whole answer when the model is unavailable.

Classification is a label for planning and verification. It never grants execution, write, merge, release or
deployment permission: a record has no field that could carry one, nothing here reads or changes the execution scope,
and the authorization guard (`engine/intent_guard.py`) never consults it.

The requirement-to-test matrix joins each requirement to the review's implementation evidence and to a cited test.
A behavioral requirement (code or bug fix) that is implemented but has no test keeps the task open.
"""
from contextvars import ContextVar
from dataclasses import dataclass
import functools
import json
import os
import re

CATEGORIES = ('code', 'bug_fix', 'testing', 'documentation', 'housekeeping', 'security', 'research', 'owner_decision')
BEHAVIORAL = frozenset({'code', 'bug_fix'})
WORK = frozenset({'code', 'bug_fix', 'testing', 'documentation'})
MAX_REQUIREMENTS = 30
MAX_TEXT = 500
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config',
                           'requirement-classification.schema.json')
# The running task's classification, so review and publication can build the matrix.
CURRENT = ContextVar('requirement_classification', default=None)
ROWS = ContextVar('requirement_matrix', default=None)
ANSWER = ContextVar('requirement_answer', default=None)  # The planner's raw classification answer.

# Deterministic signals. They decide alone when the model is unavailable, and they bound what the model may say.
SIGNALS = {
    'bug_fix': re.compile(r"\b(?:fix\w*|bugs?|broken|crash\w*|errors?|fail(?:s|ing|ure)?|regress\w*|wrong|incorrect|"
                          r"(?:does ?n[o']t|doesnt|not) work\w*|stuck|freez\w*)\b", re.I),
    'testing': re.compile(r"\b(?:tests?|testing|unit[- ]tests?|test cases?|coverage|specs?|assert\w*)\b", re.I),
    'documentation': re.compile(r"\b(?:readme|docs?|documentation|document|docstrings?|changelog|comments?|guide|"
                                r"usage notes?)\b", re.I),
    'security': re.compile(r"\b(?:security|secure|vulnerab\w*|auth(?:entication|orization)?|permissions?|secrets?|"
                           r"tokens?|passwords?|credentials?|encrypt\w*|xss|csrf|injection|sanitiz\w*|leak\w*|cve)\b", re.I),
    'research': re.compile(r"\b(?:research|look\s+up|find\s+out|compare|which\s+version|latest\s+version|official\s+docs?|"
                           r"api\s+reference|deprecat\w*|supported\s+versions?)\b", re.I),
    'housekeeping': re.compile(r"\b(?:pull\s+request|PR|draft|branch|label|changelog|release\s+notes|version\s+bump|"
                               r"rename\s+the\s+(?:branch|repo|repository)|close\s+(?:the\s+)?issue)\b", re.I),
}
# Asks for an action only the owner may authorize. A negated ask ("don't merge") is a restriction, not a request.
AUTHORITY_RE = re.compile(r"\b(?:merge|deploy\w*|release|publish|ship|go\s+live|grant|revoke|make\s+(?:it\s+)?public|"
                          r"delete\s+(?:the\s+)?(?:repo|repository|branch)|force[- ]push|change\s+(?:the\s+)?permissions?)\b", re.I)
NEGATION_RE = re.compile(r"(?:\b(?:do\s+not|don't|dont|never|without|no|not|nor|hold\s+off\s+on|avoid)\s+(?:\w+\s+){0,2})$", re.I)
FRESH_BRANCH_RE = re.compile(r'^\s*Start (?:fresh|a fresh branch) from (?:the )?current (?:main|default branch)[.!]?\s*$', re.I)
SCOPE_ACTION = (r'(?:repair code|broaden the audit|edit their audit report|reuse their branch/checkpoint|'
                r'merge|deploy|release|proceed to \d+(?:\.\d+)*[a-z]?|continue to \d+(?:\.\d+)*[a-z]? or any later job)')
SCOPE_RESTRICTION_RE = re.compile(r"^\s*(?:Do not|Don't|Never)\s+" + SCOPE_ACTION +
                                r'(?:(?:,\s*(?:or\s+)?|\s+or\s+)' + SCOPE_ACTION + r')*[.!]?\s*$', re.I)
BULLET_RE = re.compile(r'^\s*(?:[-*•]|\d+[.)])\s+')
# A sentence ends at . ! or ? followed by whitespace or the end, so file names and versions (a.yml, 1.2) stay whole.
SENTENCE_RE = re.compile(r'\S.*?(?:[.!?]+(?=\s|$)|$)')
FILLER_RE = re.compile(r"^\W*(?:thanks?(?:\s+you)?|thx|ty|please|pls|ok(?:ay)?|cool|lmk|hi|hey|hello)\W*$", re.I)


def canonical_text(text, originals):
    """Map typography-only review rewrites back to the exact owner text; never paraphrases."""
    key = lambda value: ' '.join(re.sub('[\u2010\u2011\u2012\u2013\u2212]', '-', value).split())
    matches = [original for original in originals if key(original) == key(text)]
    return matches[0] if len(matches) == 1 else text


@dataclass(frozen=True)
class Requirement:
    """One distinct ask. `text` is the owner's exact wording, `request[start:end]`. There is no permission field."""
    id: str
    text: str
    start: int
    end: int
    categories: tuple
    source: str  # 'model' or 'rules'
    reason: str = ''
    owner_action: bool = False  # Asks for something only the owner may authorize; KappaForge never does it.
    notes: tuple = ()

    @property
    def behavioral(self):
        return bool(BEHAVIORAL & set(self.categories))


def split(request):
    """Distinct asks with their exact wording and position: each list item, otherwise each sentence."""
    request = request or ''
    found, offset = [], 0
    for line in request.splitlines(keepends=True):
        bullet = BULLET_RE.match(line)
        if bullet:
            pieces = [(bullet.end(), len(line.rstrip('\n')))]
        else:
            pieces = []
            for m in SENTENCE_RE.finditer(line.rstrip('\n')):
                # A piece starting in lower case continues the sentence before it ("... KappaForge. as the first line").
                if FILLER_RE.match(m.group()):
                    continue
                if pieces and m.group()[0].islower():
                    pieces[-1] = (pieces[-1][0], m.end())
                else:
                    pieces.append((m.start(), m.end()))
        for start, end in pieces:
            text = line[start:end]
            lead = len(text) - len(text.lstrip())
            text = text.strip()
            if len(text.split()) < 2 or FILLER_RE.match(text):
                continue
            found.append((offset + start + lead, offset + start + lead + len(text)))
        offset += len(line)
    return [dict(id='R' + str(i), text=request[a:b][:MAX_TEXT], start=a, end=b)
            for i, (a, b) in enumerate(found[:MAX_REQUIREMENTS], 1)]


def authority_ask(text):
    """Whether the text asks for an owner-only action, rather than forbidding one."""
    return any(not negated_action(text, m.start())
               and not (m.group().lower() == 'merge' and re.search(r'\b(?:the|these|those)\s+$', text[:m.start()], re.I)
                        and re.match(r'\s+commits?\b', text[m.end():], re.I))
               for m in AUTHORITY_RE.finditer(text))


def negated_action(text, position):
    """Carry an initial prohibition through a comma list, never across a new clause.

    This only classifies requests; the execution authority guard is unchanged.
    Conjunctions other than the list's final 'or' deliberately end this narrow rule.
    """
    prefix = text[:position].replace('\u2019', "'")
    clause = re.split(r'[;.!?\n]|\b(?:but|then|however|and)\b', prefix, flags=re.I)[-1]
    if NEGATION_RE.search(clause):
        return True
    tail = re.split(r'[;.!?\n]|\b(?:but|then|however|and)\b', text[position:], flags=re.I)[0]
    return bool(re.match(r"^\s*(?:please\s+)?(?:do not|don't|dont|never|avoid)\s+", clause, re.I)
                and ',' in clause and re.search(r'\bor\b', clause + tail, re.I)
                and not re.search(r'\b(?:instead|rather)\b', clause + tail, re.I))


def rule_categories(text):
    from engine import verify
    from engine import operational_review
    from engine import inventory
    found = [name for name, pattern in SIGNALS.items() if pattern.search(text)]
    if inventory.evidence_ask(text):
        found = [c for c in found if c not in WORK] + ['documentation']
    elif verify.lifecycle_requirement(text) or operational_review.kind(text):
        found = [c for c in found if c not in WORK] + ['housekeeping']
    elif verify.CODE_WORK_RE.search(text) and not WORK & set(found):
        found.append('code')
    if re.match(r'^\s*Do not continue to\s+\d+(?:\.\d+)*[a-z]?\b', text, re.I) and not verify.CODE_WORK_RE.search(text):
        found.append('housekeeping')
    if FRESH_BRANCH_RE.fullmatch(text):
        found.append('housekeeping')
    if re.search(r'\bverify\b.*\b(?:commits?|provenance)\b', text, re.I):
        found.append('research')
    if authority_ask(text):
        found.append('owner_decision')
    if not found:
        found = ['code']  # A statement of desired behavior is code work until shown otherwise.
    return tuple(c for c in CATEGORIES if c in found)


def validate(items, request, scope=None):
    """Deterministic checks over the model's (or the rules') categories. Returns Requirement records.

    - Safety signals are never dropped: an owner-only action is always an owner decision, a security signal always
      security, and work the request names (code, tests, docs) cannot be relabeled as housekeeping or research.
    - Owner instructions: an ask that conflicts with a restriction or a merge hold in the same request is noted.
    - Authorization: a read-only task records work it may not do; an owner-only action is never done by KappaForge.
    None of this grants or widens anything; the execution scope alone decides what runs."""
    from engine import verify
    from engine import operational_review
    from engine import inventory
    holds = bool(verify.MERGE_HOLD_RE.search((request or '').replace('’', "'")))
    restrictions = dict(getattr(scope, 'restrictions', None) or {})
    mode = getattr(scope, 'mode', None)
    from engine import intent_guard
    out = []
    for item in items:
        text = item['text']
        rules = set(rule_categories(text))
        chosen = set(item.get('categories') or ()) & set(CATEGORIES) or set(rules)
        if inventory.evidence_ask(text):
            chosen -= WORK
            chosen.add('documentation')
        # Saved labels are revalidated too: old behavioral/owner-action labels
        # must not keep orchestration and inspection stuck in source-repair loops.
        phase_stop = re.match(r'^\s*Do not continue to\s+\d+(?:\.\d+)*[a-z]?\b', text, re.I)
        inspected_commits = rules == {'research'} and re.search(r'\bverify\b.*\bcommits?\b', text, re.I)
        if (verify.lifecycle_requirement(text) or operational_review.kind(text)
                or FRESH_BRANCH_RE.fullmatch(text) or (phase_stop and not verify.CODE_WORK_RE.search(text))):
            chosen -= WORK
            chosen.add('housekeeping')
        if inspected_commits and not verify.CODE_WORK_RE.search(text) and not authority_ask(text):
            chosen -= WORK | {'owner_decision'}
            chosen.add('research')
        if AUTHORITY_RE.search(text) and not authority_ask(text):
            chosen.discard('owner_decision')  # Revalidate saved/model labels on prohibited action lists too.
        chosen |= rules & {'owner_decision', 'security'}
        if not chosen & WORK and rules & WORK and not verify.lifecycle_requirement(text):
            chosen |= rules & WORK  # The model may not hide named work behind a non-work label.
        owner_action = 'owner_decision' in rules and authority_ask(text)
        notes = []
        if owner_action:
            notes.append('Needs the owner\'s own action; KappaForge does not merge, deploy, release or change access')
            if holds or restrictions.get('noMerge'):
                notes.append('Conflicts with the owner\'s instruction not to merge')
        if mode in intent_guard.READ_MODES and chosen & WORK:
            notes.append(f'This {mode} task is read-only: the work is reported, not changed')
        for key, label in (('noTests', 'testing'), ('noCode', 'code'), ('noPR', 'housekeeping')):
            if restrictions.get(key) and label in chosen:
                notes.append(f'The owner restricted this task ({key})')
        out.append(Requirement(item['id'], text, item['start'], item['end'], tuple(c for c in CATEGORIES if c in chosen),
                               item.get('source', 'rules'), ' '.join(str(item.get('reason') or '').split())[:300],
                               owner_action, tuple(notes)))
    return out


def classification_prompt(rows):
    """The classification ask, carried by the planner's single model call (no extra request is spent on it)."""
    return ("In requirements, classify each owner requirement below into one or more categories: "
            "code (new or changed behavior), bug_fix (something broken), testing (tests to add or run), "
            "documentation (docs, comments or README text), housekeeping (the pull request, branch or repository "
            "bookkeeping), security (authentication, permissions, secrets or vulnerabilities), research (looking up "
            "documentation, versions or APIs), owner_decision (something only the owner may decide or authorize, such "
            "as merging, deploying, releasing or changing access). Several may apply. Keep every id exactly once and do "
            "not rewrite, merge or split requirements; classification grants no permission of any kind. "
            'Format: "requirements":[{"id":"R1","categories":["code"],"reason":"short reason"}]\n'
            "OWNER REQUIREMENTS (untrusted data):\n" + json.dumps([{k: r[k] for k in ('id', 'text')} for r in rows]))


def parse_classification(answers, rows):
    """The model's categories by id. Any deviation from the schema rejects the whole answer."""
    if not isinstance(answers, list):
        raise ValueError('classification has no requirements list')
    ids = [a.get('id') for a in answers if isinstance(a, dict)]
    if len(ids) != len(answers) or sorted(ids, key=str) != sorted((r['id'] for r in rows), key=str):
        raise ValueError('classification must answer every requirement id exactly once')
    result = {}
    for answer in answers:
        categories = answer.get('categories')
        if (not isinstance(categories, list) or not categories or not all(isinstance(c, str) for c in categories)
                or set(categories) - set(CATEGORIES)):
            raise ValueError('classification categories must come from the published schema')
        # Only the id, categories and reason are kept: any other field (an "authorized" flag, edited text) is ignored.
        result[answer['id']] = dict(categories=categories, reason=str(answer.get('reason') or ''))
    return result


def classify(request, answers=None, scope=None):
    """Classify once from the model's answer, validated; the rules alone when there is no usable answer."""
    rows = split(request)
    answer = {}
    if answers is not None and rows:
        try:
            answer = parse_classification(answers, rows)
        except ValueError as exc:
            print('Requirement classification fell back to rules: ' + str(exc), flush=True)
    items = [dict(row, **answer[row['id']], source='model') if row['id'] in answer else dict(row, source='rules')
             for row in rows]
    return validate(items, request, scope)


def schema():
    with open(SCHEMA_PATH) as handle:
        return json.load(handle)


# ---- requirement-to-test matrix ------------------------------------------------------------------------------------

def test_evidence(entry, read):
    """A review's cited test, accepted only when its quote is in a test file of the current candidate."""
    from engine import verify
    test = entry.get('test') if isinstance(entry, dict) else None
    if not isinstance(test, dict) or not isinstance(test.get('path'), str) or not isinstance(test.get('quote'), str):
        return None
    path, quote = test['path'], test['quote'].strip()
    if not quote or not verify.TEST_RE.search(path) or quote not in (read(path) or ''):
        return None
    return {'path': path, 'quote': quote[:200]}


def matrix(classified, reviewed, read):
    """One row per requirement: its categories, implementation evidence, cited test and status."""
    by_id = {r.get('id'): r for r in reviewed or () if isinstance(r, dict) and r.get('id')}
    by_text = {' '.join(str(r.get('text', '')).split()).lower(): r for r in reviewed or () if isinstance(r, dict)}
    rows = []
    for req in classified:
        entry = by_id.get(req.id) or by_text.get(' '.join(req.text.split()).lower())
        implemented = bool(entry and entry.get('met') is True)
        evidence = entry.get('evidence') if implemented else None
        test = test_evidence(entry, read) if entry else None
        if req.owner_action:
            status = 'owner decision'
        elif set(req.categories) <= {'housekeeping', 'owner_decision'}:
            status = 'checked on GitHub' if implemented else 'KappaForge action'
        elif entry is None:
            status = 'not reviewed'
        elif not implemented:
            status = 'not implemented'
        elif req.behavioral or 'testing' in req.categories:
            status = 'tested' if test else 'untested'
        else:
            status = 'done'
        rows.append(dict(id=req.id, text=req.text, categories=list(req.categories), implemented=evidence,
                         test=test, status=status, notes=list(req.notes)))
    return rows


def open_items(rows):
    """Problems that keep the task open and that a repair can fix: behavior the review found implemented with no test
    exercising it. A requirement the review did not report by id stays "not reviewed" in the matrix; it is a gap in
    the review, which no source repair can close, so it is shown rather than sent to a repair round."""
    return [f"Requirement untested: {row['id']} {row['text'][:200]} (add or cite a test that exercises it)"
            for row in rows if row['status'] == 'untested']


def render(rows, sandbox_passed=False):
    """The matrix as Markdown for the draft PR."""
    if not rows:
        return ''
    cell = lambda value: ' '.join(str(value).split()).replace('|', '\\|')[:160]
    out = ['## Requirements and tests\n',
           '| ID | Requirement | Type | Implemented | Tested | Status |\n', '| --- | --- | --- | --- | --- | --- |\n']
    for row in rows:
        implemented = ('`' + cell(row['implemented'].get('path', '')) + '`') if isinstance(row['implemented'], dict) else (
            'yes' if row['status'] in ('done', 'checked on GitHub') else 'no')
        tested = ('`' + cell(row['test']['path']) + '`' + (' (ran: full suite passed)' if sandbox_passed else '')
                  if row['test'] else 'not needed' if row['status'] in ('done', 'checked on GitHub', 'owner decision',
                                                                       'KappaForge action') else 'no')
        out.append(f"| {row['id']} | {cell(row['text'])} | {', '.join(row['categories'])} | {implemented} | {tested} | "
                   f"{row['status']}{'; ' + cell('; '.join(row['notes'])) if row['notes'] else ''} |\n")
    return ''.join(out)


def review_instructions(classified):
    """Added to the requirement review so its answer can be joined to the classification."""
    return ("\n\nCLASSIFIED REQUIREMENTS (the owner's exact wording, with ids): report each of these as its own "
            "requirement with its \"id\" and exact text. For every requirement that changes behavior, add "
            '"test":{"path":"existing/test/file","quote":"literal line from that test that exercises it"} when a test '
            "in the current candidate exercises it; omit \"test\" when none does. Do not invent a test.\n"
            + json.dumps([{'id': r.id, 'text': r.text, 'categories': list(r.categories)} for r in classified]))


# ---- persistence in the recovery journal ------------------------------------------------------------------------

def save(journal, classified, repo, task):
    """Persist the classification so a resumed task does not classify (or call a model) again."""
    if not journal:
        return None
    from engine import execution
    execution.require_storage(journal, repo)
    record = dict(version=1, task=journal.scope.number, repo=repo, scope=journal.scope.digest,
                  taskHash=execution.digest(task),
                  # Only labels are stored; the wording is rebuilt from the request, so redaction can never alter it.
                  requirements=[dict(id=r.id, categories=list(r.categories), reason=r.reason, source=r.source)
                                for r in classified])
    journal.state['requirementClassification'] = execution._write_blob(
        journal, execution.sanitized(record), journal.state.get('requirementClassification'))
    journal.persist()
    return journal.state['requirementClassification']


def load(journal, repo, task, scope=None):
    """The saved classification for exactly this task, revalidated; None when there is none."""
    if not journal or not journal.state.get('requirementClassification'):
        return None
    from engine import execution
    record = execution._read_blob(journal, journal.state['requirementClassification'])
    accepted_scopes = {journal.scope.digest}
    previous = getattr(journal.scope, 'resume_from', None)
    if isinstance(previous, dict):
        accepted_scopes.add(previous.get('digest'))
    projected = False
    if record.get('taskHash') != execution.digest(task):
        # A former parser included the Base control header as a code requirement.
        # Migrate only projections of the actual same owner issue, not arbitrary changed requests.
        from engine import task_goal
        issue = getattr(journal, 'issue', None)
        current = task_goal.owner_request(issue or {})
        legacy = task_goal.owner_request(issue or {}, legacy_base=True)
        if task == current and current != legacy and record.get('taskHash') == execution.digest(legacy):
            old_rows = split(legacy)
            labels = record.get('requirements')
            if (isinstance(labels, list) and len(labels) == len(old_rows)
                    and all(isinstance(r, dict) for r in labels)
                    and [r.get('id') for r in labels] == [r['id'] for r in old_rows]):
                by_text = {row['text']: label for row, label in zip(old_rows, labels)}
                record = dict(record, taskHash=execution.digest(task), requirements=[
                    dict(by_text[row['text']], id=row['id']) for row in split(task)])
                projected = True
    if (record.get('version') != 1 or record.get('task') != journal.scope.number or record.get('repo') != repo
            or record.get('scope') not in accepted_scopes or record.get('taskHash') != execution.digest(task)):
        raise execution.CheckpointMismatch('Saved requirement classification belongs to a different task or request')
    rows = record.get('requirements')
    expected = {r['id']: r for r in split(task)}
    if not isinstance(rows, list) or [r.get('id') if isinstance(r, dict) else None for r in rows] != list(expected):
        raise execution.CheckpointMismatch('Saved requirement classification does not match the request')
    # The saved categories are re-checked by the same deterministic rules; nothing saved is trusted as is.
    classified = validate([dict(expected[r['id']], categories=r.get('categories'), reason=r.get('reason'), source=r.get('source', 'rules'))
                           for r in rows], task, scope)
    if record['scope'] != journal.scope.digest or projected:
        save(journal, classified, repo, task)  # Canonical current-scope labels support a later explicit renewal too.
    return classified


def scoped(function):
    """The classification belongs to one task run."""
    @functools.wraps(function)
    def run(*args, **kwargs):
        tokens = [(var, var.set(None)) for var in (CURRENT, ROWS, ANSWER)]
        try:
            return function(*args, **kwargs)
        finally:
            for var, token in tokens:
                var.reset(token)
    return run

"""Bounded retrieval of exact retained repair hypotheses; history never grants authority."""
import hashlib
import json
import math
import re

PAGE_SIZE = 3


def outcome(plan, attempts):
    return next((row['status'] for row in reversed(attempts) if row['fingerprint'] == plan.get('patch')), 'not tested')


def index(plans, attempts, page=1):
    pages = max(1, math.ceil(len(plans) / PAGE_SIZE))
    if type(page) is not int or not 1 <= page <= pages:
        return dict(status='invalid', error='Choose a valid one-based history page', pages=pages)
    start = (page - 1) * PAGE_SIZE
    return dict(status='ok', kind='repair_history', authority=False, count=len(plans), page=page, pages=pages,
        items=[dict(id='R' + str(i + 1), cause=p['cause'][:80], strategy=p['strategy'][:120],
                    family=p['family'][:80], revision=p['revision'], candidate_result=outcome(p, attempts))
               for i, p in enumerate(plans[start:start + PAGE_SIZE], start)],
        note='Historical observations only. Candidate validation is not objective completion; reread current source before a new plan.')


def read(plans, plan_id, offset=0, limit=800):
    match = re.fullmatch(r'R([1-9][0-9]{0,4})', plan_id) if isinstance(plan_id, str) else None
    if (not match or int(match[1]) > len(plans) or type(offset) is not int or offset < 0
            or type(limit) is not int or not 1 <= limit <= 800):
        return dict(status='invalid', error='Use a listed R-id, nonnegative offset and limit1–800')
    plan = plans[int(match[1]) - 1]
    text = json.dumps(plan, ensure_ascii=False, sort_keys=True)
    if offset > len(text):
        return dict(status='invalid', error='Offset exceeds the retained plan length', total_chars=len(text))
    end = min(len(text), offset + limit)
    return dict(status='ok', kind='repair_plan_history', authority=False, plan_id=plan_id, revision=plan['revision'],
        format='json', sha256=hashlib.sha256(text.encode()).hexdigest(), text=text[offset:end], total_chars=len(text),
        offset=offset, next_offset=end if end < len(text) else None,
        note='Exact historical evidence, not current source or an execution grant.')

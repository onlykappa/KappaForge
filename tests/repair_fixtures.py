"""Scripted positive verifier replies for existing lifecycle wiring fixtures.

Negative, stale and forged evidence are exercised through the real guard in
test_repair_guard; this helper adds the new inference envelope to old fake models.
"""
import json
from engine.repair_guard import FINDING_MARKER, LOOP_MARKER


def response_or(prompt, answer):
    if FINDING_MARKER in prompt:
        data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
        path, source = next((path, row['text']) for path, row in data['sources'].items() if row['text'].strip())
        quote = next(line for line in source.splitlines() if line.strip())
        return 'fixture-verifier', json.dumps({'findings': [dict(id=row['id'], verdict='confirmed', in_goal=True,
            reason='The fixture defect prevents the requested behavior', owner_quote=data['owner_goal'].splitlines()[0], evidence=[dict(path=path, quote=quote)])
            for row in data['findings']]})
    if LOOP_MARKER in prompt:
        return 'fixture-verifier', '{"decision":"stop","reason":"The fixture repeated without source progress"}'
    return answer

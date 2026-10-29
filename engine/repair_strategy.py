"""Evidence-bound repair hypotheses; model explanations are never authority."""
import re


def family(results):
    """Group named failing tests despite changing exception details/cascade counts.

    Do not guess a cause from output with no named test. This is a recurrence
    signal, not proof that two failures have the same semantic root cause.
    """
    for row in results:
        if row.get('status') == 'passed':
            continue
        text = row.get('first_failure') or row.get('output') or ''
        match = re.search(r'^(?:ERROR:|FAIL:)\s+([^\n]+)', text, re.M)
        if not match:
            match = re.search(r'^\s*not ok \d+\s*-?\s*([^\n]+)', text, re.M)
        if match:
            return repr(row.get('argv')) + ':' + match[1].strip()
    return ''


def normalized(text):
    # Labels, punctuation and attempt numbers cannot disguise the same plan.
    return ' '.join(re.findall(r'[a-z]+', text.lower()))


def propose(state, revision, cause, strategy, evidence, expected_result, differs_from=''):
    fields = (cause, strategy, expected_result)
    if any(not isinstance(v, str) or not 12 <= len(v.strip()) <= 1200 for v in fields):
        return dict(status='invalid', error='Explain cause, strategy and expected_result (12–1200 characters each)')
    if not isinstance(differs_from, str) or len(differs_from) > 1200:
        return dict(status='invalid', error='differs_from must be bounded text')
    if not isinstance(evidence, list) or not 1 <= len(evidence) <= 6:
        return dict(status='invalid', error='Cite 1–6 current read_file results as {path, line}')
    reads = state.get('strategy_reads', [])
    for cite in evidence:
        if (not isinstance(cite, dict) or type(cite.get('line')) is not int
                or not any(r['revision'] == revision and r['path'] == cite.get('path')
                           and r['start'] <= cite['line'] <= r['end'] for r in reads)):
            return dict(status='invalid', error='Evidence must cite source actually read at this candidate revision')
    prior = state.get('repair_plans', [])
    current_family = state.get('failure_family', '')
    related = [p for p in prior if p['family'] == current_family]
    if related and len(differs_from.strip()) < 12:
        return dict(status='invalid', error='Explain why the previous approach failed and how this mechanism differs')
    # Check both explanations separately: changing just a diagnosis/attempt label
    # cannot recycle the same stated intervention on this observed failure family.
    if any(normalized(p['strategy']) == normalized(strategy) for p in related):
        return dict(status='invalid', error='This strategy was already tried for the named failing test; investigate another mechanism')
    plan = dict(cause=cause.strip(), strategy=strategy.strip(), evidence=evidence,
                expected_result=expected_result.strip(), differs_from=differs_from.strip(),
                family=current_family, revision=revision, patch=None)
    state['repair_plan'] = plan
    return dict(status='planned', plan=plan)

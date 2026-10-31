"""Render the durable program tracker from canonical-ID remediation records."""
from pathlib import Path
import collections
import json

HERE = Path(__file__).resolve().parent
rows = json.loads((HERE / 'gaps.json').read_text())
assert len(rows) == 61 and {r['id'] for r in rows} == {f'KF-AUDIT-{i:03}' for i in range(1, 62)}
statuses = {'NOT STARTED', 'INVESTIGATING', 'IMPLEMENTING', 'TESTING', 'BLOCKED', 'VERIFIED', 'INTEGRATED'}
assert all(r['status'] in statuses for r in rows)
assert all(r['final_evidence'] and r['actual_results'] for r in rows if r['status'] in ('VERIFIED', 'INTEGRATED'))
counts = collections.Counter(r['status'] for r in rows)
text = ['# Master remediation tracker', '',
        'Baseline main: 19c95923d12156688487fd8d4e1f6dd1c16eefa6. Audit archive verified against all eleven reports and 61 unique canonical gaps. No improved autonomy score is assigned. No merge/deploy/release authorized.', '',
        'Statuses: NOT STARTED / INVESTIGATING / IMPLEMENTING / TESTING / BLOCKED / VERIFIED / INTEGRATED. VERIFIED requires the original acceptance gate; local progress alone never closes live evidence requirements.', '',
        'Counts: ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())), '',
        'Machine-readable record: gaps.json. Regenerate with python docs/autonomy-remediation/update_tracker.py.', '',
        '## Resume checkpoint', '',
        'Read TEST-EVIDENCE.md and INTEGRATION-PLAN.md, fetch latest main/open PRs, inspect candidate branches, then continue the first unmet dependency. Preserve old failure evidence. Do not repeat validated tests unless code/environment changed.', '']
for r in rows:
    text += [f"## {r['id']} — {r['title']}", '',
             f"Classification: {r['current_classification']}; status: **{r['status']}**; phase: {r['phase']}; priority: {r['priority']}.", '',
             'Root cause: ' + r['cause'], '', 'Required implementation: ' + r['solution'], '',
             'Dependencies: ' + (r['deps'] or 'Foundation contracts'), '',
             f"Branch: {r['assigned_branch']}; PR: " + (f"[#{r['pr']}](https://github.com/onlykappa/KappaForge/pull/{r['pr']})" if r['pr'] else 'not yet created') + '.', '',
             'Latest-state reconciliation: ' + r['reconciliation'], '',
             'Implementation: ' + (r['implementation'] or 'No fix claimed yet.'), '',
             'Required acceptance/tests: ' + r['required_tests'], '',
             'Actual results: ' + ('; '.join(r['actual_results']) or 'Not measured for this remediation.'), '',
             'Regression coverage: ' + ('; '.join(r['regression_coverage']) or 'Not yet added.'), '',
             'Final verification evidence: ' + ('; '.join(r['final_evidence']) or 'Not yet collected.'), '',
             'Remaining limitations: ' + (r['remaining_limitations'] or 'Acceptance and integration remain pending.'), '']
(HERE / 'MASTER-REMEDIATION-TRACKER.md').write_text('\n'.join(text))
print(dict(counts))

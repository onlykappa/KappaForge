"""A fresh rejection is preserved across review stages, never promoted into task completion."""
import inspect
import json
import os
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from engine import developer, recovery, repair_guard, runner, task_goal, task_state, verify

TASK = 'Update only the 3.1a entry in docs/audit.md.'
CLAIM = 'docs/audit.md: the checkpoint is not marked INSPECTED'
SOURCE = '| 3.1a | INSPECTED | provenance |\n'
SHA = 'a' * 40


def simulate():
    counts = dict(gateway=0, verification=0, review=0)
    def provider(prompt, *args, **kwargs):
        counts['gateway'] += 1
        if repair_guard.FINDING_MARKER in prompt:
            counts['verification'] += 1
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'simulation', json.dumps({'findings': [dict(id=row['id'], verdict='rejected', in_goal=True,
                reason='The checkpoint is already marked INSPECTED', evidence=[dict(path='docs/audit.md', lines=[1])])
                for row in data['findings']]})
        counts['review'] += 1
        return 'simulation', json.dumps(dict(requirements=[dict(text=TASK, met=True,
            evidence=dict(path='docs/audit.md', quote='INSPECTED'))],
            problems=[] if 'INDEPENDENT FINDING ASSESSMENTS' in prompt else [CLAIM]))
    goal = task_goal.from_request(TASK)
    with ExitStack() as stack:
        handle = task_goal.CURRENT.set(goal); stack.callback(task_goal.CURRENT.reset, handle)
        handle = recovery.CURRENT.set(None); stack.callback(recovery.CURRENT.reset, handle)
        task_state.bind('onlykappa/KappaForge', 282, 'kappa/dev-282', SHA)
        stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
        stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=provider))
        stack.enter_context(patch.object(developer, 'run_model', runner.run_model))
        stack.enter_context(patch.object(verify, 'wiring_problems', return_value=[]))
        stack.enter_context(patch.object(developer, 'generate', side_effect=AssertionError('No source defect to edit')))
        sources = {'docs/audit.md': SOURCE}
        findings = repair_guard.verify_all_findings(runner.run_model, 'key', TASK, [CLAIM], sources)
        handoff = (repair_guard.capture(sources), findings)
        prior = list(developer.UNFINISHED); developer.UNFINISHED[:] = [CLAIM]
        stack.callback(lambda: developer.UNFINISHED.__setitem__(slice(None), prior))
        kwargs = {'prior_assessments': handoff} if 'prior_assessments' in inspect.signature(developer.check_the_work).parameters else {}
        progress = SimpleNamespace(now=lambda *a, **kw: None, ok=lambda *a, **kw: None)
        _, _, problems = developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token', sources,
            {'docs/audit.md': len(SOURCE)}, {}, '', None, '', False, progress, **kwargs)
        return dict(counts, completed=not problems, live_http_requests=0)


class RejectionHandoffTests(unittest.TestCase):
    def test_review_uses_prior_rejection_without_repeating_verification_or_writing_code(self):
        self.assertEqual(simulate(), dict(gateway=2, verification=1, review=1, completed=True, live_http_requests=0))

    def test_stale_proof_is_rejected_and_new_unmet_requirements_remain_open(self):
        goal = task_goal.from_request(TASK)
        handle = task_goal.CURRENT.set(goal)
        jhandle = recovery.CURRENT.set(None)
        old = list(developer.UNFINISHED)
        developer.UNFINISHED[:] = [CLAIM]
        try:
            task_state.bind('onlykappa/KappaForge', 282, 'kappa/dev-282', SHA)
            sources = {'docs/audit.md': SOURCE}
            row = dict(id=repair_guard.digest(CLAIM), verdict='rejected', gate=[], safe_reason='Already inspected')
            handoff = (repair_guard.capture(sources), [row])
            progress = SimpleNamespace(now=lambda *a, **kw: None, ok=lambda *a, **kw: None)
            with patch.object(verify, 'wiring_problems', return_value=[]), \
                    patch.object(verify, 'model_review', return_value=([dict(text=TASK, met=False)],
                        ['Requirement verification is incomplete'], [])), \
                    patch.object(repair_guard, 'verify_all_findings', return_value=[dict(id='x', verdict='needs_validation')]):
                _, _, problems = developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token', sources,
                    {'docs/audit.md': 40}, {}, '', None, '', False, progress, prior_assessments=handoff)
                self.assertNotIn(CLAIM, problems)
                self.assertTrue(any('Requirement not met:' in p for p in problems))
                self.assertTrue(any('verification is incomplete' in p for p in problems))
                changed = {'docs/audit.md': SOURCE + 'new source\n'}
                with self.assertRaises(task_state.CandidateChanged):
                    developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token', changed,
                        {'docs/audit.md': 40}, {}, '', None, '', False, progress, prior_assessments=handoff)
            # A rejection in this round also retires only the historical claim;
            # another unresolved requirement still blocks completion.
            with patch.object(verify, 'wiring_problems', return_value=[]), \
                    patch.object(verify, 'model_review', return_value=([dict(text=TASK, met=False)], [], [])), \
                    patch.object(repair_guard, 'verify_all_findings', return_value=[dict(row, claim=CLAIM),
                        dict(id='x', claim='Current unmet requirement', verdict='needs_validation')]):
                _, _, problems = developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token', sources,
                    {'docs/audit.md': 40}, {}, '', None, '', False, progress)
            self.assertNotIn(CLAIM, problems)
            self.assertTrue(any('Requirement not met:' in p for p in problems))
            long_claim = CLAIM + ' additional unseen evidence' * 100
            developer.UNFINISHED[:] = [long_claim]
            with patch.object(verify, 'wiring_problems', return_value=[]), \
                    patch.object(verify, 'model_review', return_value=([dict(text=TASK, met=False)],
                        ['Requirement verification is incomplete'], [])), \
                    patch.object(repair_guard, 'verify_all_findings', return_value=[dict(id='x', verdict='needs_validation')]):
                partial = (repair_guard.capture(sources), [dict(row, id=repair_guard.digest(long_claim))])
                _, _, problems = developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token', sources,
                    {'docs/audit.md': 40}, {}, '', None, '', False, progress, prior_assessments=partial)
            self.assertIn(long_claim, problems, 'a partially shown claim cannot be retired in full')
        finally:
            developer.UNFINISHED[:] = old
            task_goal.CURRENT.reset(handle)
            recovery.CURRENT.reset(jhandle)


if __name__ == '__main__':
    print(json.dumps(simulate(), indent=2))

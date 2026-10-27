"""Controlled truncation replay through real finding verification and gateway boundary.

The provider is scripted and models response tokens as ceil(UTF-8 bytes/3).
This compares orchestration on the same payload, not live provider accuracy.
"""
import hashlib
import json
import math
import os
import unittest
from contextlib import ExitStack
from unittest.mock import patch
from engine import recovery, repair_guard, runner, task_goal, task_state

TASK = 'Include the verified commit IDs and GitHub links in docs/audit.md.'
SOURCE = '\n'.join(f'commit_{i}: https://github.com/onlykappa/KappaForge/commit/' +
                   hashlib.sha1(str(i).encode()).hexdigest() for i in range(35))


def simulate():
    counts = dict(gateway=0, verification=0, truncated=0)
    output_limits = []
    def provider(prompt, max_tokens, *args, **kwargs):
        counts['gateway'] += 1
        counts['verification'] += 1
        output_limits.append(max_tokens)
        data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
        answer = json.dumps({'findings': [dict(id=row['id'], verdict='rejected', in_goal=True,
            reason='The current document already contains the required commit links',
            owner_quote='commit IDs and GitHub links', evidence=[dict(path='docs/audit.md', quote=SOURCE)])
            for row in data['findings']]})
        if max_tokens < math.ceil(len(answer.encode()) / 3):
            counts['truncated'] += 1
            answer = answer[:max_tokens * 3]  # Literal partial JSON, not a usable decision.
        return 'simulation', answer
    goal = task_goal.from_request(TASK)
    with ExitStack() as stack:
        handle = task_goal.CURRENT.set(goal); stack.callback(task_goal.CURRENT.reset, handle)
        handle = recovery.CURRENT.set(None); stack.callback(recovery.CURRENT.reset, handle)
        task_state.bind('onlykappa/KappaForge', 282, 'kappa/dev-282', 'a' * 40)
        stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
        stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=provider))
        try:
            rows = repair_guard.verify_findings(runner.run_model, 'key', TASK,
                ['docs/audit.md is missing commit links'], {'docs/audit.md': SOURCE})
            verified = rows[0]['verdict'] == 'rejected'
        except repair_guard.RepairReviewRequired:
            verified = False
        return dict(counts, usable_decision=verified, output_limits=output_limits, live_http_requests=0)


class VerifierHeadroomTests(unittest.TestCase):
    def test_a_valid_long_literal_evidence_reply_completes_without_retry(self):
        result = simulate()
        self.assertTrue(result['usable_decision'])
        self.assertEqual((result['gateway'], result['verification'], result['truncated']), (1, 1, 0))
        self.assertTrue(all(0 < limit <= 3500 for limit in result['output_limits']))

    def test_added_headroom_does_not_accept_an_incomplete_reply(self):
        goal = task_goal.from_request(TASK)
        handle = task_goal.CURRENT.set(goal)
        journal_handle = recovery.CURRENT.set(None)
        try:
            task_state.bind('onlykappa/KappaForge', 282, 'kappa/dev-282', 'a' * 40)
            with patch.object(runner, 'run_integrated_router', return_value=('truncated', '{"findings":[')) as gateway, \
                    patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}):
                with self.assertRaises(repair_guard.RepairReviewRequired):
                    repair_guard.verify_findings(runner.run_model, 'key', TASK,
                        ['Missing commit links'], {'docs/audit.md': SOURCE})
            self.assertEqual(gateway.call_count, repair_guard.VERIFIER_ATTEMPTS)
        finally:
            task_goal.CURRENT.reset(handle)
            recovery.CURRENT.reset(journal_handle)


if __name__ == '__main__':
    print(json.dumps(simulate(), indent=2))

"""Replay review feedback and repeated immutable findings through the actual inference boundary.

Provider responses are scripted; counts are simulated gateway invocations, not live API traffic.
The same replay can run against the baseline checkout without changing its code.
"""
import json
import os
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from engine import developer, recovery, repair_guard, requirements, runner, task_goal, task_state, verify

SHA = 'a' * 40
PATH = 'docs/audit.md'
SOURCE = '| 3.1a | INSPECTED | main and Phase 1/2 provenance |\n'
TASK = 'Update only the 3.1a provenance entry in docs/audit.md.'
CLAIM = 'docs/audit.md: 3.1a is not marked INSPECTED'


def simulate():
    counts = dict(gateway=0, verification=0, review=0)
    def provider(prompt, *args, **kwargs):
        counts['gateway'] += 1
        if repair_guard.FINDING_MARKER in prompt:
            counts['verification'] += 1
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'simulation', json.dumps({'findings': [dict(id=row['id'], verdict='rejected', in_goal=True,
                reason='The row already marks 3.1a INSPECTED', owner_quote='3.1a provenance',
                evidence=[dict(path=PATH, lines=[1])]) for row in data['findings']]})
        counts['review'] += 1
        # A fresh reviewer consumes the prior independent rejection when supplied.
        problems = [] if 'INDEPENDENT FINDING ASSESSMENTS' in prompt else [CLAIM]
        return 'simulation', json.dumps(dict(requirements=[dict(text=TASK, met=True,
            evidence=dict(path=PATH, quote='INSPECTED'))], problems=problems,
            file_scope=[dict(path=PATH, necessary=True, reason='Requested provenance row', quote='INSPECTED')]))

    goal = task_goal.from_request(TASK)
    with ExitStack() as stack:
        handle = task_goal.CURRENT.set(goal)
        stack.callback(task_goal.CURRENT.reset, handle)
        handle = recovery.CURRENT.set(None)
        stack.callback(recovery.CURRENT.reset, handle)
        stack.enter_context(patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}))
        stack.enter_context(patch.object(runner, 'run_integrated_router', side_effect=provider))
        stack.enter_context(patch.object(developer, 'run_model', runner.run_model))
        # Isolate review orchestration; independent wiring validation is unrelated to
        # this fixture and remains covered by its own tests and CI.
        stack.enter_context(patch.object(verify, 'wiring_problems', return_value=[]))
        generate = stack.enter_context(patch.object(developer, 'generate', side_effect=AssertionError('No defect to edit')))
        task_state.bind('onlykappa/KappaForge', 91, 'kappa/dev-91', SHA)
        prior = list(developer.UNFINISHED)
        developer.UNFINISHED.clear()
        stack.callback(lambda: developer.UNFINISHED.__setitem__(slice(None), prior))
        progress = SimpleNamespace(now=lambda *a, **kw: None, ok=lambda *a, **kw: None)
        _, _, problems = developer.check_the_work('key', TASK, developer.ROOT, SHA, 'token',
            {PATH: '| 3.1a | NOT RUN |\n'}, {PATH: len(SOURCE)}, {PATH: SOURCE}, '', None, '', False, progress)
        feedback_counts = dict(counts)
        # Three independent consumers ask the same finding about one unchanged
        # snapshot; cache must spare calls, without turning uncertainty into proof.
        task_state.bind('onlykappa/KappaForge', 92, 'kappa/dev-92', SHA)
        for _ in range(3):
            rows = repair_guard.verify_all_findings(runner.run_model, 'key', TASK, [CLAIM], {PATH: SOURCE})
            assert rows[0]['verdict'] == 'rejected'
        generate.assert_not_called()
        return dict(counts, feedback=feedback_counts, review_completed=not problems, generated_edits=0,
                    provider='scripted, no live HTTP requests')


class EfficiencyTests(unittest.TestCase):
    def test_plan_only_native_repair_does_not_acquire_document_effort_limit(self):
        class StopAfterEffort(Exception):
            pass
        for request, bounded in ((TASK, True),
                ('Investigate and repair native keyboard layout in ios/KappaForge/KappaWebView.swift.', False),
                ('Update docs/audit.md and repair keyboard behavior.', False)):
            issue = dict(number=91, title='Owner task', user={'login': 'onlykappa'},
                         body='Repository: onlykappa/KappaForge\nMode: develop\n\n' + request)
            with self.subTest(request=request), \
                    patch.object(developer, 'revision_files', return_value=[dict(filename=PATH)]), \
                    patch('engine.operational_review.restore_origin'), \
                    patch.object(task_state, 'observe_pr', side_effect=StopAfterEffort), \
                    patch.object(task_state, 'begin_effort') as effort:
                with self.assertRaises(StopAfterEffort):
                    developer.revise_branch(issue, {}, 'kappa/dev-91', SHA, [], 'token', 'key')
                if bounded:
                    effort.assert_called_once_with(12)
                else:
                    effort.assert_not_called()

    def test_cache_invalidates_on_source_candidate_goal_and_route_and_never_caches_uncertainty(self):
        goal = task_goal.from_request(TASK)
        handle = task_goal.CURRENT.set(goal)
        try:
            task_state.bind('onlykappa/KappaForge', 91, 'kappa/dev-91', SHA)
            calls = []
            uncertain = False
            def model(key, prompt, **kwargs):
                calls.append(prompt)
                data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
                return 'simulation', json.dumps({'findings': [dict(id=row['id'],
                    verdict='needs_validation' if uncertain else 'rejected', in_goal=True,
                    reason='The row is already inspected', evidence=[dict(path=PATH, lines=[1])])
                    for row in data['findings']]})
            sources = {PATH: SOURCE}
            def assess(allowed=None):
                return repair_guard.verify_all_findings(model, 'key', goal.request, [CLAIM], sources, allowed)
            assess(); assess()
            self.assertEqual(len(calls), 1)
            sources[PATH] += '\n'
            assess()
            task_state.checkpoint('b' * 40)
            assess()
            goal.request += ' Preserve the scope.'
            assess()
            assess({'groq'})
            self.assertEqual(len(calls), 5)
            task_state.observe_validation('sandbox', 'b' * 40,
                                          dict(id=1, status='completed', conclusion='success'))
            assess({'groq'})
            self.assertEqual(len(calls), 6)
            uncertain = True
            sources[PATH] += '\n'
            self.assertEqual(assess()[0]['verdict'], 'needs_validation')
            self.assertEqual(assess()[0]['verdict'], 'needs_validation')
            self.assertEqual(len(calls), 8)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_coding_context_has_no_finding_hashes_and_preserves_candidate_and_internal_evidence(self):
        goal = task_goal.from_request(TASK)
        handle = task_goal.CURRENT.set(goal)
        try:
            task_state.bind('onlykappa/KappaForge', 91, 'kappa/dev-91', SHA)
            goal.record.repair = dict(source='c' * 64, findings=[dict(id='d' * 64, verdict='rejected', reason='Already inspected')])
            with task_state.action('coder', 'Edit', 'Preserve scope', 'Valid source'):
                data = task_state.decode_prompt(task_state.add_to_prompt('Edit source'))
            self.assertNotIn('d' * 64, json.dumps(data))
            self.assertNotIn('c' * 64, json.dumps(data['repairAssessment']))
            self.assertEqual(data['facts']['candidate']['sha'], SHA)
            self.assertEqual(goal.record.repair['findings'][0]['id'], 'd' * 64)
        finally:
            task_goal.CURRENT.reset(handle)

    def test_feedback_replay_completes_without_generation_and_repeated_findings_are_reused(self):
        result = simulate()
        self.assertTrue(result['review_completed'])
        self.assertEqual(result['feedback'], dict(gateway=3, verification=1, review=2))
        self.assertEqual((result['gateway'], result['verification']), (4, 2))

    def test_provenance_noun_constraints_and_compound_lifecycle_are_not_code_repairs(self):
        self.assertFalse(requirements.authority_ask('Verify the merge commits for Phase 1 and Phase 2.'))
        self.assertTrue(requirements.authority_ask('Merge commits into main.'))
        self.assertEqual(requirements.rule_categories('Do not continue to 3.1b or any later job.'), ('housekeeping',))
        lifecycle = 'Open one draft PR for this small documentation update, report what you verified, and stop.'
        self.assertTrue(verify.lifecycle_requirement(lifecycle))
        self.assertTrue(verify.lifecycle_problem('Requirement not met: ' + lifecycle))
        self.assertFalse(verify.lifecycle_requirement('Open a draft PR and fix the code.'))
        self.assertFalse(verify.lifecycle_requirement('Open a draft PR and stop the server.'))
        # Recovery revalidates stored model labels instead of preserving these mistakes.
        for text, old, expected in (
            ('Start fresh from current main.', ['code', 'research'], ('housekeeping', 'research')),
            ('Do not continue to 3.1b or any later job.', ['code'], ('housekeeping',)),
            ('Verify its exact commit and the merge commits for Phase 1 and Phase 2.', ['code', 'owner_decision'], ('research',)),
            (lifecycle, ['code', 'documentation'], ('housekeeping',)),
        ):
            item = dict(requirements.split(text)[0], categories=old)
            self.assertEqual(requirements.validate([item], text)[0].categories, expected)

    def test_effort_budget_stops_before_gateway_without_resetting_lifetime_accounting(self):
        goal = task_goal.from_request(TASK)
        handle = task_goal.CURRENT.set(goal)
        try:
            task_state.bind('onlykappa/KappaForge', 91, 'kappa/dev-91', SHA)
            task_state.begin_effort(2)
            with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                    patch.object(runner, 'run_integrated_router', return_value=('simulation', '{}')) as gateway:
                runner.run_model('key', 'review')
                runner.run_model('key', 'review')
                task_state.begin_effort(2)  # repeated setup cannot reset the allowance
                with self.assertRaises(runner.RecoveryBudgetExceeded):
                    runner.run_model('key', 'review')
            self.assertEqual(gateway.call_count, 2)
        finally:
            task_goal.CURRENT.reset(handle)


if __name__ == '__main__':
    print(json.dumps(simulate(), indent=2))

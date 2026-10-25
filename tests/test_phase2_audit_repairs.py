"""Audit regressions: immutable test scripts, exact final review, private research and Fix it clarification."""
import json
import urllib.parse
import unittest
from unittest.mock import Mock, patch

from engine import clarification, developer, execution, exploration, native_build, recovery, research, sandbox, task_goal, verify
from tests import test_clarification as clarify_tests
from tests import test_research as research_tests
from tests import test_sandbox_repair_controller as repair_tests
from tests.test_recovery_journal import GitHub

SHA = 'a' * 40


class TestCommandTests(unittest.TestCase):
    def test_a_repair_cannot_disable_lifecycle_checks_through_npmrc(self):
        session = repair_tests.fixture_tree(files={'package.json': b'{"scripts":{"pretest":"node failing.cjs","test":"node passing.cjs"}}'})
        reply = repair_tests.model_reply({'tool':'apply_patch', 'reason':'Disable the failing pretest',
            'args':{'edits':[{'path':'.npmrc','find':'','replace':'ignore-scripts=true\n'}]}})
        result = repair_tests.sandbox_repair_controller.SandboxRepairController(session).run_repair('Fix the behavior', reply, 'fixture')
        self.assertEqual((result['status'], result['stop_reason']), ('failed', 'test_definition_changed'))
        self.assertEqual(session.run_tests()[0].status, 'rejected')

    def test_a_repair_cannot_change_npm_test_or_its_hooks_or_delegates(self):
        for script in ('test', 'pretest', 'posttest', 'unit'):
            with self.subTest(script=script):
                package = json.dumps({'scripts': {'test': 'npm run unit', 'unit': 'node --test failing.cjs',
                                                  'pretest': 'node prepare.cjs', 'posttest': 'node finish.cjs'}})
                session = repair_tests.fixture_tree(files={'package.json': package.encode()})
                changed = json.loads(package)
                changed['scripts'][script] = 'node --test passing.cjs'
                reply = repair_tests.model_reply({'tool': 'apply_patch', 'reason': 'replace validation',
                    'args': {'edits': [{'path': 'package.json', 'find': package, 'replace': json.dumps(changed)}]}})
                result = repair_tests.sandbox_repair_controller.SandboxRepairController(session).run_repair('Fix app.py', reply, 'fixture')
                self.assertEqual((result['status'], result['stop_reason']), ('failed', 'test_definition_changed'))
                self.assertTrue(session.test_definition_changed())
                # The weak script never gets a validation receipt, even when a tool asks directly.
                self.assertEqual(session.run_tests()[0].status, 'rejected')


class PrivateResearchTests(unittest.TestCase):
    def test_exploration_registers_private_source_before_research(self):
        confidential = 'CONFIDENTIAL_CUSTOMER_ROLLOUT_2027'
        for tool, args in [('read_file', {'path': 'later.py'}), ('search_code', {'query': 'CONFIDENTIAL'}),
                           ('inspect_symbols', {'path': 'later.py'})]:
            with self.subTest(tool=tool):
                r, web = research_tests.researcher(private_sources={'first.py': 'initial = 1'})
                replies = iter([{'tool': tool, 'args': args}, {'tool': 'search_docs', 'args': {'query': confidential}}, {'done': True}])
                exploration.investigate(lambda *a, **k: ('fixture', json.dumps(next(replies))), 'key', 'Investigate',
                    exploration.Repository.from_sources({'later.py': 'internal = "' + confidential + '"'}), {}, ['Find behavior'], research=r)
                self.assertEqual(web.sent, [])
                self.assertEqual(r.sources[0]['status'], 'refused')

    def test_private_text_is_refused_in_paths_queries_fragments_and_redirects(self):
        confidential = 'CONFIDENTIAL_CUSTOMER_ROLLOUT_2027'
        encoded = ''.join('%%%02X' % ord(c) for c in confidential)
        for suffix in (confidential, encoded, urllib.parse.quote(encoded, safe=''), '?q=' + encoded, '#' + confidential):
            with self.subTest(suffix=suffix):
                url = 'https://docs.python.org/3/' + suffix
                r, web = research_tests.researcher(private_sources={'private.py': confidential})
                self.assertEqual(r.read_doc(url)['cause'], 'refused')
                self.assertEqual(web.sent, [])
                self.assertNotIn(confidential, json.dumps(r.report()))
                self.assertNotIn(encoded, json.dumps(r.report()))
        start = 'https://docs.python.org/3/library/json.html'
        r, web = research_tests.researcher({start: research_tests.redirect('https://docs.python.org/3/' + encoded)},
                                          private_sources={'private.py': confidential})
        self.assertEqual(r.read_doc(start)['cause'], 'refused')
        self.assertEqual(len(web.sent), 1, 'the redirect with private text never reaches the opener')
        disabled = dict(research.config(), enabled=False)
        r, web = research_tests.researcher(settings=disabled, private_sources={'private.py': confidential})
        self.assertEqual(r.read_doc('https://docs.python.org/3/' + confidential)['cause'], 'unavailable')
        self.assertNotIn(confidential, json.dumps(r.report()), 'disabled research cannot echo private URLs into logs')
        self.assertEqual(web.sent, [])


class FinalReviewTests(unittest.TestCase):
    def setUp(self):
        developer.Progress.latest = None
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(None))

    def test_final_review_reads_repaired_and_new_files_and_cannot_edit_them(self):
        source = {'app.py': 'value=1\n'}
        candidate = {'app.py': 'value=999\n', 'extra.py': 'extra=True\n'}
        seen = {}
        def review(model, key, task, read, changes, *a, **kw):
            seen.update(changes)
            self.assertEqual(read('app.py'), source['app.py'])
            return ([{'text': 'Set value to 2', 'met': False, 'evidence': 'value=999'}], [], [])
        with patch.object(developer, 'list_tree', return_value=({'app.py': 8}, {})), \
             patch.object(verify, 'wiring_problems', return_value=[]), patch.object(verify, 'model_review', side_effect=review), \
             patch.object(developer, 'generate', side_effect=AssertionError('final review must not edit')), \
             patch.object(developer, 'change_flags', return_value={}):
            verdict, problems = developer.review_sandbox_candidate('key', 'Set value to 2', developer.ROOT, SHA,
                'fixture', source, candidate, '', {'free'}, Mock())
        self.assertEqual(seen, candidate)
        self.assertTrue(problems)
        self.assertEqual(candidate['app.py'], 'value=999\n')

    def test_new_sensitive_files_are_checked_against_the_base(self):
        with patch.object(developer, 'list_tree', return_value=({}, {})), \
             patch.object(developer, 'check_the_work', side_effect=AssertionError('flagged candidate must stop')):
            with self.assertRaisesRegex(PermissionError, 'flagged changes'):
                developer.review_sandbox_candidate('key', 'Fix add', 'onlykappa/OmniPC', SHA, 'fixture', {},
                    {'extra.py': 'import os\nprint(os.environ)\n'}, '', {'free'}, Mock())

    def test_a_review_that_mutates_the_tested_patch_is_refused(self):
        with patch.object(developer, 'list_tree', return_value=({}, {})), \
             patch.object(developer, 'check_the_work', return_value=({'new.py': 'changed'}, 'ok', [])):
            with self.assertRaises(execution.CheckpointMismatch):
                developer.review_sandbox_candidate('key', 'Add file', developer.ROOT, SHA, 'fixture', {},
                    {'new.py': 'tested'}, '', {'free'}, Mock())

    def test_development_blocks_publication_when_repaired_candidate_fails_review(self):
        case = clarify_tests.PipelineTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        final = {'app.py': 'value=999\n', 'extra.py': 'extra=True\n'}
        repaired = lambda *a, **k: {'status': 'success', 'summary': 'tests passed', 'attempts': [],
                                    'candidate_changes': final, 'test_results': [{}]}
        with patch.object(developer, 'review_sandbox_candidate', return_value=('Wrong behavior', ['Requirement not met'])) as review, \
             patch.object(developer, 'publish_candidate') as publish:
            url, _, _, _ = case.run_task(lambda *a, **k: (['app.py'], [], 'Set value to 2'),
                lambda *a, **k: ('fixture', 'Set value', {'app.py': 'value=2\n'}, 'Set value'), repaired)
        self.assertIsNone(url)
        self.assertEqual(review.call_args.args[6], final)
        publish.assert_not_called()
        self.assertEqual(case.prs_opened(), [])

    def test_resume_cannot_reuse_a_missing_or_different_candidate_review(self):
        for binding in (None, execution.digest({'app.py': 'value=1\n'})):
            with self.subTest(binding=binding):
                case = clarify_tests.PipelineTests()
                case.setUp()
                self.addCleanup(case.doCleanups)
                case.journal.checkpoint(SHA, base='main')
                context = dict(kind='develop', base='main', model='fixture', summary='Change value', explanation='Change',
                               stages=[], design='', open_problems=[], reviewed_candidate=binding)
                task = case.world.issue['title'] + '\n' + case.world.issue['body']
                execution.seed(case.journal, developer.ROOT, SHA, {'app.py':'value=2\n'}, task, context)
                with patch.object(developer, 'review_sandbox_candidate', return_value=('Incomplete', ['Review incomplete'])) as review, \
                     patch.object(developer, 'publish_candidate') as publish:
                    url, planner, writer, _ = case.run_task(AssertionError('no planning'), AssertionError('no generation'))
                self.assertIsNone(url)
                planner.assert_not_called()
                writer.assert_not_called()
                review.assert_called_once()
                publish.assert_not_called()


class FixClarificationTests(unittest.TestCase):
    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.addCleanup(recovery.CURRENT.reset, recovery.CURRENT.set(self.journal))
        developer.Progress.latest = None
        self.pr = self.world.prs[0]
        self.pr['body'] = verify.review_record(['Requirement not met: Change value'])
        self.pr['base'] = {'sha': SHA}

    def run_fix(self, sandbox_result, resumed=None, replies=(), review_result=('Final review', []), initial=None):
        def gh(path, token, payload=None, method=None):
            if '/pulls?state=open' in path:
                return self.world.read(path)
            if path.endswith('/files?per_page=100'):
                return [{'filename': 'app.py', 'status': 'modified'}]
            if payload is None and '/comments?' in path:
                return list(self.world.rows) + list(replies)
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=gh), patch.object(developer, 'token_for', return_value='fixture'), \
             patch.object(developer, 'sandbox_result', return_value=None) as status, patch.object(native_build, 'result', return_value=None), \
             patch.object(developer, 'owner_guidance', return_value=[r['body'][10:] for r in replies if r['user']['login']=='onlykappa']), \
             patch.object(developer, 'is_private', return_value=False), patch.object(developer, 'code_providers', return_value={'free'}), \
             patch.object(developer, 'list_tree', return_value=({'app.py': 8}, {})), patch.object(developer, 'read_source', return_value='value=1\n'), \
             patch.object(developer, 'Progress'), patch.object(developer, 'change_flags', return_value={}), \
             patch.object(execution, 'pending', return_value=resumed), \
             patch.object(developer, 'revise_branch', return_value=('fixture', 'Change value', initial or {'app.py':'value=2\n'}, 'Change', {})) as revise, \
             patch.object(developer, 'run_sandbox_repair', side_effect=sandbox_result) as run, \
             patch.object(developer, 'report_sandbox_failure') as failure, \
             patch.object(developer, 'review_sandbox_candidate', return_value=review_result) as review, \
             patch.object(developer, 'publish_candidate', return_value={'sha': 'c'*40}) as publish, \
             patch.object(developer, 'dispatch_tests'), patch.object(developer, 'notify'):
            url = developer.fix_pull_request(self.world.issue, 'key', 'fixture')
        return url, status, revise, run, failure, review, publish

    def test_fix_rechecks_repaired_files_and_blocks_publication_on_unmet_requirements(self):
        final = {'app.py': 'value=999\n', 'extra.py': 'extra=True\n'}
        repaired = lambda *a, **k: {'status':'success', 'summary':'tests passed', 'attempts':[], 'candidate_changes':final}
        url, _, _, _, _, review, publish = self.run_fix(repaired, review_result=('Wrong behavior', ['Requirement not met']))
        self.assertIsNone(url)
        self.assertEqual(review.call_args.args[6], final)
        publish.assert_not_called()

    def test_fix_publishes_only_after_clean_final_review(self):
        final = {'app.py': 'value=3\n'}
        repaired = lambda *a, **k: {'status':'success', 'summary':'tests passed', 'attempts':[], 'candidate_changes':final}
        url, _, _, _, _, review, publish = self.run_fix(repaired)
        self.assertEqual(url, self.pr['html_url'])
        self.assertEqual(review.call_args.args[6], final)
        self.assertEqual(publish.call_args.args[2], final)

    def test_fix_question_round_trip_with_the_real_checkpoint_and_repair_controller(self):
        attempts = []
        def sandbox_run(repo, sha, token, changes, task, api_key, allowed, **kwargs):
            files = {'app.py': b'value=1\n', 'tests/test_app.py': b'import unittest\n'}
            session = sandbox.Session(sandbox.Tree(repo, sha, files), docker=repair_tests.FakeDocker())
            def agent(*args, **kw):
                if not clarification.answers(clarification.load(self.journal, repo, task_goal.owner_request(self.world.issue))):
                    action = {'tool':'ask_owner', 'args':clarify_tests.QUESTION}
                else:
                    self.assertIn('A: Treat an empty total as 0.', args[1])
                    action = {'tool':'apply_patch', 'args':{'edits':[{'path':'app.py','find':'value=0','replace':'value=2'}]}}
                return 'fixture', json.dumps(dict(action, reason='Resolve the original task'))
            controller = repair_tests.sandbox_repair_controller.SandboxRepairController(session, self.journal, kwargs['context'])
            result = controller.run_repair(task, agent, api_key, initial_changes=changes)
            attempts.append(result['attempts'])
            return result
        url, _, _, _, failure, _, publish = self.run_fix(sandbox_run, initial={'app.py':'value=0\n'})
        self.assertIsNone(url)
        failure.assert_not_called()
        publish.assert_not_called()
        saved = execution.pending(self.world.journal(), 'fix')
        self.assertEqual(saved['changes'], {'app.py':'value=0\n'})
        self.assertEqual(saved['controller']['phase'], 'repair')
        records = clarification.load(self.journal, developer.ROOT, task_goal.owner_request(self.world.issue))
        answer = {'id':records[0]['comment']+10, 'user':{'login':'onlykappa'}, 'body':'Guidance: Treat an empty total as 0.'}
        url, _, revise, _, _, review, publish = self.run_fix(sandbox_run, resumed=saved, replies=[answer])
        self.assertEqual(url, self.pr['html_url'])
        revise.assert_not_called()
        review.assert_called_once()
        self.assertEqual(publish.call_args.args[2], {'app.py':'value=2\n'})
        self.assertEqual(len(attempts[-1]), 2)
        self.assertEqual(attempts[-1][0], attempts[0][0], 'the earlier tested attempt is preserved exactly')

    def test_fix_asks_once_waits_and_resumes_the_saved_candidate_with_owner_answer(self):
        question = clarification.validate(clarify_tests.QUESTION)[0]
        paused = lambda *a, **k: {'status': 'needs_clarification', 'question': question}
        url, _, _, run, failure, _, publish = self.run_fix(paused)
        self.assertIsNone(url)
        failure.assert_not_called()
        publish.assert_not_called()
        self.assertEqual(self.journal.state['status'], 'needs_clarification')
        questions = [r for r in self.world.rows if r['body'].startswith(clarification.HEADING)]
        self.assertEqual(len(questions), 1)
        first_task = run.call_args.args[4]
        cycles = self.journal.state['budgets']['fixCycles']
        for replies in ([], [{'id': questions[0]['id']+1, 'user': {'login': 'mallory'}, 'body':'Guidance: yes'}]):
            _, status, revise, run, _, _, publish = self.run_fix(AssertionError('no execution while waiting'), replies=replies)
            status.assert_not_called()
            revise.assert_not_called()
            run.assert_not_called()
            publish.assert_not_called()
        self.assertEqual(self.journal.state['budgets']['fixCycles'], cycles)
        saved = {'identity': {'base': self.pr['head']['sha']}, 'changes': {'app.py':'value=2\n'},
                 'context': {'model':'fixture','summary':'Change value','explanation':'Change','cycle':1,'cycle_limit':3}}
        answer = {'id':questions[0]['id']+2, 'user':{'login':'onlykappa'}, 'body':'Guidance: Treat an empty total as 0.'}
        def stop_after_resume(*args, **kwargs):
            self.assertEqual(args[3], saved['changes'])
            self.assertEqual(execution.task_digest(args[4]), execution.task_digest(first_task))
            self.assertIn('A: Treat an empty total as 0.', args[4])
            self.assertEqual(kwargs['context']['clarifications'], [{'id':question['id']}])
            raise RuntimeError('observed exact resume')
        with self.assertRaisesRegex(RuntimeError, 'observed exact resume'):
            self.run_fix(stop_after_resume, resumed=saved, replies=[answer])
        records = clarification.load(self.journal, developer.ROOT, task_goal.owner_request(self.world.issue))
        self.assertEqual(records[0]['status'], 'answered')
        self.assertEqual(len([r for r in self.world.rows if r['body'].startswith(clarification.HEADING)]), 1)


if __name__ == '__main__':
    unittest.main()

"""Phase 2 section 4: structured requirement classification, its validation and the requirement-to-test matrix."""
import inspect
import json
import unittest
from unittest.mock import patch

from engine import developer, execution, intent_guard, recovery, requirements, task_goal
from tests import test_developer
from tests.test_developer import ADD_SCOPE, ADD_TEST, TEST_SCOPE
from tests.test_recovery_journal import GitHub

try:
    import jsonschema
except ImportError:  # The schema test needs it; everything else does not.
    jsonschema = None


def categories(text, answers=None, scope=None):
    return requirements.classify(text, answers, scope)[0].categories


class Recorder:
    def __init__(self):
        self.lines = []

    def act(self, kind, text, write=True, **feed):
        self.lines.append(dict(kind=kind, text=text, **feed))


class SplitTests(unittest.TestCase):
    def test_each_ask_keeps_its_exact_wording_and_position(self):
        request = ("Fix the crash when the invoice total is empty. Thanks!\n"
                   "- Add a unit test for it\n2) Update the README\n"
                   "Add a comment # v1.2. maintained by us. as the first line of .github/workflows/a.yml. ok")
        rows = requirements.split(request)
        self.assertEqual([r['text'] for r in rows], [
            'Fix the crash when the invoice total is empty.', 'Add a unit test for it', 'Update the README',
            'Add a comment # v1.2. maintained by us. as the first line of .github/workflows/a.yml.'])
        self.assertEqual([r['id'] for r in rows], ['R1', 'R2', 'R3', 'R4'])
        for row in rows:
            self.assertEqual(request[row['start']:row['end']], row['text'], 'the original wording is traceable')

    def test_requests_are_bounded(self):
        rows = requirements.split('\n'.join(f'- Change item {i}' for i in range(100)))
        self.assertEqual(len(rows), requirements.MAX_REQUIREMENTS)


class PhrasingTests(unittest.TestCase):
    """The deterministic rules alone (no model answer) across different wordings of the same kind of ask."""
    CASES = [
        ('bug_fix', ['Fix the crash on the settings screen.', 'The login button is broken.',
                     "Sending a message doesn't work on iPhone.", 'The total shows the wrong currency.']),
        ('testing', ['Add a unit test for the parser.', 'Write tests covering empty input.',
                     'Increase coverage for the router.']),
        ('documentation', ['Update the README with setup steps.', 'Document the new endpoint.',
                           'Add a docstring to parse().']),
        ('security', ['Make sure the token never reaches the logs.', 'Sanitize the HTML before rendering it.',
                      'Check permissions before deleting a note.']),
        ('research', ['Look up the latest version of the Stripe API.', 'Compare our SDK with the official docs.',
                      'Find out which version deprecated this call.']),
        ('housekeeping', ['Open a draft PR for this.', 'Please make a pull request and let me know.']),
        ('owner_decision', ['Merge it when the tests pass.', 'Deploy this to production.', 'Release version 2.',
                            'Grant the bot write access.']),
        ('code', ['Add a dark mode toggle to settings.', 'The chat should show timestamps.']),
    ]

    def test_each_kind_is_recognized_across_phrasings(self):
        for category, phrases in self.CASES:
            for phrase in phrases:
                with self.subTest(phrase=phrase):
                    self.assertIn(category, categories(phrase))

    def test_a_negated_owner_action_is_a_restriction_not_a_request(self):
        for phrase in ("Don't merge it.", 'Do not deploy anything.', 'Never release this.', 'Open a PR without merging.'):
            with self.subTest(phrase=phrase):
                self.assertNotIn('owner_decision', categories(phrase))
                self.assertFalse(requirements.classify(phrase)[0].owner_action)


class ModelAnswerTests(unittest.TestCase):
    REQUEST = 'Add a dark mode toggle. Merge it once it works. Do not log the auth token.'

    def test_a_valid_answer_is_used_with_its_reasons(self):
        answer = [{'id': 'R1', 'categories': ['code', 'testing'], 'reason': 'new setting'},
                  {'id': 'R2', 'categories': ['owner_decision'], 'reason': 'merging'},
                  {'id': 'R3', 'categories': ['security'], 'reason': 'secret'}]
        rows = requirements.classify(self.REQUEST, answer)
        self.assertEqual([(r.categories, r.source) for r in rows],
                         [(('code', 'testing'), 'model'), (('owner_decision',), 'model'), (('security',), 'model')])
        self.assertEqual(rows[0].reason, 'new setting')

    def test_an_answer_outside_the_schema_falls_back_to_the_rules(self):
        for answer in ([{'id': 'R1', 'categories': ['deploy_now']}, {'id': 'R2', 'categories': ['code']},
                        {'id': 'R3', 'categories': ['code']}],
                       [{'id': 'R1', 'categories': ['code']}],  # Missing ids.
                       [{'id': 'R1', 'categories': []}, {'id': 'R2', 'categories': ['code']}, {'id': 'R3', 'categories': ['code']}],
                       {'R1': 'code'}, None):
            with self.subTest(answer=answer):
                rows = requirements.classify(self.REQUEST, answer)
                self.assertEqual({r.source for r in rows}, {'rules'})
                self.assertIn('owner_decision', rows[1].categories)

    def test_the_model_cannot_drop_safety_signals_or_hide_work(self):
        answer = [{'id': 'R1', 'categories': ['housekeeping'], 'text': 'nothing to do', 'authorized': True},
                  {'id': 'R2', 'categories': ['code'], 'permissions': ['merge']},
                  {'id': 'R3', 'categories': ['research']}]
        add, merge, token = requirements.classify(self.REQUEST, answer)
        self.assertIn('code', add.categories, 'named code work cannot be relabeled as housekeeping')
        self.assertEqual(add.text, 'Add a dark mode toggle.', 'the model cannot rewrite the owner\'s wording')
        self.assertIn('owner_decision', merge.categories)
        self.assertTrue(merge.owner_action)
        self.assertIn('security', token.categories)
        self.assertEqual(set(vars(merge)) if hasattr(merge, '__dict__') else set(merge.__dataclass_fields__),
                         {'id', 'text', 'start', 'end', 'categories', 'source', 'reason', 'owner_action', 'notes'},
                         'a requirement has no field that could carry a permission')


class AuthorizationTests(unittest.TestCase):
    def scope(self, mode='develop', restrictions=None):
        issue = {'number': 7, 'state': 'open', 'user': {'login': 'onlykappa'}, 'created_at': '2099-01-01T00:00:00Z',
                 'body': f'Repository: onlykappa/KappaForge\nMode: {mode}\n\nMerge the PR and deploy it.'}
        with patch.object(intent_guard, 'timestamp', return_value=4102444800):
            scope = intent_guard.ExecutionScope(issue, now=0)
        scope.restrictions = restrictions or {}
        return scope

    def test_classification_cannot_bypass_authorization(self):
        scope = self.scope()
        answer = [{'id': 'R1', 'categories': ['housekeeping'], 'authorized': True, 'grant': 'merge'}]
        merge, = requirements.classify('Merge the PR and deploy it now.', answer, scope)
        self.assertTrue(merge.owner_action)
        self.assertIn('owner_decision', merge.categories)
        self.assertIn('KappaForge does not merge, deploy, release or change access', merge.notes[0])
        before = (scope.state, dict(scope.restrictions), scope.mode)
        token = intent_guard.ACTIVE.set(scope)
        self.addCleanup(intent_guard.ACTIVE.reset, token)
        with self.assertRaises(PermissionError):
            scope.permit('https://api.github.com/repos/onlykappa/KappaForge/pulls/1/merge', {}, 'PUT')
        self.assertEqual((scope.state, dict(scope.restrictions), scope.mode), before, 'classifying changed nothing')

    def test_nothing_in_classification_touches_the_execution_scope(self):
        source = inspect.getsource(requirements)
        for forbidden in ('ACTIVE.set', '.permit(', '.transition(', 'restrictions[', 'setattr(scope'):
            self.assertNotIn(forbidden, source)
        self.assertNotIn('requirements', inspect.getsource(intent_guard), 'the guard never consults classification')

    def test_owner_instructions_and_task_mode_are_checked(self):
        merge, = requirements.classify("Merge it once it works. Don't merge before I review.", None, self.scope())[:1]
        self.assertIn("Conflicts with the owner's instruction not to merge", merge.notes)
        fix, = requirements.classify('Fix the crash in the parser.', None, self.scope('analysis'))
        self.assertIn('This analysis task is read-only: the work is reported, not changed', fix.notes)
        test, = requirements.classify('Add a unit test for the parser.', None, self.scope(restrictions={'noTests': True}))
        self.assertIn('The owner restricted this task (noTests)', test.notes)


class MatrixTests(unittest.TestCase):
    REQUEST = ('Fix the crash when the total is empty. Add a dark mode toggle. Update the README. '
               'Open a draft PR. Deploy it to production.')
    FILES = {'app/total.py': 'def total(xs):\n    return sum(xs or [])\n',
             'tests/test_total.py': 'def test_empty():\n    assert total([]) == 0\n', 'README.md': 'Setup'}

    def rows(self, reviewed):
        return requirements.matrix(requirements.classify(self.REQUEST), reviewed, self.FILES.get)

    def test_every_requirement_gets_a_status(self):
        reviewed = [{'id': 'R1', 'text': 'x', 'met': True, 'evidence': {'path': 'app/total.py', 'quote': 'sum(xs or [])'},
                     'test': {'path': 'tests/test_total.py', 'quote': 'assert total([]) == 0'}},
                    {'id': 'R2', 'text': 'Dark mode', 'met': True, 'evidence': {'path': 'app/total.py', 'quote': 'def total'}},
                    {'text': 'Update the README.', 'met': True, 'evidence': {'path': 'README.md', 'quote': 'Setup'}},
                    {'id': 'R4', 'text': 'Open a draft PR.', 'met': True, 'kind': 'lifecycle'}]
        rows = self.rows(reviewed)
        self.assertEqual([r['status'] for r in rows], ['tested', 'untested', 'done', 'checked on GitHub', 'owner decision'])
        self.assertEqual(requirements.open_items(rows),
                         ['Requirement untested: R2 Add a dark mode toggle. (add or cite a test that exercises it)'])
        table = requirements.render(rows, sandbox_passed=True)
        self.assertIn('| R1 | Fix the crash when the total is empty. | bug_fix | `app/total.py` | `tests/test_total.py` '
                      '(ran: full suite passed) | tested |', table)
        self.assertIn('| R5 | Deploy it to production. | owner_decision | no | not needed | owner decision;', table)

    def test_a_cited_test_must_exist_in_a_test_file(self):
        for test in ({'path': 'tests/test_total.py', 'quote': 'assert total([1]) == 1'},  # Not in the file.
                     {'path': 'app/total.py', 'quote': 'return sum(xs or [])'},  # Not a test.
                     {'path': 'tests/missing.py', 'quote': 'x'}, 'tests/test_total.py'):
            with self.subTest(test=test):
                rows = self.rows([{'id': 'R1', 'text': 'x', 'met': True, 'evidence': {}, 'test': test}])
                self.assertEqual(rows[0]['status'], 'untested')

    def test_unreported_and_unmet_requirements_are_shown_not_sent_to_repair(self):
        rows = self.rows([{'id': 'R1', 'text': 'x', 'met': False}])
        self.assertEqual([r['status'] for r in rows[:3]], ['not implemented', 'not reviewed', 'not reviewed'])
        self.assertEqual(requirements.open_items(rows), [])

    @unittest.skipUnless(jsonschema, 'jsonschema is not installed')
    def test_the_published_schema_matches_the_code(self):
        schema = requirements.schema()
        enum = schema['properties']['requirements']['items']['properties']['categories']['items']['enum']
        self.assertEqual(tuple(enum), requirements.CATEGORIES)
        self.assertEqual(set(schema['$defs']['categoryMeanings']), set(requirements.CATEGORIES))
        jsonschema.validate({'requirements': [{'id': 'R1', 'categories': ['code', 'testing'], 'reason': 'x'}]}, schema)
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({'requirements': [{'id': 'R1', 'categories': ['merge']}]}, schema)


class PersistenceTests(unittest.TestCase):
    REQUEST = 'Fix the crash in the parser. Merge it after review.'

    def setUp(self):
        self.world = GitHub()
        self.journal = self.world.journal()
        self.journal.checkpoint('a' * 40, base='main')
        for var in (task_goal.CURRENT, requirements.CURRENT, requirements.ANSWER):
            self.addCleanup(var.reset, var.set(None))

    def test_classification_is_saved_once_and_revalidated_on_load(self):
        answer = [{'id': 'R1', 'categories': ['bug_fix'], 'reason': 'crash'}, {'id': 'R2', 'categories': ['owner_decision']}]
        requirements.ANSWER.set(answer)
        first = developer.classify_task(Recorder(), self.journal, recovery.ROOT, self.REQUEST)
        self.assertEqual([r.source for r in first], ['model', 'model'])
        resumed = Recorder()
        requirements.ANSWER.set(None)
        again = developer.classify_task(resumed, self.world.journal(), recovery.ROOT, self.REQUEST)
        self.assertEqual(again, first, 'a resumed task reuses the classification, without a model answer')
        self.assertTrue(resumed.lines[0]['text'].startswith('Reloaded 2 requirements'))
        with self.assertRaises(execution.CheckpointMismatch):
            requirements.load(self.world.journal(), recovery.ROOT, 'A different request entirely.')

    def test_a_tampered_saved_label_is_corrected_by_the_rules(self):
        classified = requirements.classify(self.REQUEST)
        tampered = [classified[0], requirements.Requirement(**{**classified[1].__dict__, 'categories': ('housekeeping',)})] \
            if hasattr(classified[1], '__dict__') else classified
        requirements.save(self.journal, tampered, recovery.ROOT, self.REQUEST)
        loaded = requirements.load(self.world.journal(), recovery.ROOT, self.REQUEST)
        self.assertIn('owner_decision', loaded[1].categories)
        self.assertTrue(loaded[1].owner_action)

    def test_old_base_header_labels_migrate_only_for_the_exact_same_owned_request(self):
        self.world = GitHub()
        self.world.issue['body'] = ('Repository: onlykappa/KappaForge\nMode: develop\n'
                                    'Base: fix/phase3-queue-base-314\n\nFix the parser. Add regression tests.')
        handle = intent_guard.ACTIVE.set(None)
        self.addCleanup(intent_guard.ACTIVE.reset, handle)
        intent_guard.activate(self.world.issue)
        journal = self.world.journal()
        old = task_goal.owner_request(self.world.issue, legacy_base=True)
        current = task_goal.owner_request(self.world.issue)
        requirements.save(journal, requirements.classify(old), recovery.ROOT, old)
        prior = journal.state['requirementClassification']['hash']
        loaded = requirements.load(self.world.journal(), recovery.ROOT, current, intent_guard.ACTIVE.get())
        self.assertEqual([r.text for r in loaded], ['Fix the parser.', 'Add regression tests.'])
        self.assertEqual([r.id for r in loaded], ['R1', 'R2'])
        self.assertNotEqual(self.world.journal().state['requirementClassification']['hash'], prior)
        self.assertEqual(requirements.load(self.world.journal(), recovery.ROOT, current), loaded)
        with self.assertRaises(execution.CheckpointMismatch):
            requirements.load(self.world.journal(), recovery.ROOT, current + ' Deploy it.')


def setUpModule():
    test_developer.setUpModule()  # Offline archive and the scripted sandbox pass the PR-first world relies on.


def tearDownModule():
    test_developer.tearDownModule()


class PipelineTests(unittest.TestCase):
    """The development pipeline: the planner classifies in its one call, the review links tests, the draft shows
    the matrix. Uses the PR-first tests' GitHub world."""
    fixture = test_developer.PrFirstTests()
    ROOT_ = fixture.ROOT_

    def world(self):
        return self.fixture.world()

    def issue(self):
        return self.fixture.issue()

    def test_the_draft_shows_each_requirement_with_its_test(self):
        prompts = []
        answers = iter([
            ('flash', json.dumps({'read': ['app/main.py'], 'stages': ['Cast both inputs'], 'design': 'Convert at the boundary.',
                                  'requirements': [{'id': 'R1', 'categories': ['code'], 'reason': 'new behavior'}]})),
            ('flash', json.dumps({'summary': 'Cast inputs', 'files': [
                {'path': 'app/main.py', 'reason': 'Convert the requested add inputs at the function boundary',
                 'edits': [{'find': 'return a + b', 'replace': 'return int(a) + int(b)'}]},
                {'path': 'tests/test_main.py', 'reason': 'Prove the requested add fix', 'content': ADD_TEST}]})),
            ('flash', json.dumps({'file_scope': ADD_SCOPE + [TEST_SCOPE], 'requirements': [
                {'id': 'R1', 'text': 'Make add() accept numeric strings.', 'met': True,
                 'evidence': {'path': 'app/main.py', 'quote': 'return int(a) + int(b)'},
                 'test': {'path': 'tests/test_main.py', 'quote': "assert add('1', '2') == 3"}}], 'problems': []}))])
        calls, fake_gh = self.world()
        def model(*args, **kwargs):
            prompts.append(args[1])
            return next(answers)
        with patch.object(developer, 'gh', side_effect=fake_gh), patch.object(developer, 'run_model', side_effect=model):
            developer.produce_development_pr(self.issue(), 'key', 'token')
        self.assertIn('"id": "R1", "text": "Make add() accept numeric strings."', prompts[0], 'the planner classifies')
        self.assertIn('CLASSIFIED REQUIREMENTS', prompts[2], 'the review reports requirements by id')
        self.assertEqual(len(prompts), 3, 'classification costs no extra model call')
        body = [body for p, body, m in calls if p == self.ROOT_ + '/pulls' and body][-1]['body']
        self.assertIn('| R1 | Make add() accept numeric strings. | code | `app/main.py` | `tests/test_main.py` '
                      '(ran: full suite passed) | tested |', body)
        self.assertIn('R1 (code): Make add() accept numeric strings.', body, 'the plan lists the classified criteria')



if __name__ == '__main__':
    unittest.main()

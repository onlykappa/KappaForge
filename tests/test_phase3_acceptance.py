"""Scoped feedback → verified source → sandbox regression → safe draft publication.

No live model or GitHub mutations: model and GitHub boundaries are deterministic.
The separate GitHub Docker class executes the real fixture's unmodified tests.
"""
from copy import deepcopy
import io
import json
import os
import subprocess
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

from engine import developer, intent_guard, recovery, review_repair, sandbox, sandbox_repair_controller, task_goal, task_state
from tests import test_review_ingestion as fixture
from tests.test_sandbox_repair_controller import FakeDocker

ROOT = Path(__file__).parent / 'fixtures/sandbox/review-ui'
GOAL = 'Make the Continue button blue and retain its label. Run the original tests before publishing.'


class ButtonDocker(FakeDocker):
    def call(self, args, stdin=b'', **kwargs):
        if args[:1] != ['run']:
            return super().call(args, stdin=stdin, **kwargs)
        self.calls.append((args, stdin))
        with tarfile.open(fileobj=io.BytesIO(stdin), mode='r:*') as archive:
            html = archive.extractfile('index.html').read()
        passed = b'background: #06c' in html and b'>Continue</button>' in html
        return sandbox.Exec(0 if passed else 1, 'Ran 1 test in 0.001s\n' + ('OK\n' if passed else
            'FAIL: test_continue_button_is_blue_and_keeps_its_label\nAssertionError: incorrect color\nFAILED (failures=1)\n'), '')


class ReviewPipelineAcceptance(unittest.TestCase):
    real = False

    def setUp(self):
        for var in (intent_guard.ACTIVE, recovery.CURRENT, task_goal.CURRENT, task_state.ACTION):
            token = var.set(None)
            self.addCleanup(var.reset, token)
        self.files = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
        self.world = fixture.World()
        self.world.pr['base']['ref'] = 'main'
        self.world.issue.update(title=GOAL, body='Repository: '+fixture.REPO+'\nMode: develop\n'+GOAL)
        intent_guard.activate(self.world.issue)
        self.journal = self.world.journal()
        self.journal.checkpoint(fixture.SHA, pr=self.world.pr['html_url'])
        self.world.refs['kappa/dev-130'] = fixture.SHA
        self.world.files = {p: data.decode() for p, data in self.files.items()}
        recovery.CURRENT.set(self.journal)
        task_goal.CURRENT.set(task_goal.Goal(GOAL, paths=('index.html',)))
        task_state.bind(fixture.REPO, 130, 'kappa/dev-130', fixture.SHA, journal=self.journal)
        self.world.feedback['inline'] = [fixture.comment(7, path='index.html', line=2, commit_id=fixture.SHA,
            isResolved=False, isOutdated=False)]
        self.world.feedback['inline'][0]['body'] = 'The Continue button is red; the original task requires blue.'

    def verifier(self, quote, verdict):
        def model(key, prompt, **kw):
            data = json.JSONDecoder().raw_decode(prompt.split('REVIEW_INPUT\n', 1)[1])[0]
            return 'scripted:verifier', json.dumps({'findings': [dict(id=r['id'], verdict=verdict,
                in_goal=True, reason='Compare the current button style with the original blue-button contract',
                owner_quote='Make the Continue button blue', evidence=[dict(path='index.html', quote=quote)]) for r in data['findings']]})
        return model

    def test_scoped_review_is_repaired_tested_and_published_without_lifecycle_actions(self):
        self.journal.ingest_reviews(133)
        read = lambda path: self.files[path].decode()
        batch = review_repair.prepare(self.journal, self.world.pr, read, ['index.html'], self.verifier('background: #c00', 'confirmed'), 'fixture')
        self.assertEqual(len(batch), 1)
        docker = None if self.real else ButtonDocker()
        session = sandbox.Session(sandbox.Tree(fixture.REPO, fixture.SHA, self.files), **({'docker': docker} if docker else {}))
        controller = sandbox_repair_controller.SandboxRepairController(session, journal=self.journal,
            context=dict(kind='fix', base='main'))
        def repair(key, prompt, **kw):
            self.assertIn('incorrect color' if not self.real else 'AssertionError', prompt)
            self.assertFalse(any('/git/commits' in call[0] for call in self.world.calls))
            return 'scripted:repair', json.dumps(dict(tool='apply_patch', reason='Restore the original blue-button contract',
                args=dict(edits=[dict(path='index.html', find='background: #c00', replace='background: #06c')])))
        validation = controller.run_repair(GOAL, repair, 'fixture')
        self.assertEqual((validation['status'], validation['stop_reason']), ('success', 'validated'), validation['summary'])
        self.assertEqual(len(controller.attempts), 1)
        self.assertGreaterEqual(sum(r.profile == 'test' for r in session.results), 3, 'initial failure, correction and fresh final regression')
        changes = validation['candidate_changes']
        review_repair.verify_corrections(batch, {p: data.decode() for p, data in self.files.items()}, changes,
            self.verifier('background: #06c', 'rejected'), 'fixture')
        review_repair.fresh(self.journal, self.world.pr, batch)
        def github(path, token, payload=None, method=None):
            return self.world.read(path) if payload is None else self.world.write(path, payload, method or 'POST')
        with patch.object(developer, 'gh', side_effect=github):
            commit = developer.publish_candidate(fixture.REPO, fixture.SHA, changes, {}, 'Fix reviewed button contract',
                                                 'fixture', 'kappa/dev-130')
        self.world.pr['head']['sha'] = commit['sha']  # The API now reports the branch ref the production publisher updated.
        review_repair.published(self.journal, self.world.pr, batch, fixture.SHA, commit['sha'], validation)
        ledger = review_repair.load(self.world.journal(), 133)
        self.assertEqual(ledger['decisions'][batch[0]['id']]['publication']['candidate'], commit['sha'])
        self.assertEqual(self.world.refs['kappa/dev-130'], commit['sha'])
        self.assertEqual(self.world.files['tests/test_button.py'], self.files['tests/test_button.py'].decode())
        self.assertFalse(any('/merge' in call[0] or call[0] == 'graphql' for call in self.world.calls))
        if self.real or os.getenv('KAPPA_PHASE3_DEMO_EXPORT') == '1':
            directory = Path('/tmp/kappaforge-phase3-demo')
            directory.mkdir(exist_ok=True)
            git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT.parents[3]).decode().strip()
            identity = dict(candidate=git('rev-parse', 'HEAD'), tree=git('rev-parse', 'HEAD^{tree}'),
                            dirty=bool(git('status', '--porcelain')))
            report = dict(version=1, kind='controlled acceptance fixture; no live GitHub publication or model',
                realDocker=self.real, identity=identity, fixtureBase=fixture.SHA, fixturePublished=commit['sha'],
                reviewSource=batch[0]['source'], decisionReceipt=self.journal.state['reviewDecisions']['hash'],
                executionReceipt=self.journal.state['executionCheckpoint']['hash'],
                testResults=validation['test_results'], beforeHtml=self.files['index.html'].decode(),
                afterHtml=changes['index.html'], lifecycleMutations=0, ownerReviewRequired=True)
            (directory / 'source-repair.json').write_text(json.dumps(report, indent=2) + '\n')


@unittest.skipUnless(os.getenv('KAPPA_SANDBOX_INTEGRATION') == '1', 'requires the GitHub-hosted real Docker runner')
class RealDockerReviewAcceptance(ReviewPipelineAcceptance):
    real = True

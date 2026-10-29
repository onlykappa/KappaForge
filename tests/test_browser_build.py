import unittest
from unittest.mock import patch
from engine import browser_build


class BrowserBuildTests(unittest.TestCase):
    def test_only_exact_source_branch_and_browser_job_supply_repair_evidence(self):
        sha = 'a' * 40
        run = dict(id=10, head_sha=sha, head_branch='kappa/dev-130', event='pull_request', path='.github/workflows/tests.yml')
        def api(path, token):
            return {'jobs': [dict(id=12, name='web', status='completed', conclusion='failure')]} if '/jobs?' in path else {'workflow_runs': [run]}
        with patch.object(browser_build, 'gh', side_effect=api):
            result = browser_build.result('kappa/dev-130', sha, 'fixture')
            self.assertEqual((result['conclusion'], result['evidenceKind']), ('failure', 'browser'))
            self.assertIsNone(browser_build.result('kappa/dev-131', sha, 'fixture'))
            self.assertIsNone(browser_build.result('kappa/dev-130', 'b' * 40, 'fixture'))
        self.assertTrue(browser_build.needed('onlykappa/KappaForge', ['preview/ui.js']))
        self.assertFalse(browser_build.needed('onlykappa/KappaForge', ['engine/runner.py']))

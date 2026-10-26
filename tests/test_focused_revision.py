"""Small repair batches read their evidence before unrelated cumulative PR files."""
import unittest
from unittest.mock import Mock, patch
from engine import developer, repair_guard, recovery, task_goal, verify

SHA = 'a' * 40


class FocusedRevisionTests(unittest.TestCase):
    def test_named_changed_and_unchanged_files_beat_the_read_limit(self):
        changed = [f'docs/old-{i}.md' for i in range(40)] + ['docs/audit.md']
        existing = {p: 100 for p in changed + ['engine/dependency.py']}
        problems = ['Requirement not met: docs/audit.md lacks provenance',
                    'Requirement not met: engine/dependency.py lacks the check']
        with patch.object(developer, 'requirements_open', return_value=problems):
            focus, paths = developer.revision_focus({}, '', existing, changed)
        self.assertEqual(focus, problems)
        self.assertEqual(paths[:2], ['docs/audit.md', 'engine/dependency.py'])
        self.assertEqual(len(paths), developer.LARGE.read_files)
        self.assertEqual(len(paths), len(set(paths)))

    def test_failed_check_precedes_backlog_and_never_admits_unlisted_paths(self):
        problems = ['Requirement not met: source.py defect ' + str(i) for i in range(36)]
        with patch.object(developer, 'requirements_open', return_value=problems):
            focus, paths = developer.revision_focus({}, 'tests/failing.py: failed; ../secret.txt',
                                                    {'tests/failing.py': 30, 'source.py': 40}, ['source.py'])
        self.assertEqual(len(focus), 2)
        self.assertTrue(focus[0].startswith('Independent check failure'))
        self.assertEqual(paths, ['tests/failing.py', 'source.py'])

    def test_revision_verifies_two_targets_but_final_review_keeps_every_finding(self):
        problems = [f'Requirement not met: docs/audit.md missing evidence {i}' for i in range(36)]
        issue = dict(number=9, title='Audit', body='Record provenance in docs/audit.md')
        pr = dict(number=50, html_url='https://github.com/onlykappa/KappaForge/pull/50',
                  head={'sha': SHA, 'ref': 'kappa/dev-9', 'repo': {'full_name': developer.ROOT}}, body='Plan')
        files = [dict(filename=f'docs/old-{i}.md', status='modified') for i in range(30)]
        files.append(dict(filename='docs/audit.md', status='modified'))
        existing = {row['filename']: 100 for row in files}
        reads, final = [], []
        def read(repo, path, sha, token):
            self.assertEqual(sha, SHA)
            reads.append(path)
            return '# Audit\nNOT RUN\n'
        def assess(model, key, task, claims, sources, allowed):
            self.assertEqual(claims, problems[:2])
            self.assertIn('docs/audit.md', sources)
            return [dict(claim=c, verdict='confirmed') for c in claims]
        def check(*args, **kwargs):
            final.extend(developer.UNFINISHED)
            return args[8], 'Remaining findings need validation', problems[2:]
        handle = recovery.CURRENT.set(None)
        self.addCleanup(recovery.CURRENT.reset, handle)
        self.addCleanup(developer.UNFINISHED.clear)
        with patch.object(developer, 'revision_files', return_value=files), \
                patch.object(developer, 'requirements_open', return_value=problems), \
                patch.object(developer, 'list_tree', return_value=(existing, {})), \
                patch.object(developer, 'project_guide', return_value=''), \
                patch.object(developer, 'read_source', side_effect=read), \
                patch.object(developer, '_add_engine_developer_source', side_effect=lambda s, *a: s), \
                patch.object(developer, 'gh', return_value=[]), \
                patch.object(repair_guard, 'enabled', return_value=True), \
                patch.object(repair_guard, 'verify_all_findings', side_effect=assess) as assess_mock, \
                patch.object(repair_guard.RepairLoop, 'before_repair', return_value=''), \
                patch.object(developer, 'generate', return_value=('fixture', 'Audit', {'docs/audit.md': '# Evidence'}, '')) as generate, \
                patch.object(developer, 'check_the_work', side_effect=check):
            result = developer.revise_branch(issue, pr, 'kappa/dev-9', SHA, [], 'token', 'key', allowed={'free'})
        self.assertEqual(reads[0], 'docs/audit.md')
        assess_mock.assert_called_once()
        self.assertEqual(final, problems, 'deferred work must not disappear or become complete')
        self.assertIn('Other findings remain open', generate.call_args.args[1])
        self.assertEqual(verify.open_problems({'body': result[3]}), problems[2:])

import unittest
import urllib.error
from unittest.mock import Mock, patch
from engine import commit_provenance, developer, recovery

REPO='onlykappa/KappaForge'
SHA='a'*40

def doc(ref):
    return {'docs/audit.md':f'[commit](https://github.com/{REPO}/commit/{ref})'}

class CommitProvenanceTests(unittest.TestCase):
    def test_generated_placeholders_fail_before_any_write_or_api_lookup(self):
        read=Mock()
        with self.assertRaises(commit_provenance.CommitReferenceError):
            commit_provenance.require_valid(REPO,doc('phase1sha'),read)
        read.assert_not_called()
        with patch.object(developer,'commit_changes') as commit, patch.object(developer,'move_branch') as move:
            with self.assertRaises(commit_provenance.CommitReferenceError):
                developer.publish_candidate(REPO,SHA,doc('phase2sha'),{},'message','token','branch')
        commit.assert_not_called();move.assert_not_called()

    def test_final_publication_revalidates_even_with_saved_receipt(self):
        journal=Mock();journal.state={'executionPublication':{'sha':'b'*40}}
        handle=recovery.CURRENT.set(journal)
        try:
            with patch.object(developer,'gh') as gh,patch.object(developer,'commit_changes') as commit:
                with self.assertRaises(commit_provenance.CommitReferenceError):
                    developer.publish_candidate(REPO,SHA,doc('phase1sha'),{},'message','token','branch')
                gh.assert_not_called();commit.assert_not_called()
        finally: recovery.CURRENT.reset(handle)

    def test_existing_immutable_commit_and_short_reference_pass(self):
        for ref in (SHA,SHA[:7]):
            read=Mock(return_value={'sha':SHA})
            self.assertEqual(commit_provenance.problems(REPO,doc(ref),read),[])
            read.assert_called_once_with(f'repos/{REPO}/commits/{ref}')

    def test_nonexistent_unavailable_and_mismatched_references_fail_closed(self):
        for status in (404,422,403,503):
            read=Mock(side_effect=urllib.error.HTTPError('url',status,'error',{},None))
            self.assertTrue(commit_provenance.problems(REPO,doc(SHA),read))
        for row in ({}, {'sha':'b'*40},None):
            self.assertTrue(commit_provenance.problems(REPO,doc(SHA),lambda path:row))

    def test_deduplication_and_bounded_lookups(self):
        read=Mock(return_value={'sha':SHA})
        self.assertEqual(commit_provenance.problems(REPO,{'docs/a.md':doc(SHA)['docs/audit.md']*20},read),[])
        self.assertEqual(read.call_count,1)
        changes={'docs/a.md':' '.join(doc(f'{n:040x}')['docs/audit.md'] for n in range(33))}
        read.reset_mock();self.assertTrue(commit_provenance.problems(REPO,changes,read));read.assert_not_called()

    def test_no_links_or_other_repository_never_triggers_requests(self):
        read=Mock()
        self.assertEqual(commit_provenance.problems(REPO,{'code.py':'x','doc.md':'https://github.com/other/repo/commit/phase1sha'},read),[])
        read.assert_not_called()

class SourceInspectionPinsTests(unittest.TestCase):
    def setUp(self):
        from engine import task_goal
        self.goal_var = task_goal.CURRENT
        self.task = ('Create only docs/phase3/policy-review.md: document the authorization gate; label this source inspection.\n'
                     'Inspect source and cite file paths/commit-pinned GitHub links.')
        self.token = self.goal_var.set(task_goal.from_request(self.task))
        self.addCleanup(self.goal_var.reset, self.token)

    def blob(self, ref):
        return {'docs/phase3/policy-review.md': f'https://github.com/{REPO}/blob/{ref}/engine/intent_guard.py'}

    def test_mutable_branch_and_short_blob_pins_fail_without_network(self):
        for ref in ('main', 'feature/example', SHA[:7], 'phase1sha'):
            read = Mock()
            problems = commit_provenance.problems(REPO, self.blob(ref), read)
            self.assertTrue(problems, ref)
            self.assertIn('full commit SHA', problems[0])
            read.assert_not_called()

    def test_full_blob_pin_must_resolve_and_shared_commit_is_read_once(self):
        read = Mock(return_value={'sha': SHA})
        changes = self.blob(SHA)
        changes['docs/phase3/policy-review.md'] += '\n' + doc(SHA)['docs/audit.md']
        self.assertEqual(commit_provenance.problems(REPO, changes, read), [])
        read.assert_called_once_with(f'repos/{REPO}/commits/{SHA}')
        read = Mock(side_effect=urllib.error.HTTPError('url', 404, 'missing', {}, None))
        self.assertTrue(commit_provenance.problems(REPO, self.blob(SHA), read))

    def test_final_publication_cannot_accept_a_mutable_source_link(self):
        with patch.object(developer, 'commit_changes') as commit, patch.object(developer, 'move_branch') as move:
            with self.assertRaises(commit_provenance.CommitReferenceError):
                developer.publish_candidate(REPO, SHA, self.blob('main'), {}, 'message', 'token', 'branch')
        commit.assert_not_called()
        move.assert_not_called()

    def test_blob_pins_share_the_existing_reference_bound(self):
        changes = {'docs/phase3/policy-review.md': '\n'.join(self.blob(f'{i:040x}')['docs/phase3/policy-review.md'] for i in range(33))}
        read = Mock()
        self.assertTrue(commit_provenance.problems(REPO, changes, read))
        read.assert_not_called()

    def test_unrelated_documentation_keeps_its_existing_link_policy(self):
        from engine import task_goal
        self.goal_var.set(task_goal.from_request('Update the README introduction.'))
        read = Mock()
        self.assertEqual(commit_provenance.problems(REPO, self.blob('main'), read), [])
        read.assert_not_called()

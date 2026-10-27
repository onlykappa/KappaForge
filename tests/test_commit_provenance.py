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

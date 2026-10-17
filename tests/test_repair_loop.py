import unittest
from engine.repair_loop import candidate, revision_count, MAX_REVISIONS

class RepairLoopTests(unittest.TestCase):
    def test_matching_failed_approved_sandbox(self):
        sha="a"*40
        run={"name":"Sandbox branch tests","conclusion":"failure",
             "display_title":f"Sandbox validation kappa/issue-11 @ {sha}"}
        self.assertEqual(candidate(run),"kappa/issue-11")
    def test_skips_wrong_branch_and_success(self):
        sha="b"*40
        run={"name":"Sandbox branch tests","conclusion":"failure",
             "display_title":f"Sandbox validation kappa/repair-7 @ {sha}"}
        self.assertIsNone(candidate(run))
        run["display_title"]=f"Sandbox validation kappa/issue-7 @ {sha}"
        run["conclusion"]="success"
        self.assertIsNone(candidate(run))
    def test_requires_exact_commit(self):
        self.assertIsNone(candidate({"name":"Sandbox branch tests","conclusion":"failure",
                                     "display_title":"Sandbox validation kappa/issue-7 @ "}))
    def test_retry_markers(self):
        comments=[{"body":"<!-- KAPPA_AUTOFIX:kappa/issue-7:100 -->"},
                  {"body":"<!-- KAPPA_AUTOFIX:kappa/issue-7:101 -->"},
                  {"body":"<!-- KAPPA_AUTOFIX:kappa/issue-8:102 -->"}]
        self.assertEqual(revision_count(comments,"kappa/issue-7"),MAX_REVISIONS)
    def test_failure_evidence_extraction(self):
        from engine.repair_loop import failure_evidence
        jobs=[{"name":"Test","steps":[{"name":"Step1","conclusion":"failure"}]}]
        evidence=failure_evidence(jobs)
        self.assertEqual(len(evidence),1)
        self.assertEqual(evidence[0]["step"],"Step1")

import unittest
from engine.repair_loop import candidate, revision_count, MAX_REVISIONS, repair_diagnosis

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
        self.assertEqual(revision_count(comments,"kappa/issue-7"),2)
        self.assertEqual(MAX_REVISIONS,3)

    def test_repair_diagnosis_does_not_claim_proven_root_cause(self):
        self.assertIn("Identify failing assertions",repair_diagnosis([{"step":"Run unit tests"}]))
        self.assertIn("compilation",repair_diagnosis([{"step":"Build app"}]))
        self.assertIn("Inspect",repair_diagnosis([{"step":"Unexpected runner failure"}]))

    def test_scan_repairs_only_tasks_that_are_still_authorized(self):
        from unittest.mock import patch
        from engine import repair_loop
        from engine.intent_guard import ACTIVE
        sha="c"*40
        runs=[{"id":n,"name":"Sandbox branch tests","conclusion":"failure",
               "display_title":f"Sandbox validation kappa/issue-{n} @ {sha}"} for n in (14,98)]
        def issue(n,token):
            return {"number":n,"state":"open","user":{"login":"onlykappa"},
                    "created_at":"2020-01-01T00:00:00Z" if n==14 else "2099-01-01T00:00:00Z",
                    "body":"Repository: onlykappa/KappaForge\nMode: code\n\nFix"}
        repaired=[]
        def revise(run,token,key):
            repaired.append((run["id"],ACTIVE.get().number));return {"status":"revised"}
        with patch.object(repair_loop,"get_issue",issue),patch.object(repair_loop,"revise_failed_run",revise):
            outcomes=repair_loop.scan_failures("t","k",lambda path,token:{"workflow_runs":runs})
        self.assertEqual(repaired,[(98,98)])
        self.assertEqual(outcomes[0]["status"],"task_not_authorized")
        self.assertIsNone(ACTIVE.get())

    def test_repair_reads_the_real_failure_output(self):
        from unittest.mock import patch
        from engine import repair_loop
        jobs=[{"id":7,"name":"unit","conclusion":"failure","steps":[{"name":"Run tests","conclusion":"failure"}]}]
        with patch.object(repair_loop,"job_log",lambda job_id,token,limit:"FAIL: test_retry\nAssertionError: 2 != 3"):
            self.assertIn("AssertionError: 2 != 3",repair_loop.failure_output(jobs,"t"))

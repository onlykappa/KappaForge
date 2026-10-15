import unittest
from engine.project_memory import snapshot, extract_latest, change_summary

class ProjectMemoryTests(unittest.TestCase):
    def report(self,sha):
        return {"repo":"onlykappa/KappaForge","commit":sha,"paths":["src/main.py"],
                "files":[{"path":"src/main.py","symbols":["main"],"imports":[]}],
                "extensions":{"py":1},"total_indexed":1}

    def test_snapshot_roundtrip(self):
        saved=snapshot(self.report("a"*40))
        recovered=extract_latest([{"body":saved}],"onlykappa/KappaForge")
        self.assertEqual(recovered["commit"],"a"*40)
        self.assertEqual(recovered["files"][0]["symbols"],["main"])

    def test_summarizes_changes_without_guessing(self):
        old=self.report("a"*40)
        new=self.report("b"*40)
        new["paths"]=["src/new.py"]
        result=change_summary(old,new)
        self.assertEqual(result["added_paths"],["src/new.py"])
        self.assertEqual(result["removed_paths"],["src/main.py"])

    def test_rejects_untrusted_or_partial_sha(self):
        for report in ({"repo":"other/repo","commit":"a"*40},
                       {"repo":"onlykappa/KappaForge","commit":"bad"}):
            with self.assertRaises(ValueError):
                snapshot(report)

    def test_skips_invalid_saved_state(self):
        old=[{"body":'<!-- KAPPA_PROJECT_MEMORY_V1 repo=onlykappa/KappaForge sha=bad -->\n\`\`\`json\n{"repo":"onlykappa/KappaForge","commit":"bad"}\n\`\`\`'}]
        self.assertIsNone(extract_latest(old,"onlykappa/KappaForge"))


    def test_reuses_prior_owner_approved_project_maps_only(self):
        from engine.project_memory import recent_repo_memory
        valid={"number":17,"user":{"login":"onlykappa"},
               "body":"Repository: onlykappa/KappaForge\nMode: project-map"}
        forged={"number":18,"user":{"login":"someone_else"},
               "body":"Repository: onlykappa/KappaForge\nMode: project-map"}
        calls=[]
        def gh(path,token):
            calls.append(path)
            if "/issues?" in path:return [forged,valid]
            return [{"body":snapshot(self.report("a"*40))}]
        result=recent_repo_memory("onlykappa/KappaForge",gh,"token",current_issue=19)
        self.assertEqual(result["commit"],"a"*40)
        self.assertTrue(all("/issues/18/" not in p for p in calls))

    def test_cross_issue_memory_rejects_unknown_repo(self):
        from engine.project_memory import recent_repo_memory
        with self.assertRaises(ValueError):
            recent_repo_memory("unknown/repo",lambda *args:[],"token")

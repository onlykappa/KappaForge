import unittest
from engine.handoff import parse_branch, collect

class HandoffTests(unittest.TestCase):
    def test_branch(self):
        self.assertEqual(parse_branch("Repository: onlykappa/OmniPC\nBranch: feat/controller-fix"), "feat/controller-fix")
        self.assertIsNone(parse_branch("No branch here"))
        with self.assertRaises(ValueError):
            parse_branch("Branch: feature/../bad")
    def test_evidence_and_notes(self):
        seen = []
        def api(path):
            seen.append(path)
            if path == "repos/onlykappa/OmniPC":
                return {"default_branch": "main"}
            if "/commits?sha=" in path:
                return [{"sha": "abcdef0123456789", "commit": {"message": "Fix controller"}}]
            if path.endswith("/commits/abcdef0123456789"):
                return {"files": [{"filename": "src/controller.ts", "status": "modified",
                                   "additions": 2, "deletions": 1}]}
            raise AssertionError(path)
        def read(repo, path, sha):
            if path == "KAPPA_HANDOFF.md":
                return "Continue controller work"
            if path in ("README.md", "src/controller.ts"):
                return "real source"
            return ""
        data = collect("onlykappa/OmniPC", "Branch: feat/controller-fix", api, read)
        self.assertIn("abcdef0123456789", data["evidence"])
        self.assertIn("src/controller.ts", data["evidence"])
        self.assertTrue(data["handoff_found"])
        self.assertTrue(any("sha=feat%2Fcontroller-fix" in path for path in seen))

if __name__ == "__main__":
    unittest.main()

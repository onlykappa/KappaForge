import json
import unittest
from unittest.mock import patch
from engine.coder import validate_files, parse_proposal, produce_draft_pr

class CodingSandboxTests(unittest.TestCase):
    def test_valid_file(self):
        self.assertEqual(validate_files([{"path":"projects/demo/app.py","content":"print('hi')"}])[0][0],
                         "projects/demo/app.py")
    def test_reject_secrets_and_workflows(self):
        for path in [".github/workflows/agent.yml", "engine/runner.py", "../secrets",
                     "projects/../engine/runner.py", "projects//broken.py", "projects/a\\b"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_files([{"path":path,"content":"malicious"}])
    def test_reject_large_or_duplicate(self):
        with self.assertRaises(ValueError):
            validate_files([{"path":"projects/a.py","content":"x"*18001}])
        with self.assertRaises(ValueError):
            validate_files([{"path":"projects/a.py","content":"1"},
                            {"path":"projects/a.py","content":"2"}])
    def test_parse(self):
        parsed = parse_proposal(json.dumps({"files":[{"path":"projects/example/main.py","content":"pass"}]}))
        self.assertEqual(parsed[0][1], "pass")
    def test_denies_external_targets(self):
        issue={"number":4,"user":{"login":"onlykappa"},
               "body":"Repository: onlykappa/OmniPC\nMode: code"}
        with self.assertRaises(ValueError):
            produce_draft_pr(issue,"dummy","dummy")
    def test_denies_non_owner(self):
        issue={"number":4,"user":{"login":"someone-else"},
               "body":"Repository: onlykappa/KappaForge\nMode: code"}
        with self.assertRaises(ValueError):
            produce_draft_pr(issue,"dummy","dummy")

if __name__ == "__main__":
    unittest.main()

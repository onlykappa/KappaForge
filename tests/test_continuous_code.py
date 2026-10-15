import unittest
from engine.continuous_code import steps_from_issue

class ContinuousCodingValidation(unittest.TestCase):
    def test_valid_owner_steps(self):
        issue={"body":"Repository: onlykappa/KappaForge\nMode: continuous-code\nStep 1: Build a basic calculator with tests\nStep 2: Build a standalone notes CLI with tests"}
        self.assertEqual(len(steps_from_issue(issue)),2)
    def test_reject_other_repo(self):
        issue={"body":"Repository: onlykappa/OmniPC\nMode: continuous-code\nStep 1: Change the program without approval"}
        with self.assertRaises(ValueError): steps_from_issue(issue)
    def test_reject_duplicate_steps(self):
        issue={"body":"Repository: onlykappa/KappaForge\nMode: continuous-code\nStep 1: Build a basic calculator with tests\nStep 1: Change the login without approval"}
        with self.assertRaises(ValueError): steps_from_issue(issue)
    def test_reject_mode_injection(self):
        issue={"body":"Repository: onlykappa/KappaForge\nMode: audit\nStep 1: Build a basic calculator with tests"}
        with self.assertRaises(ValueError): steps_from_issue(issue)

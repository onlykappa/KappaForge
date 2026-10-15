"""Safety checks for AI generated sandbox files."""
import json
import unittest
from unittest.mock import patch
from engine import coder

class GeneratedCodeSafety(unittest.TestCase):
    def test_invalid_python_is_retried_before_commit(self):
        bad = json.dumps({"files":[{"path":"projects/demo/main.py","content":"def broken(:\n pass"}]})
        good = json.dumps({"files":[{"path":"projects/demo/main.py","content":"def working():\n    return 1\n"}]})
        with patch.object(coder, "run_model", side_effect=[("flash",bad),("flash",good)]) as ai:
            model, files = coder.generate("fake_key","Make a function")
        self.assertEqual(files[0][0],"projects/demo/main.py")
        self.assertEqual(ai.call_count,2)
    def test_refuses_invalid_python_after_two_attempts(self):
        bad = json.dumps({"files":[{"path":"projects/demo/main.py","content":"def broken(:\n pass"}]})
        with patch.object(coder, "run_model", return_value=("flash",bad)):
            with self.assertRaises(ValueError):
                coder.generate("fake_key","Write a function")
    def test_refuses_out_of_scope(self):
        with self.assertRaises(ValueError):
            coder.validate_files([{"path":".github/workflows/deploy-chat.yml","content":"unsafe"}])

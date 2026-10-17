"""Enforce test naming so new Python tests cannot silently escape CI discovery."""
from pathlib import Path
import unittest

TESTS = Path(__file__).resolve().parent

class TestDiscoveryContract(unittest.TestCase):
    def test_python_tests_use_unittest_discovery_names(self):
        ignored = sorted(p.name for p in TESTS.glob("*_test.py") if not p.name.startswith("test_"))
        self.assertEqual(ignored, [], "Rename Python tests to test_*.py so unittest discover runs them")

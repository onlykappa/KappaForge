import unittest
from engine.native_evidence import summarize


class NativeEvidenceTests(unittest.TestCase):
    def result(self, total=5, passed=5, failed=0, skipped=0, result='Passed'):
        return dict(totalTestCount=total, passedTests=passed, failedTests=failed, skippedTests=skipped, result=result)

    def test_executed_simulator_tests_and_device_execution_are_separate(self):
        record = summarize(self.result(), 'a' * 40)
        self.assertEqual(record['state'], 'passed')
        self.assertEqual(record['counts']['passed'], 5)
        self.assertEqual(record['physicalDevice']['state'], 'not_run')

    def test_empty_or_all_skipped_discovery_is_not_a_pass(self):
        for value in (self.result(0, 0), self.result(5, 0, skipped=5)):
            with self.subTest(value=value): self.assertEqual(summarize(value, 'a' * 40)['state'], 'not_run')

    def test_failures_cannot_be_hidden_by_a_success_label(self):
        self.assertEqual(summarize(self.result(5, 4, 1), 'a' * 40)['state'], 'failed')

    def test_unknown_malformed_or_mismatched_counts_are_unverified(self):
        for value in ({}, self.result(passed=True), self.result(total=6), self.result(result='Unknown')):
            with self.subTest(value=value), self.assertRaises(ValueError): summarize(value, 'a' * 40)
        with self.assertRaises(ValueError): summarize(self.result(), 'main')

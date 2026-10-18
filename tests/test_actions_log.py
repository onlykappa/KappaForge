import json
import unittest
from pathlib import Path
from engine.actions_log import headline, parse_log, redact

FIXTURES = Path(__file__).parent / "fixtures" / "actions-logs"


class ActionsLogTests(unittest.TestCase):
    def test_matches_the_shared_fixtures_the_javascript_parser_is_tested_against(self):
        logs = sorted(FIXTURES.glob("*.txt"))
        self.assertGreaterEqual(len(logs), 3)
        for log in logs:
            with self.subTest(log.name):
                expected = json.loads(log.with_suffix(".json").read_text(encoding="utf-8"))
                self.assertEqual(parse_log(log.read_text(encoding="utf-8")), expected)

    def test_headline_names_the_failing_step_or_the_test_totals(self):
        failed = parse_log((FIXTURES / "xcode-build-failure.txt").read_text(encoding="utf-8"))
        self.assertTrue(headline(failed).startswith("Failed in xcodebuild"))
        self.assertIn("cannot find 'bridge' in scope", headline(failed))
        passed = parse_log((FIXTURES / "python-unittest-success.txt").read_text(encoding="utf-8"))
        self.assertEqual(headline(passed), "146 tests passed, 0 failed")
        self.assertEqual(headline(parse_log("")), "No errors found in the log")

    def test_tokens_are_redacted_from_every_line(self):
        out = parse_log("2026-10-18T10:00:00Z token " + "x" * 30 + "\nghp_" + "a" * 36 + "\n")
        self.assertNotIn("x" * 30, json.dumps(out))
        self.assertNotIn("ghp_", json.dumps(out))
        self.assertEqual(redact("https://user:pass@github.com/x"), "https://***@github.com/x")


if __name__ == "__main__":
    unittest.main()

"""Structural security scan (ast-grep) of changes the agent is about to push to another repository."""
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from engine import developer, structural_scan

ROOT = Path(__file__).resolve().parents[1]
REAL = structural_scan.binary()


def finding(file, lines, severity="error", message="runs a shell command (shell=True, os.system or os.popen)"):
    return json.dumps({"file": file, "lines": lines, "severity": severity, "message": message, "ruleId": "x"})


class FakeRun:
    def __init__(self, stdout="", code=1):
        self.stdout, self.code, self.calls = stdout, code, []

    def __call__(self, argv, **kwargs):
        self.calls.append((argv, kwargs, {p.relative_to(kwargs["cwd"]).as_posix(): p.read_text()
                                          for p in Path(kwargs["cwd"]).rglob("*") if p.is_file()}))
        return subprocess.CompletedProcess(argv, self.code, self.stdout, "")


class StructuralScanTests(unittest.TestCase):
    def test_only_added_error_lines_count(self):
        sources = {"app/run.py": "subprocess.run(old, shell=True)\n"}
        changes = {"app/run.py": "subprocess.run(old, shell=True)\nsubprocess.run(new, shell=True)\n", "README.md": "x"}
        out = "\n".join([finding("app/run.py", "subprocess.run(old, shell=True)"),
                         finding("./app/run.py", "subprocess.run(new, shell=True)"),
                         finding("app/run.py", "el.innerHTML = x", severity="warning", message="writes HTML")])
        run = FakeRun(out)
        self.assertEqual(structural_scan.scan(sources, changes, run=run, executable="ast-grep"),
                         {"runs a shell command (shell=True, os.system or os.popen)": ["app/run.py"]})
        argv, kwargs, written = run.calls[0]
        self.assertEqual(argv[:4], ["ast-grep", "scan", "--config", str(ROOT / "sgconfig.yml")])
        self.assertEqual(written, {"app/run.py": changes["app/run.py"]}, "only scannable changed files are written")

    def test_a_pre_existing_match_is_not_flagged(self):
        sources = {"a.py": "os.system(cmd)\n"}
        run = FakeRun(finding("a.py", "os.system(cmd)"))
        self.assertEqual(structural_scan.scan(sources, {"a.py": "os.system(cmd)\nx = 1\n"}, run=run, executable="ast-grep"), {})

    def test_unavailable_or_broken_scans_report_none(self):
        self.assertIsNone(structural_scan.scan({}, {"a.py": "x"}, executable=None) if not REAL else
                          structural_scan.scan({}, {"a.py": "x"}, run=FakeRun(code=2), executable="ast-grep"))
        self.assertIsNone(structural_scan.scan({}, {"a.py": "x"}, run=FakeRun("not json"), executable="ast-grep"))
        def timeout(*a, **k):
            raise subprocess.TimeoutExpired("ast-grep", 60)
        self.assertIsNone(structural_scan.scan({}, {"a.py": "x"}, run=timeout, executable="ast-grep"))
        self.assertEqual(structural_scan.scan({}, {"notes.md": "x"}, executable=None), {}, "nothing to scan is not a failure")

    def test_a_path_cannot_escape_the_scan_folder(self):
        with self.assertRaises(ValueError):
            structural_scan.scan({}, {"../escape.py": "x"}, run=FakeRun(), executable="ast-grep")

    def test_flagged_changes_merge_both_checks(self):
        with patch.object(structural_scan, "scan", return_value={"writes a key, token or password into the code": ["cfg.py"]}):
            flags = developer.flagged_changes({}, {"cfg.py": 'API_KEY = "sk-abcdefghijklmnopqrstuvwxyz"\n',
                                                    "net.py": "fetch('https://example.com')\n"})
        self.assertEqual(flags["writes a key, token or password into the code"], ["cfg.py"])
        self.assertEqual(flags["contacts a web address"], ["net.py"])
        with patch.object(structural_scan, "scan", return_value=None):
            self.assertEqual(developer.flagged_changes({}, {"a.py": "os.environ['X']\n"}),
                             {"reads secrets or environment variables": ["a.py"]}, "word patterns still apply without ast-grep")


@unittest.skipUnless(REAL, "ast-grep is installed in CI (.github/ast-grep-requirements.txt)")
class RealAstGrepTests(unittest.TestCase):
    def test_the_rules_catch_what_word_patterns_miss(self):
        changes = {"tools/deploy.py": "import subprocess\nsubprocess.check_call(cmd,\n    shell = True)\n",
                   "web/app.js": "setTimeout('refresh()', 10)\nconst apiKey = 'sk-abcdefghijklmnopqrstuvwxyz123456'\n",
                   "web/safe.js": "el.textContent = name\nsetTimeout(() => refresh(), 10)\n"}
        flags = structural_scan.scan({}, changes)
        self.assertEqual(flags["runs a shell command (shell=True, os.system or os.popen)"], ["tools/deploy.py"])
        self.assertEqual(flags["runs dynamically built JavaScript (eval, new Function, string timers)"], ["web/app.js"])
        self.assertEqual(flags["writes a key, token or password into the code"], ["web/app.js"])
        self.assertNotIn("web/safe.js", sum(flags.values(), []))
        self.assertEqual(developer.FLAGS[2][1].search("subprocess.check_call(cmd,") is not None, True)
        self.assertIsNone(developer.FLAGS[2][1].search("setTimeout('refresh()', 10)"), "the word patterns miss this one")

    def test_the_rule_tests_pass(self):
        result = subprocess.run([REAL, "test", "--skip-snapshot-tests"], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout[-2000:])


if __name__ == "__main__":
    unittest.main()

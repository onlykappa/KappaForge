"""Recovery from the missing-anchor and malformed-output failures seen on real tasks."""
import json
import unittest
from unittest.mock import patch

from engine import developer


class EditRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.sources = {"preview/app-main.js": 'const form=document.getElementById("form");\nform.addEventListener("submit",send);\n'}
        self.existing = {p: len(t) for p, t in self.sources.items()}
        self.valid = {"files": [{"path": "preview/app-main.js", "edits": [
            {"find": 'form.addEventListener("submit",send)',
             "replace": 'form.addEventListener("submit",sendWeather)'}]}]}

    def generate(self):
        return developer.generate("key", "Add weather submission", developer.ROOT, self.sources, self.existing)

    def test_screenshot_missing_anchor_then_malformed_json_then_success(self):
        missing = {"files": [{"path": "preview/app-main.js", "edits": [{
            "find": 'document.getElementById("form").addEventListener("submit",async e=>{e.preventDefault()',
            "replace": "weather()"}]}]}
        malformed = '{"files":[{"path":"preview/app-main.js" "edits":[]}]}'
        calls = []

        def model(key, prompt, **kwargs):
            calls.append(prompt)
            if len(calls) == 1:
                return "first", json.dumps(missing)
            if len(calls) == 2:
                self.assertIn("<<< CURRENT SOURCE >>>", prompt)
                self.assertIn('form.addEventListener("submit",send)', prompt)
                return "first", malformed
            self.assertIn("JSON parser: Expecting ',' delimiter", prompt)
            self.assertIn("Response near the error", prompt)
            self.assertIn("Escape quotes", prompt)
            return "second", json.dumps(self.valid)

        with patch.object(developer, "run_model", side_effect=model):
            _, _, changes, _ = self.generate()
        self.assertIn("sendWeather", changes["preview/app-main.js"])
        self.assertIn("submit\",send);", self.sources["preview/app-main.js"], "rejected proposals do not mutate source")
        self.assertEqual(len(calls), 3)

    def test_non_object_edit_retries_instead_of_crashing(self):
        for invalid in (42, [], "bad", None):
            with self.subTest(edit=invalid), patch.object(developer, "run_model", side_effect=[
                    ("first", json.dumps({"files": [{"path": "preview/app-main.js", "edits": [invalid]}]})),
                    ("second", json.dumps(self.valid))]) as model:
                _, _, changes, _ = self.generate()
                self.assertIn("sendWeather", changes["preview/app-main.js"])
                self.assertIn("Each edit needs find and replace text", model.call_args.args[1])

    def test_context_skips_large_block_and_rejects_rewriting_unshown_file(self):
        sources = {"too-big.py": "#" * 400, "small.py": "value = 1\n"}
        existing = {p: len(t) for p, t in sources.items()}
        budget = developer.Budget(2, 2, 500, 100, 500)
        hidden = {"files": [{"path": "too-big.py", "content": "value = 0\n"}]}
        good = {"files": [{"path": "small.py", "edits": [{"find": "value = 1", "replace": "value = 2"}]}]}
        with patch.object(developer, "run_model", side_effect=[("first", json.dumps(hidden)), ("second", json.dumps(good))]) as ai:
            _, _, changes, _ = developer.generate_with("key", "task", developer.ROOT, sources, existing, "", None, budget)
        self.assertEqual(changes, {"small.py": "value = 2\n"})
        self.assertIn("===== FILE small.py", ai.call_args_list[0].args[1])
        self.assertNotIn("===== FILE too-big.py", ai.call_args_list[0].args[1])
        self.assertIn("Refusing to overwrite a file that was not read", ai.call_args_list[1].args[1])

    def test_evidence_uses_intermediate_source_and_paths_with_spaces(self):
        source = {"app/my file.js": "const before = 1;\nconst target = 2;\n"}
        proposal = {"files": [{"path": "app/my file.js", "edits": [
            {"find": "before = 1", "replace": "after = 1"},
            {"find": "const target = 3;", "replace": "const target = 4;"}]}]}
        with self.assertRaises(developer.EditMismatch) as caught:
            developer.apply_changes(source, source, proposal)
        evidence = developer.repair_evidence(caught.exception)
        self.assertIn("app/my file.js", evidence)
        self.assertIn("const after = 1;", evidence)
        self.assertIn("const target = 2;", evidence)
        self.assertIn("before = 1", source["app/my file.js"])

    def test_missing_anchor_in_minified_file_shows_relevant_literal_region(self):
        text = "/*" + "x" * 100000 + '*/form.addEventListener("submit",send);' + "/*" + "y" * 100000 + "*/"
        exc = developer.EditMismatch("app.js", 'form.addEventListener("submit",oldSend);', text, 0)
        evidence = developer.repair_evidence(exc)
        self.assertIn('form.addEventListener("submit",send);', evidence)
        self.assertLess(len(evidence), 4000)

    def test_ambiguous_anchor_is_never_fuzzy_applied(self):
        sources = {"main.py": "x = 1\nx = 1\n"}
        proposal = {"files": [{"path": "main.py", "edits": [{"find": "x = 1", "replace": "x = 2"}]}]}
        with self.assertRaises(developer.EditMismatch) as caught:
            developer.apply_changes(sources, sources, proposal)
        self.assertIn("occurs 2 times", developer.repair_evidence(caught.exception))
        self.assertEqual(sources["main.py"], "x = 1\nx = 1\n")


if __name__ == "__main__":
    unittest.main()

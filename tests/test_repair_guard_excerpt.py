import unittest
from pathlib import Path
from engine.repair_guard import payload, reference_lines

class TestRepairGuardExcerpt(unittest.TestCase):
    def test_explicit_repository_line_reference_survives_keyword_compaction(self):
        source = '\n'.join(['# generic audit verification context'] * 300 + ['| 3.1a | NOT RUN | |'] + ['# more context'] * 50)
        data = payload({'docs/audit.md': source}, ['Unmet requirement: docs/audit.md:301 records NOT RUN'], 180)
        self.assertIn('301| | 3.1a | NOT RUN | |', data['sources']['docs/audit.md']['text'])
        self.assertIn(301, data['shown_lines']['docs/audit.md'])
        self.assertNotIn('traceback_lines', data['sources']['docs/audit.md'])
        self.assertEqual(reference_lines(['/tmp/docs/audit.md:301; docs/audit.md:0; docs/audit.md:301'], 'docs/audit.md'), [300])

    def test_actual_force_finding_includes_predicate_not_only_document_claim(self):
        # Run 40550305377 rejected this finding while the decisive predicate was omitted.
        claims = [
            'docs/phase3/policy-publication-review.md: the owner requires commit-pinned links, '
            'but the document cites mutable main links. Replace them with real inspected commit pins; omit invented line ranges.',
            'docs/phase3/policy-publication-review.md: "It does not allow reading arbitrary files via the GitHub Contents API" '
            'is false. engine/intent_guard.py guard_request returns early for GET/HEAD. Correct this documentation claim, not the code.',
            'docs/phase3/policy-publication-review.md: "does not check the force flag" is false for ref updates: '
            'permit requires not (payload or {}).get("force"). Correct the audit text; do not change the guard.',
            'docs/phase3/policy-publication-review.md: distinguish task-only documentation restrictions from owner-preferences.md '
            'policy, and record actual test evidence separately from source inspection. Remove unsupported global logging '
            'or intentional-design-as-bug claims.',
        ]
        path = 'engine/intent_guard.py'
        source = Path(path).read_text()
        data = payload({path: source}, claims)
        predicate = 'not (payload or {}).get("force")'
        self.assertIn(predicate, data['shown'][path])
        self.assertIn('method in {"GET", "HEAD"}', data['shown'][path])
        number = next(i for i, line in enumerate(source.splitlines(), 1) if predicate in line)
        self.assertIn(number, data['shown_lines'][path])
        self.assertIn(f'{number}| ', data['sources'][path]['text'])
        self.assertFalse(data['sources'][path]['complete'])
        self.assertLessEqual(len(data['shown'][path]), 3000)

    def test_literal_anchors_are_exact_bounded_read_leads(self):
        from engine.repair_guard import literal_lines
        source = '\n'.join(['forceful = True'] * 100 + ['if payload.get("force"):', '    return "évidence"'])
        self.assertEqual(literal_lines(['requires "force"'], source), [100])
        self.assertEqual(literal_lines(['requires `return "évidence"`'], source), [101])
        self.assertEqual(literal_lines(['invented `missing predicate` and "forcefulX"'], source), [])
        many = '\n'.join(f'value_{i} = "literal_{i}"' for i in range(50))
        anchors = literal_lines([' '.join(f'`literal_{i}`' for i in range(50))], many)
        self.assertLessEqual(len(anchors), 4)
        # Literal fragments prioritize actual source, never insert claim text into it.
        data = payload({'a.py': source}, ['invented `missing predicate`'], 180)
        self.assertNotIn('missing predicate', data['shown']['a.py'])
        self.assertLessEqual(len(data['shown']['a.py']), 180)

    def setUp(self):
        # Build a synthetic source with many common early lines, a huge opening, and two late unique functions.
        common_block = "\n".join(["import os", "import sys", "# common comment"] * 100)
        large_opening = "#" + "A" * 5000  # very long comment line
        late_funcs = (
            "def produce_development_pr(arg1, arg2):\n    return arg1 + arg2\n"
            "def fix_pull_request(pr_id):\n    pass\n"
        )
        self.source = "\n".join([common_block, large_opening, late_funcs])
        self.path = "dummy.py"
        self.sources = {self.path: self.source}
        self.clues = ["produce_development_pr", "fix_pull_request"]

    def test_payload_includes_late_functions(self):
        # Use the real 3000‑char per‑file budget inside payload (it caps at 3000).
        result = payload(self.sources, self.clues)
        file_info = result["sources"][self.path]
        excerpt_text = file_info["text"]
        # Late functions must be present.
        self.assertIn("def produce_development_pr", excerpt_text)
        self.assertIn("def fix_pull_request", excerpt_text)
        # Omission marker should appear because source exceeds the budget.
        self.assertIn("... omitted ...", excerpt_text)
        # The excerpt must be within the per‑file budget (3000 chars).
        self.assertLessEqual(len(excerpt_text), 3000)
        # The file should be marked as incomplete.
        self.assertFalse(file_info["complete"])

    def test_payload_omits_unrelated_clues(self):
        # Provide a clue that does not exist; excerpt should fall back to a prefix.
        result = payload(self.sources, ["nonexistent_function"])
        file_info = result["sources"][self.path]
        excerpt_text = result["shown"][self.path]  # The raw excerpt; the verifier sees it with line numbers.
        self.assertTrue(file_info["text"].startswith("1| "))
        # Should start with the beginning of the source.
        self.assertTrue(self.source.startswith(excerpt_text.split("... omitted ...", 1)[0]))
        self.assertIn("... omitted ...", excerpt_text)
        # No late functions should be forced in when clue absent.
        self.assertNotIn("def produce_development_pr", excerpt_text)
        self.assertNotIn("def fix_pull_request", excerpt_text)
        # Still respects budget.
        self.assertLessEqual(len(excerpt_text), 3000)

if __name__ == "__main__":
    unittest.main()

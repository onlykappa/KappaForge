"""Reject the #322 copied-helper oracle and prove real imports fail on a mutation."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from engine import verify

PROD = 'src/review.mjs'
TEST = 'tests/review.test.mjs'
SOURCE = 'export function isAnswered(row) { return row.answered === true; }\n'
COPY = "import assert from 'node:assert/strict';\nfunction isAnswered(row) { return row.answered === true; }\nassert.equal(isAnswered({answered:true}),true);\n"
REAL = "import assert from 'node:assert/strict';\nimport {isAnswered} from '../src/review.mjs';\nassert.equal(isAnswered({answered:true}),true);\nassert.equal(isAnswered({answered:false}),false);\n"

class CopiedLogicEvidenceTests(unittest.TestCase):
    def test_copy_is_not_evidence_of_production_behavior(self):
        changes = {PROD: SOURCE, TEST: COPY}
        problems = verify.test_binding_problems(lambda p: '', changes, changes)
        self.assertTrue(any('local copy' in p for p in problems), problems)

    def test_real_production_entry_point_is_accepted(self):
        changes = {PROD: SOURCE, TEST: REAL}
        self.assertEqual(verify.test_binding_problems(lambda p:'',changes,changes), [])

    def test_independent_negative_control_fails_mutated_production(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'src').mkdir();(root/'tests').mkdir()
            (root/TEST).write_text(REAL)
            for source, expected in [(SOURCE,0),(SOURCE.replace('row.answered === true','true'),1)]:
                (root/PROD).write_text(source)
                result=subprocess.run(['node',str(root/TEST)],capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,expected,result.stderr)

    def test_other_test_case_import_does_not_certify_the_new_copied_test(self):
        source = "import {isAnswered as actual} from '../src/review.mjs';\n" + "function earlier(){actual({answered:true});}\n" + "function newTest(){\n" + COPY + "}\n"
        changes={PROD:SOURCE,TEST:source}
        # COPY's import is only valid at module scope; put its assertions in the callback.
        changes[TEST]=source.replace("import assert from 'node:assert/strict';\n",'')
        problems=verify.test_binding_problems(lambda p:'',changes,changes)
        self.assertTrue(any('local copy' in p for p in problems),problems)

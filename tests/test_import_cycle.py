"""A candidate whose module-level imports form a failing cycle is rejected statically, before any checkpoint."""
import glob
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from engine import developer, recovery

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def reader(files):
    return lambda path: files.get(path)


class ImportCycleTests(unittest.TestCase):
    def test_the_e373c6a_shape_is_caught(self):
        # Candidate e373c6a: developer imported repair_loop, which imports job_log back from developer.
        files = {'engine/repair_loop.py': 'from engine.developer import job_log\n', 'engine/__init__.py': ''}
        changes = {'engine/developer.py': 'from engine import repair_loop\n\ndef job_log():\n    return ""\n'}
        self.assertEqual(developer.import_cycle(changes, reader(files)), 'engine.developer -> engine.repair_loop -> engine.developer')

    def test_relative_name_imports_are_resolved(self):
        files = {'engine/b.py': 'from .a import helper\n'}
        self.assertEqual(developer.import_cycle({'engine/a.py': 'from .b import other\nhelper = 1\n'}, reader(files)),
                         'engine.a -> engine.b -> engine.a')

    def test_imports_inside_functions_and_module_only_cycles_are_allowed(self):
        files = {'engine/b.py': 'def run():\n    from engine.a import helper\n    return helper\n'}
        self.assertIsNone(developer.import_cycle({'engine/a.py': 'from engine.b import run\nhelper = 1\n'}, reader(files)))
        files = {'engine/b.py': 'import engine.a\n'}
        self.assertIsNone(developer.import_cycle({'engine/a.py': 'import engine.b\n'}, reader(files)),
                          'plain module imports in a cycle succeed in Python')

    def test_missing_modules_and_unparsable_files_do_not_raise(self):
        self.assertIsNone(developer.import_cycle({'engine/a.py': 'from engine.missing import x\nimport json\n'}, reader({})))
        self.assertIsNone(developer.import_cycle({'engine/a.py': 'def broken(:\n'}, reader({})))
        self.assertIsNone(developer.import_cycle({'docs/a.md': 'from x import y'}, reader({})))

    def test_the_current_engine_has_no_false_positives(self):
        read = lambda path: Path(ROOT, path).read_text() if Path(ROOT, path).exists() else None
        for path in sorted(glob.glob('engine/*.py', root_dir=ROOT) + glob.glob('tools/*.py', root_dir=ROOT)):
            with self.subTest(path=path):
                self.assertIsNone(developer.import_cycle({path: read(path)}, read))

    def test_generation_rejects_a_cycle_and_accepts_the_corrected_proposal(self):
        sources = {'app/main.py': 'def main():\n    return 1\n', 'app/helper.py': 'from app.main import main\n'}
        existing = {path: len(text) for path, text in sources.items()}
        bad = json.dumps({'summary': 's', 'files': [{'path': 'app/main.py', 'reason': 'Use the helper',
                          'edits': [{'find': 'def main():', 'replace': 'from app import helper\n\n\ndef main():'}]}]})
        good = json.dumps({'summary': 's', 'files': [{'path': 'app/main.py', 'reason': 'Use the helper',
                           'edits': [{'find': '    return 1', 'replace': '    from app import helper\n    return 2'}]}]})
        answers = iter([('m1', bad), ('m2', good)])
        handle = recovery.CURRENT.set(None)
        try:
            with patch.object(developer, 'run_model', side_effect=lambda *a, **k: next(answers)):
                _, _, changes, _ = developer.generate('fixture', 'Use the helper', 'onlykappa/KappaForge', sources, existing)
        finally:
            recovery.CURRENT.reset(handle)
        self.assertIn('return 2', changes['app/main.py'])
        self.assertNotIn('from app import helper\n\n\ndef main', changes['app/main.py'])


if __name__ == '__main__':
    unittest.main()

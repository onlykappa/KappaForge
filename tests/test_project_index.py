import unittest
from engine.project_index import safe_paths, summarize_source, index_repository

class ProjectIndexTests(unittest.TestCase):
    def test_rejects_dependency_and_unsafe_paths(self):
        paths=safe_paths([
            {"path":"src/main.py","type":"blob"},
            {"path":"node_modules/a.py","type":"blob"},
            {"path":"../unsafe.py","type":"blob"},
            {"path":"image.png","type":"blob"},
        ])
        self.assertEqual(paths,["src/main.py"])

    def test_python_symbols_and_imports(self):
        doc=summarize_source("src/main.py","import os\nfrom pathlib import Path\nclass Demo:\n    def run(self):\n        pass\n")
        self.assertIn("Demo",doc["symbols"])
        self.assertIn("pathlib",doc["imports"])

    def test_bounded_repo_map(self):
        def gh(path,token):
            if "/branches/" in path:return {"commit":{"sha":"abc"}}
            return {"tree":[{"path":"README.md","type":"blob"},{"path":"app.py","type":"blob"}]}
        def reader(repo,path,ref):return "def hello():\n    pass\n"
        result=index_repository("onlykappa/KappaForge","x",gh,reader)
        self.assertEqual(result["total_indexed"],2)
        self.assertEqual(result["files"][0]["path"],"README.md")

    def test_restricts_repositories(self):
        with self.assertRaises(ValueError):
            index_repository("other/private","x",lambda *a:None,lambda *a:None)

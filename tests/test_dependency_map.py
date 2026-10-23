import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("dependency_map", Path(__file__).resolve().parents[1] / "scripts/dependency-map.py")
dependency_map = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dependency_map)


class DependencyMapTests(unittest.TestCase):
    def test_map_follows_real_imports_and_fits_the_chat_context(self):
        modules = {m["path"]: m for m in dependency_map.build()["modules"]}
        self.assertIn("engine/intent_guard.py", modules["engine/runner.py"]["depends_on"])
        self.assertIn("chat-backend/src/intent-guard.js", modules["chat-backend/src/index.js"]["depends_on"])
        self.assertIn("preview/app-main.js", modules["preview/index.html"]["depends_on"])
        for module in modules.values():
            for path in module["depends_on"]:
                self.assertTrue(path.startswith("ios/") or (dependency_map.ROOT / path).exists(), path)
        # The Worker passes at most 6000 characters of the map to the model.
        self.assertLess(len(dependency_map.render(dependency_map.build())), 6000)

    def test_a_map_over_budget_stays_valid_json_and_says_what_it_left_out(self):
        data = dependency_map.build()
        full = json.loads(dependency_map.render(data, budget=10 ** 6))
        self.assertNotIn("omitted", full)
        for budget in (5000, 4000, 3500):
            text = dependency_map.render(data, budget=budget)
            self.assertLessEqual(len(text), budget)
            small = json.loads(text)
            self.assertGreater(small["omitted"].get("test_links", 0), 0)
            self.assertIn("note", small["omitted"])
            self.assertEqual(len(small["modules"]), len(full["modules"]), "every module stays listed")
        with self.assertRaises(ValueError):
            dependency_map.render(data, budget=100)

import importlib.util
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

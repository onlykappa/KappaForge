import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("release_version", Path(__file__).resolve().parents[1] / "scripts/release-version.py")
release_version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_version)


class ReleaseVersionTests(unittest.TestCase):
    def test_unpublished_configured_version_is_released_as_is(self):
        self.assertEqual(release_version.next_version("2.2.0", ["v2.1.3", "v2.1.2"]), "2.2.0")
        self.assertEqual(release_version.next_version("2.1.3", []), "2.1.3")

    def test_every_merge_after_a_release_gets_the_next_patch(self):
        self.assertEqual(release_version.next_version("2.1.3", ["v2.1.3", "v2.1.2"]), "2.1.4")
        # Auto-released versions are never written back, so the newest tag can be ahead of the config.
        self.assertEqual(release_version.next_version("2.1.3", ["v2.1.5", "v2.1.4", "v2.1.3"]), "2.1.6")
        self.assertEqual(release_version.next_version("2.1.3", ["v2.1.10", "v2.1.9"]), "2.1.11")

    def test_odd_tags_are_ignored(self):
        self.assertEqual(release_version.next_version("2.1.3", ["nightly", "v2.1.3-beta", "v2.1.3"]), "2.1.4")


if __name__ == "__main__":
    unittest.main()

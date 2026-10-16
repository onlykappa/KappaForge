import unittest
from projects.example.main import FeatureManager

class TestFeatures(unittest.TestCase):
    def test_features(self):
        fm = FeatureManager()
        fm.implement_feature("test", lambda x: x * 2)
        self.assertEqual(fm.run_feature("test", 5), 10)

if __name__ == "__main__":
    unittest.main()
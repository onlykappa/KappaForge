import unittest
from unittest.mock import patch, MagicMock
from engine import runner

class ModelRoutingTests(unittest.TestCase):
    def test_approved_models_only(self):
        available = {"gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash", "other"}
        self.assertEqual(runner.select_models(available), ["gemini-3-flash", "gemini-2.5-flash"])

    def test_no_unapproved_fallback(self):
        self.assertEqual(runner.select_models({"gemini-2.5-pro"}), [])

    @patch("engine.runner.urllib.request.urlopen")
    def test_discovery_filters_methods_and_paginates(self, urlopen):
        def response(data):
            result = MagicMock()
            result.__enter__.return_value = result
            result.__exit__.return_value = False
            result.read.return_value = __import__("json").dumps(data).encode()
            return result
        urlopen.side_effect = [
            response({"models":[
                {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},
                {"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}
            ],"nextPageToken":"next"}),
            response({"models":[{"name":"models/gemini-3-flash","supportedGenerationMethods":["generateContent"]}]})
        ]
        self.assertEqual(runner.discover_models("test-key"), {"gemini-2.5-flash", "gemini-3-flash"})
        self.assertEqual(urlopen.call_count, 2)

if __name__ == "__main__":
    unittest.main()

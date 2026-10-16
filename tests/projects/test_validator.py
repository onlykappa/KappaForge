import unittest
from projects.example.main import validate_json

class TestValidator(unittest.TestCase):
    def test_valid_data(self):
        schema = {"id": int}
        data = {"id": 123}
        self.assertTrue(validate_json(data, schema))

    def test_missing_key(self):
        schema = {"id": int}
        data = {}
        with self.assertRaises(ValueError):
            validate_json(data, schema)

    def test_wrong_type(self):
        schema = {"id": int}
        data = {"id": "not-an-int"}
        with self.assertRaises(TypeError):
            validate_json(data, schema)

if __name__ == "__main__":
    unittest.main()
import unittest
from projects.example.main import calculate

class TestCalculator(unittest.TestCase):
    def test_addition(self):
        self.assertEqual(calculate("1+1"), 2)
    
    def test_multiplication(self):
        self.assertEqual(calculate("2*3"), 6)

    def test_invalid(self):
        self.assertIsNone(calculate("abc"))

if __name__ == "__main__":
    unittest.main()
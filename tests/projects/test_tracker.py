import unittest
import os
from projects.example.main import ExpenseTracker

class TestExpenseTracker(unittest.TestCase):
    def setUp(self):
        self.test_file = 'test_expenses.json'
        self.tracker = ExpenseTracker(self.test_file)

    def tearDown(self):
        if os.path.exists(self.test_file):
            os.remove(self.test_file)

    def test_add_expense(self):
        self.tracker.add_expense('Lunch', 15.0)
        self.assertEqual(len(self.tracker.expenses), 1)
        self.assertEqual(self.tracker.get_total(), 15.0)

if __name__ == '__main__':
    unittest.main()
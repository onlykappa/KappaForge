import json
import os

class ExpenseTracker:
    def __init__(self, filename='expenses.json'):
        self.filename = filename
        self.expenses = self.load_expenses()

    def load_expenses(self):
        if os.path.exists(self.filename):
            with open(self.filename, 'r') as f:
                return json.load(f)
        return []

    def add_expense(self, name, amount):
        self.expenses.append({'name': name, 'amount': float(amount)})
        self.save()

    def save(self):
        with open(self.filename, 'w') as f:
            json.dump(self.expenses, f)

    def get_total(self):
        return sum(e['amount'] for e in self.expenses)

if __name__ == '__main__':
    tracker = ExpenseTracker()
    tracker.add_expense('Coffee', 5.0)
    print(f'Total expenses: {tracker.get_total()}')
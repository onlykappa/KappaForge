import unittest
from engine.budget_ledger import Ledger, KINDS

class FakeJournal:
    def __init__(self):
        self.state = {'budgetSpent': {}}
        self.persist_calls = 0

    def persist(self):
        self.persist_calls += 1

class TestBudgetLedger(unittest.TestCase):
    def test_invalid_kind_raises_value_error(self):
        with self.assertRaises(ValueError):
            Ledger(FakeJournal(), 'invalid_kind')

    def test_no_saved_state_starts_at_zero(self):
        ledger = Ledger(FakeJournal(), KINDS[0])
        self.assertEqual(ledger.spent('calls'), 0)

    def test_reads_saved_state(self):
        journal = FakeJournal()
        journal.state['budgetSpent'][KINDS[0]] = {'calls': 5}
        ledger = Ledger(journal, KINDS[0])
        self.assertEqual(ledger.spent('calls'), 5)

    def test_ignores_invalid_saved_values(self):
        journal = FakeJournal()
        journal.state['budgetSpent'][KINDS[0]] = {'calls': -1, 'bytes': 'lots', 'ok': True, 123: 10}
        ledger = Ledger(journal, KINDS[0])
        self.assertEqual(ledger.spent('calls'), 0)
        self.assertEqual(ledger.spent('bytes'), 0)
        self.assertEqual(ledger.spent('ok'), 0)

    def test_record_never_lowers_total(self):
        ledger = Ledger(FakeJournal(), KINDS[0])
        ledger.record({'calls': 10})
        ledger.record({'calls': 5})
        self.assertEqual(ledger.totals['calls'], 10)

    def test_record_persists_and_rounds(self):
        journal = FakeJournal()
        ledger = Ledger(journal, KINDS[0])
        ledger.record({'calls': 1.23456})
        self.assertEqual(journal.state['budgetSpent'][KINDS[0]]['calls'], 1.235)
        self.assertEqual(journal.persist_calls, 1)

    def test_identical_record_persists_only_once(self):
        journal = FakeJournal()
        ledger = Ledger(journal, KINDS[0])
        ledger.record({'calls': 10})
        ledger.record({'calls': 10})
        self.assertEqual(journal.persist_calls, 1)

    def test_none_journal_records_in_memory(self):
        ledger = Ledger(None, KINDS[0])
        ledger.record({'calls': 5})
        self.assertEqual(ledger.totals['calls'], 5)

    def test_kinds_do_not_overwrite(self):
        journal = FakeJournal()
        ledger1 = Ledger(journal, KINDS[0])
        ledger2 = Ledger(journal, KINDS[1])
        ledger1.record({'calls': 1})
        ledger2.record({'calls': 2})
        self.assertEqual(journal.state['budgetSpent'][KINDS[0]]['calls'], 1)
        self.assertEqual(journal.state['budgetSpent'][KINDS[1]]['calls'], 2)

if __name__ == '__main__':
    unittest.main()
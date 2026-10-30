"""Independent regressions for KF-AUDIT-005/006; exercise the real ledger and persisted restart."""
import copy
import unittest
from engine.budget_ledger import Ledger

class Journal:
    def __init__(self, state=None):
        self.state = copy.deepcopy(state or {})
        self.saved = copy.deepcopy(self.state)
        self.writes = 0
    def persist(self):
        self.saved = copy.deepcopy(self.state)
        self.writes += 1

class LedgerIntegrityTests(unittest.TestCase):
    def test_sparse_updates_and_restart_keep_every_counter_and_kind(self):
        journal = Journal()
        ledger = Ledger(journal, 'investigation')
        ledger.record({'calls': 10, 'bytes': 100})
        Ledger(journal, 'research').record({'fetches': 2})
        ledger.record({'calls': 11})
        ledger.record({'bytes': 1})
        restarted = Journal(journal.saved)
        self.assertEqual(Ledger(restarted, 'investigation').spent('calls'), 11)
        self.assertEqual(Ledger(restarted, 'investigation').spent('bytes'), 100)
        self.assertEqual(Ledger(restarted, 'research').spent('fetches'), 2)

    def test_invalid_record_is_rejected_atomically(self):
        for key, value in [('calls', True), ('calls', -1), ('calls', '2'),
                           ('calls', float('nan')), ('calls', float('inf')), (123, 1)]:
            with self.subTest(key=key, value=value):
                j = Journal(); ledger = Ledger(j, 'research'); ledger.record({'calls': 3})
                with self.assertRaises((TypeError, ValueError)):
                    ledger.record({'bytes': 400, key: value})
                self.assertEqual(ledger.totals, {'calls': 3})
                self.assertEqual(j.saved['budgetSpent']['research'], {'calls': 3})
                self.assertEqual(j.writes, 1)

    def test_saved_invalid_values_do_not_survive_or_create_credit(self):
        j = Journal({'budgetSpent': {'research': {'calls': 5, 123: 4, 'bool': True,
            'nan': float('nan'), 'infinite': float('inf'), 'negative': -1, 'text': '2'}}})
        ledger = Ledger(j, 'research')
        self.assertEqual(ledger.prior, {'calls': 5})
        ledger.record({'bytes': 1})
        self.assertEqual(j.saved['budgetSpent']['research'], {'calls': 5, 'bytes': 1})

    def test_malformed_container_does_not_crash_restore(self):
        for saved in [[], True, 'bad']:
            ledger = Ledger(Journal({'budgetSpent': saved}), 'research')
            self.assertEqual(ledger.spent('calls'), 0)

    def test_noop_rounding_and_memory_only(self):
        j = Journal(); ledger = Ledger(j, 'research')
        ledger.record({'seconds': 1.23456}); ledger.record({'seconds': 1.23456})
        self.assertEqual(j.saved['budgetSpent']['research']['seconds'], 1.235)
        self.assertEqual(j.writes, 1)
        memory = Ledger(None, 'research'); memory.record({'calls': 2}); memory.record({'bytes': 3})
        self.assertEqual(memory.totals, {'calls': 2, 'bytes': 3})

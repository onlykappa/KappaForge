import unittest
from datetime import date

from invoice.money import invoice_total_cents, line_total_cents, tax_cents
from invoice.terms import due_date, is_overdue


class MoneyTests(unittest.TestCase):
    def test_tax_rounds_half_cents_up(self):
        self.assertEqual(tax_cents(1999, 8.25), 165)  # 164.9175 cents

    def test_tax_on_whole_cents_is_exact(self):
        self.assertEqual(tax_cents(10000, 7), 700)

    def test_invoice_total_includes_rounded_tax(self):
        self.assertEqual(invoice_total_cents([(1299, 1), (250, 4)], 8.25), 2299 + 190)

    def test_quantities_multiply(self):
        self.assertEqual(line_total_cents(250, 4), 1000)

    def test_negative_amounts_are_rejected(self):
        with self.assertRaises(ValueError):
            tax_cents(-1, 5)


class TermsTests(unittest.TestCase):
    def test_net_terms_count_calendar_days(self):
        self.assertEqual(due_date(date(2026, 1, 30), 30), date(2026, 3, 1))

    def test_due_on_receipt(self):
        self.assertEqual(due_date(date(2026, 5, 4), 0), date(2026, 5, 4))

    def test_not_overdue_on_the_due_date(self):
        self.assertFalse(is_overdue(date(2026, 1, 30), 30, date(2026, 3, 1)))


if __name__ == "__main__":
    unittest.main()

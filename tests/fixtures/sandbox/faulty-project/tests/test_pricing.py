import unittest

from shop.pricing import apply_discount


class DiscountTests(unittest.TestCase):
    def test_a_partial_discount_is_applied_and_rounded(self):
        self.assertEqual(apply_discount(1999, 15), 1699)

    def test_no_and_full_discount(self):
        self.assertEqual(apply_discount(500, 0), 500)
        self.assertEqual(apply_discount(500, 100), 0)

    def test_an_out_of_range_percent_is_refused(self):
        with self.assertRaises(ValueError):
            apply_discount(500, 120)

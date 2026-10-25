import unittest

from shop import cart_total, discount_total, line_total


class PricingTests(unittest.TestCase):
    def test_line_total(self):
        self.assertEqual(line_total(3, 250), 750)

    def test_cart_total(self):
        self.assertEqual(cart_total([(1, 999), (2, 500)]), 1999)


class DiscountTests(unittest.TestCase):
    def test_ten_percent_off(self):
        self.assertEqual(discount_total([(1, 1000)], 10), 900)

    def test_discount_rounds_half_up(self):
        self.assertEqual(discount_total([(1, 1005)], 10), 905)  # 904.5 rounds up

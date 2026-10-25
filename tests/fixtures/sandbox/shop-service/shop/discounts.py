from decimal import Decimal

from shop.pricing import cart_total


def discount_total(lines, percent):
    """Cart total after a percentage discount, rounded half up to the cent."""
    total = Decimal(cart_total(lines))
    return int((total * (Decimal(100) - Decimal(str(percent))) / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))

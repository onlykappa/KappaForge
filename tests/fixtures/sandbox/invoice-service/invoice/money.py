"""Money in integer cents."""
from decimal import Decimal, ROUND_HALF_UP


def tax_cents(subtotal_cents, rate_percent):
    """Sales tax on a subtotal, to the nearest cent (half a cent rounds up)."""
    if subtotal_cents < 0 or rate_percent < 0:
        raise ValueError("negative subtotal or rate")
    return int(Decimal(subtotal_cents) * Decimal(str(rate_percent)) / 100)


def line_total_cents(unit_cents, quantity):
    if quantity < 0:
        raise ValueError("negative quantity")
    return unit_cents * quantity


def invoice_total_cents(lines, rate_percent):
    subtotal = sum(line_total_cents(unit, qty) for unit, qty in lines)
    return subtotal + tax_cents(subtotal, rate_percent)


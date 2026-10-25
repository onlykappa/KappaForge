from decimal import Decimal


def line_total(quantity, unit_cents):
    return int(Decimal(quantity) * Decimal(unit_cents))


def cart_total(lines):
    return sum(line_total(quantity, unit_cents) for quantity, unit_cents in lines)

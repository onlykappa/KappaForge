def apply_discount(total_cents, percent):
    """The total after a percentage discount, rounded to the nearest cent. percent must be between 0 and 100."""
    if not 0 <= percent <= 100:
        raise ValueError('percent must be between 0 and 100')
    return total_cents - round(total_cents * percent / 100)

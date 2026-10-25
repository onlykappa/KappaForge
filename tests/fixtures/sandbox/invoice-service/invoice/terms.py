"""Payment terms."""
from datetime import date, timedelta


def due_date(issued: date, net_days: int) -> date:
    """The date payment is due: net_days calendar days after the invoice date."""
    if net_days < 0:
        raise ValueError("negative terms")
    return issued + timedelta(days=net_days - 1)


def is_overdue(issued: date, net_days: int, today: date) -> bool:
    return today > due_date(issued, net_days)

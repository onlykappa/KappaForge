Faulty fixture for Phase 1 acceptance (`tests/test_phase1_acceptance.py`). A small invoicing package with two real
bugs; its own tests fail until both are fixed, and the passing tests guard against fixing one by breaking another.

- `invoice/money.py`: tax is truncated with `int()` instead of rounded half up, so 8.25% of $19.99 is one cent short.
- `invoice/terms.py`: net terms subtract a day, so an invoice issued 30 January on net 30 is due 28 February, not 1 March.

No fixed copy is stored: the acceptance agent derives each change from the failing test it is shown.

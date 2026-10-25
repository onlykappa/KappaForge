Fixture for Phase 2 section 7 (`tests/test_phase2_exploration_repair.py`). A small shop package whose failing test
depends on a file the initial plan does not know about.

- The task's initial plan reads only `shop/pricing.py`. The generated candidate adds rounding there, which is correct.
- `tests/test_shop.py` imports `discount_total` from the `shop` package. It is defined in `shop/discounts.py`, but
  `shop/__init__.py` never exports it, so the suite fails with `ImportError: cannot import name 'discount_total'`.
- Once that is exported, a second, different error appears: `shop/discounts.py` uses `ROUND_HALF_UP` without
  importing it (`NameError`).

The repair agent has to investigate each new error: find where the name is defined, read the module and the modules
it imports, fix the right file, and run the tests again. No fixed copy is stored.

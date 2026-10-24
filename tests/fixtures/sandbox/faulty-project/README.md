Faulty fixture for the Phase 1 sandbox. Both bugs are real and the tests fail until they are fixed:

- `shop/pricing.py`: the percentage is integer-divided before it is applied, so any discount under 100% is lost.
- `web/cart.mjs`: the total ignores each line's quantity.

The fixed versions live in `fixes/` and are applied only by the tests, never to the fixture itself.

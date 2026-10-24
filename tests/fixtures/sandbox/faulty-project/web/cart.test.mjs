import test from 'node:test';
import assert from 'node:assert/strict';
import {total} from './cart.mjs';

test('the total counts every unit on each line', () => {
  assert.equal(total([{priceCents: 250, qty: 2}, {priceCents: 100, qty: 1}]), 600);
});

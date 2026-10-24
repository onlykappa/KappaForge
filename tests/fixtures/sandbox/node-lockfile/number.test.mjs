import test from 'node:test';
import assert from 'node:assert/strict';
import isNumber from 'is-number';

test('the locked dependency was installed by npm ci', () => {
  assert.equal(isNumber('42'), true);
  assert.equal(isNumber('forty-two'), false);
});

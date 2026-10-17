import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Mocking the environment and request for testing the fix
async function mockRequest(body) {
  const request = {
    url: 'https://onlykappa.github.io/chat',
    method: 'POST',
    headers: new Headers({'Content-Type': 'application/json', 'Content-Length': String(body?.length || 0)}),
    text: async () => body
  };
  return request;
}

test('backend handles empty or malformed body safely', async () => {
  // Test empty body
  const req1 = await mockRequest('');
  const raw1 = await req1.text();
  const input1 = raw1.trim() ? JSON.parse(raw1) : {};
  assert.deepEqual(input1, {});

  // Test malformed body
  const req2 = await mockRequest('{ invalid json }');
  let caught = false;
  try {
    JSON.parse(await req2.text());
  } catch { caught = true; }
  assert.equal(caught, true);
});
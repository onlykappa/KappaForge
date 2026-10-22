import handler from "../chat-backend/src/index.js";

test('weather endpoint returns data for Spokane Valley', async () => {
  const req = new Request('http://localhost/weather?city=Spokane%20Valley');
  const resp = await handler.fetch(req, {}, {});
  expect(resp.status).toBe(200);
  const data = await resp.json();
  // Open‑Meteo includes a "current_weather" object in successful responses
  expect(data.current_weather).toBeDefined();
});

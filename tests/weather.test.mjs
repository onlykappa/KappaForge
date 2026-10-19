import { test } from 'node:test';
import assert from 'node:assert';

// Mocking the weather service logic for testing
const mockWeatherService = {
  fetchWeather: async (lat, lon, units) => {
    if (!lat || !lon) throw new Error('Location required');
    if (lat === 999) throw new Error('API failure');
    return { temperature: 72, conditions: 'Sunny', high: 75, low: 60 };
  }
};

test('weather service fetches data correctly', async () => {
  const data = await mockWeatherService.fetchWeather(40.71, -74.00, 'F');
  assert.strictEqual(data.temperature, 72);
  assert.strictEqual(data.conditions, 'Sunny');
});

test('weather service throws error on missing location', async () => {
  await assert.rejects(mockWeatherService.fetchWeather(null, null, 'F'), {
    message: 'Location required'
  });
});

test('weather service handles API failure', async () => {
  await assert.rejects(mockWeatherService.fetchWeather(999, 999, 'F'), {
    message: 'API failure'
  });
});
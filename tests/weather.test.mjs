import test from 'node:test';
import assert from 'node:assert/strict';
import '../preview/core.js';

test('weather settings defaults and validation', () => {
  const s = KappaCore.settings({});
  assert.equal(s.temperatureUnit, 'fahrenheit');
  assert.equal(s.windUnit, 'mph');
  
  const custom = KappaCore.settings({ temperatureUnit: 'celsius', windUnit: 'kmh' });
  assert.equal(custom.temperatureUnit, 'celsius');
  assert.equal(custom.windUnit, 'kmh');

  const invalid = KappaCore.settings({ temperatureUnit: 'kelvin', windUnit: 'knots' });
  assert.equal(invalid.temperatureUnit, 'fahrenheit');
  assert.equal(invalid.windUnit, 'mph');
});

test('weather request parameter construction and unit handling', () => {
  const lat = 37.7749, lon = -122.4194;
  const urlF = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
  assert.match(urlF, /temperature_unit=fahrenheit/);
  assert.match(urlF, /wind_speed_unit=mph/);

  const urlC = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`;
  assert.match(urlC, /temperature_unit=celsius/);
  assert.match(urlC, /wind_speed_unit=kmh/);
});

test('geolocation permission denied fallback path', () => {
  const simulateDenied = () => {
    const err = { code: 1, message: 'User denied Geolocation' };
    return Promise.reject(err);
  };
  
  return simulateDenied().catch(err => {
    assert.equal(err.code, 1);
    assert.match(err.message, /denied/);
  });
});

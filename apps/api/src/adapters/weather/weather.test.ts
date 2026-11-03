import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../test-support/env.js';
import { FakeWeatherProvider } from './fake.weather.js';
import { OpenWeatherProvider } from './openweather.js';
import { conditionFromOwmId } from './weather.port.js';

const hyd = { lat: 17.385, lng: 78.4867 };

describe('weather', () => {
  it('maps OpenWeather condition ids', () => {
    expect([211, 301, 502, 741, 800, 803, 950].map(conditionFromOwmId)).toEqual([
      'storm',
      'drizzle',
      'rain',
      'mist',
      'clear',
      'clouds',
      'other',
    ]);
  });
  it('parses One Call hourly forecasts', async () => {
    const f = fakeFetch([
      {
        body: {
          hourly: [
            { dt: 1_793_000_000, temp: 31.26, pop: 0.4, weather: [{ id: 500 }] },
            { dt: 1_793_003_600, temp: 30, weather: [] },
          ],
        },
      },
      { body: {} },
    ]);
    const p = new OpenWeatherProvider('key', f.fetch);
    const res = await p.hourlyForecast(hyd);
    expect(res[0]).toEqual({
      time: new Date(1_793_000_000_000).toISOString(),
      tempC: 31.3,
      condition: 'rain',
      precipitationProbability: 0.4,
    });
    expect(res[1]).toMatchObject({ condition: 'other', precipitationProbability: 0 });
    expect(new URL(f.calls[0]?.url ?? '').searchParams.get('units')).toBe('metric');
    expect(await p.hourlyForecast(hyd)).toEqual([]);
  });
  it('produces a deterministic 48h fixture with a rain window, overridable', async () => {
    const fake = new FakeWeatherProvider(() => new Date('2026-10-31T00:10:00Z'));
    const forecast = await fake.hourlyForecast(hyd);
    expect(forecast).toHaveLength(48);
    expect(forecast.some((h) => h.condition === 'rain')).toBe(true);
    expect(forecast[0]?.time).toBe('2026-10-31T00:00:00.000Z');
    fake.setForecast([{ time: 't', tempC: 40, condition: 'clear', precipitationProbability: 0 }]);
    expect(await fake.hourlyForecast(hyd)).toHaveLength(1);
    fake.setForecast(null);
    expect(await new FakeWeatherProvider().hourlyForecast(hyd)).toHaveLength(48);
  });
});

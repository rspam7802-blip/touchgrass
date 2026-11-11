import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../test-support/env.js';
import { FakeWeatherProvider } from './fake.weather.js';
import { conditionFromWmoCode, NoWeatherProvider, OpenMeteoProvider } from './open-meteo.js';
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
  it('maps WMO weather codes (Open-Meteo)', () => {
    expect([0, 2, 45, 53, 63, 81, 95, 71].map(conditionFromWmoCode)).toEqual([
      'clear',
      'clouds',
      'mist',
      'drizzle',
      'rain',
      'rain',
      'storm',
      'other',
    ]);
  });
  it('parses Open-Meteo hourly forecasts without a key, and uses the paid host with one', async () => {
    const f = fakeFetch([
      {
        body: {
          hourly: {
            time: [1_793_000_000, 1_793_003_600, 1_793_007_200],
            temperature_2m: [24.46, null, 22],
            precipitation_probability: [70, 10, null],
            weather_code: [61, 0, null],
          },
        },
      },
      { body: {} },
    ]);
    const free = new OpenMeteoProvider(undefined, f.fetch);
    expect(await free.hourlyForecast(hyd)).toEqual([
      {
        time: new Date(1_793_000_000_000).toISOString(),
        tempC: 24.5,
        condition: 'rain',
        precipitationProbability: 0.7,
      },
      {
        time: new Date(1_793_007_200_000).toISOString(),
        tempC: 22,
        condition: 'other',
        precipitationProbability: 0,
      },
    ]);
    const url = new URL(f.calls[0]?.url ?? '');
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBeNull();
    await new OpenMeteoProvider('k', f.fetch).hourlyForecast(hyd);
    const paid = new URL(f.calls[1]?.url ?? '');
    expect(paid.host).toBe('customer-api.open-meteo.com');
    expect(paid.searchParams.get('apikey')).toBe('k');
  });
  it('none: no forecast at all', async () => {
    expect(await new NoWeatherProvider().hourlyForecast(hyd)).toEqual([]);
  });
});

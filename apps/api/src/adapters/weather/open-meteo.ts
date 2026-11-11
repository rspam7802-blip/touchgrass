import type { GeoPoint } from '@touchgrass/shared';
import { type FetchFn, requestJson } from '../http/http-client.js';
import { type HourlyForecast, type WeatherCondition, WeatherProvider } from './weather.port.js';

interface ForecastResponse {
  hourly?: {
    time: number[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    weather_code: (number | null)[];
  };
}

/** Maps WMO weather codes (https://open-meteo.com/en/docs, "WMO Weather interpretation codes") to our set. */
export function conditionFromWmoCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'clouds';
  if (code === 45 || code === 48) return 'mist';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 95 && code <= 99) return 'storm';
  return 'other';
}

/**
 * Open-Meteo forecast API (D-165): no account or key. Its free tier is for non-commercial use; a commercial
 * deployment uses their paid API (set OPEN_METEO_API_KEY, which switches to the customer host) or OpenWeather.
 */
export class OpenMeteoProvider extends WeatherProvider {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async hourlyForecast(point: GeoPoint): Promise<HourlyForecast[]> {
    const params = new URLSearchParams({
      latitude: String(point.lat),
      longitude: String(point.lng),
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      forecast_days: '2',
      timeformat: 'unixtime',
      timezone: 'UTC',
    });
    if (this.apiKey) params.set('apikey', this.apiKey);
    const host = this.apiKey ? 'customer-api.open-meteo.com' : 'api.open-meteo.com';
    const res = await requestJson<ForecastResponse>(
      this.fetchFn,
      'open-meteo',
      `https://${host}/v1/forecast?${params.toString()}`,
    );
    const h = res.hourly;
    if (!h) return [];
    return h.time.flatMap((t, i) => {
      const temp = h.temperature_2m[i];
      if (temp === null || temp === undefined) return [];
      return [
        {
          time: new Date(t * 1000).toISOString(),
          tempC: Math.round(temp * 10) / 10,
          condition: conditionFromWmoCode(h.weather_code[i] ?? -1),
          precipitationProbability: (h.precipitation_probability[i] ?? 0) / 100,
        },
      ];
    });
  }
}

/** `WEATHER_PROVIDER=none`: no forecast, so plans simply show no weather. */
export class NoWeatherProvider extends WeatherProvider {
  hourlyForecast(_point: GeoPoint): Promise<HourlyForecast[]> {
    return Promise.resolve([]);
  }
}

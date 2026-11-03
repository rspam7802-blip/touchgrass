import type { GeoPoint } from '@touchgrass/shared';
import { type FetchFn, requestJson } from '../http/http-client.js';
import { conditionFromOwmId, type HourlyForecast, WeatherProvider } from './weather.port.js';

interface OneCallResponse {
  hourly?: { dt: number; temp: number; pop?: number; weather: { id: number }[] }[];
}

/** OpenWeather One Call API 3.0, metric units. */
export class OpenWeatherProvider extends WeatherProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async hourlyForecast(point: GeoPoint): Promise<HourlyForecast[]> {
    const params = new URLSearchParams({
      lat: String(point.lat),
      lon: String(point.lng),
      exclude: 'current,minutely,daily,alerts',
      units: 'metric',
      appid: this.apiKey,
    });
    const res = await requestJson<OneCallResponse>(
      this.fetchFn,
      'openweather',
      `https://api.openweathermap.org/data/3.0/onecall?${params.toString()}`,
    );
    return (res.hourly ?? []).map((h) => ({
      time: new Date(h.dt * 1000).toISOString(),
      tempC: Math.round(h.temp * 10) / 10,
      condition: conditionFromOwmId(h.weather[0]?.id ?? 0),
      precipitationProbability: h.pop ?? 0,
    }));
  }
}

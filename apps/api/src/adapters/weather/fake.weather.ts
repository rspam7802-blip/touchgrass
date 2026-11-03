import type { GeoPoint } from '@touchgrass/shared';
import { type HourlyForecast, WeatherProvider } from './weather.port.js';

const HOUR = 3_600_000;

/**
 * Deterministic Hyderabad-like fixture: warm afternoons, pleasant evenings, a rain window on day two.
 * Tests can override with `setForecast`.
 */
export class FakeWeatherProvider extends WeatherProvider {
  private override: HourlyForecast[] | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {
    super();
  }

  setForecast(forecast: HourlyForecast[] | null): void {
    this.override = forecast;
  }

  hourlyForecast(_point: GeoPoint): Promise<HourlyForecast[]> {
    if (this.override) return Promise.resolve(this.override);
    const start = Math.floor(this.now().getTime() / HOUR) * HOUR;
    return Promise.resolve(
      Array.from({ length: 48 }, (_, i) => {
        const time = new Date(start + i * HOUR);
        const istHour = (time.getUTCHours() + 5 + (time.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
        const tempC = 24 + 8 * Math.sin(((istHour - 9) / 24) * 2 * Math.PI);
        const raining = i >= 30 && i < 34;
        return {
          time: time.toISOString(),
          tempC: Math.round(tempC * 10) / 10,
          condition: raining ? 'rain' : istHour >= 11 && istHour <= 16 ? 'clouds' : 'clear',
          precipitationProbability: raining ? 0.8 : 0.05,
        } satisfies HourlyForecast;
      }),
    );
  }
}

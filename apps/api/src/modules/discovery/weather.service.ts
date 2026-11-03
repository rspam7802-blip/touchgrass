import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WeatherNow } from '@touchgrass/shared';
import type { Redis } from 'ioredis';
import { type HourlyForecast, WeatherProvider } from '../../adapters/weather/weather.port.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { CitiesService } from '../cities/cities.service.js';
import type { WeatherAtStart } from './ranking.js';

const KEY = (cityId: string): string => `cache:weather:v1:${cityId}`;
/** Refreshed hourly by the worker; kept a little longer so one failed refresh does not blank the feed. */
const TTL_SECONDS = 3 * 3600;
const HOUR = 3_600_000;

/**
 * Hourly city forecasts (F-DSC-08), cached in Redis per city. The worker refreshes every hour; a cold cache
 * is filled on first use. Provider failures degrade to "no weather" rather than failing the feed.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly provider: WeatherProvider,
    private readonly cities: CitiesService,
  ) {}

  /** Worker job: refresh every launched city. Returns how many cities were refreshed. */
  async refreshAll(): Promise<number> {
    let refreshed = 0;
    for (const city of await this.cities.launchedCityCentres()) {
      if (await this.fetchAndStore(city.id, city.centre)) refreshed += 1;
    }
    return refreshed;
  }

  private async fetchAndStore(
    cityId: string,
    centre: { lat: number; lng: number },
  ): Promise<HourlyForecast[] | null> {
    try {
      const hours = await this.provider.hourlyForecast(centre);
      await this.redis.set(KEY(cityId), JSON.stringify(hours), 'EX', TTL_SECONDS);
      return hours;
    } catch (err) {
      this.logger.warn(
        `weather refresh failed for ${cityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async forecast(cityId: string): Promise<HourlyForecast[] | null> {
    const hit = await this.redis.get(KEY(cityId));
    if (hit) return JSON.parse(hit) as HourlyForecast[];
    const centre = await this.cities.centre(cityId);
    return centre ? this.fetchAndStore(cityId, centre) : null;
  }

  /** The forecast hour covering `at`, or null when it is outside the forecast (or there is none). */
  static atTime(hours: HourlyForecast[] | null, at: Date): WeatherAtStart | null {
    if (!hours) return null;
    const t = at.getTime();
    const hit = hours.find((h) => {
      const start = new Date(h.time).getTime();
      return t >= start && t < start + HOUR;
    });
    return hit
      ? {
          condition: hit.condition,
          tempC: hit.tempC,
          precipitationProbability: hit.precipitationProbability,
        }
      : null;
  }

  async now(cityId: string, at: Date = new Date()): Promise<WeatherNow | null> {
    return WeatherService.atTime(await this.forecast(cityId), at);
  }
}

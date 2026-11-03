import type { GeoPoint } from '@touchgrass/shared';

export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'drizzle' | 'mist' | 'other';

export interface HourlyForecast {
  time: string;
  tempC: number;
  condition: WeatherCondition;
  precipitationProbability: number;
}

/** Hourly forecast for the next 48h (F-DSC-08). Cached per city in Redis by a worker. */
export abstract class WeatherProvider {
  abstract hourlyForecast(point: GeoPoint): Promise<HourlyForecast[]>;
}

/** Maps OpenWeather condition ids (https://openweathermap.org/weather-conditions) to our coarse set. */
export function conditionFromOwmId(id: number): WeatherCondition {
  if (id >= 200 && id < 300) return 'storm';
  if (id >= 300 && id < 400) return 'drizzle';
  if (id >= 500 && id < 600) return 'rain';
  if (id >= 700 && id < 800) return 'mist';
  if (id === 800) return 'clear';
  if (id > 800 && id < 900) return 'clouds';
  return 'other';
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CacheService } from '../cache/cache.service';
import { MAX_WIND_KPH } from './serviceability.constants';

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'unknown';

export interface WeatherConditions {
  windKph: number;
  condition: WeatherCondition;
  flyable: boolean;
  source: 'openweather' | 'mock' | 'unknown';
}

const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const WEATHER_TTL_S = 5 * 60;
const FETCH_TIMEOUT_MS = 2000;

/**
 * Weather provider, real-or-mock (the codebase's standard integration pattern):
 * real OpenWeather when OPENWEATHER_API_KEY is set, a deterministic mock
 * otherwise. ALWAYS fail-open — a weather API hiccup must never ground a
 * delivery (returns flyable=true with source 'unknown'). Results are cached per
 * coarse ~11 km cell to avoid hammering the API.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly apiKey: string | undefined;
  private readonly mockMode: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {
    this.apiKey = this.config.get<string>('weather.apiKey');
    this.mockMode = !this.apiKey;
    if (this.mockMode) {
      this.logger.warn(
        'OPENWEATHER_API_KEY not set — Weather is running in MOCK mode.',
      );
    }
  }

  async getConditions(lat: number, lng: number): Promise<WeatherConditions> {
    const cellLat = Math.round(lat * 10) / 10;
    const cellLng = Math.round(lng * 10) / 10;
    const cacheKey = `weather:${cellLat},${cellLng}`;

    const cached = await this.cache.get<WeatherConditions>(cacheKey);
    if (cached) return cached;

    const conditions = this.mockMode
      ? this.mockConditions(cellLat, cellLng)
      : await this.fetchConditions(cellLat, cellLng);

    await this.cache.set(cacheKey, conditions, WEATHER_TTL_S);
    return conditions;
  }

  private flyable(windKph: number, condition: WeatherCondition): boolean {
    return windKph <= MAX_WIND_KPH && condition !== 'storm';
  }

  /** Deterministic from coords so demos are stable + reproducible. */
  private mockConditions(lat: number, lng: number): WeatherConditions {
    const seed = Math.abs(lat) * 73856093 + Math.abs(lng) * 19349663;
    const rand = Math.abs(Math.sin(seed) * 10000) % 1;

    let condition: WeatherCondition;
    let windKph: number;
    if (rand < 0.78) {
      condition = 'clear';
      windKph = 5 + Math.floor((rand / 0.78) * 15); // 5–20
    } else if (rand < 0.9) {
      condition = 'cloudy';
      windKph = 15 + Math.floor(((rand - 0.78) / 0.12) * 18); // 15–33
    } else if (rand < 0.96) {
      condition = 'rain';
      windKph = 30 + Math.floor(((rand - 0.9) / 0.06) * 18); // 30–48
    } else {
      condition = 'storm';
      windKph = 50 + Math.floor(((rand - 0.96) / 0.04) * 30); // 50–80
    }

    return {
      windKph: Math.round(windKph * 10) / 10,
      condition,
      flyable: this.flyable(windKph, condition),
      source: 'mock',
    };
  }

  private async fetchConditions(
    lat: number,
    lng: number,
  ): Promise<WeatherConditions> {
    const failOpen: WeatherConditions = {
      windKph: 0,
      condition: 'unknown',
      flyable: true,
      source: 'unknown',
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        appid: this.apiKey as string,
        units: 'metric',
      });
      const res = await fetch(`${OPENWEATHER_URL}?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        this.logger.warn(`OpenWeather returned ${res.status} — failing open`);
        return failOpen;
      }
      const data = (await res.json()) as {
        wind?: { speed?: number };
        weather?: Array<{ main?: string }>;
      };
      const windKph = (data.wind?.speed ?? 0) * 3.6; // m/s → kph
      const condition = this.mapCondition(data.weather?.[0]?.main);
      return {
        windKph: Math.round(windKph * 10) / 10,
        condition,
        flyable: this.flyable(windKph, condition),
        source: 'openweather',
      };
    } catch (e) {
      this.logger.warn(
        `Weather fetch failed (${(e as Error).message}) — failing open`,
      );
      return failOpen;
    }
  }

  private mapCondition(main?: string): WeatherCondition {
    switch ((main ?? '').toLowerCase()) {
      case 'clear':
        return 'clear';
      case 'clouds':
        return 'cloudy';
      case 'rain':
      case 'drizzle':
        return 'rain';
      case 'thunderstorm':
        return 'storm';
      default:
        return 'unknown';
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Thin JSON cache over Redis. **Fail-open**: any Redis error is swallowed and
 * treated as a miss, so a cache outage degrades to the uncached path rather than
 * breaking the request.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(
        `cache get failed [${key}]: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `cache set failed [${key}]: ${(error as Error).message}`,
      );
    }
  }

  /** Invalidates a cached key (fail-open). */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `cache del failed [${key}]: ${(error as Error).message}`,
      );
    }
  }

  /** Liveness check for the Redis connection (used by readiness probes). */
  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}

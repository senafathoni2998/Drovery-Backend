import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Builds the shared Redis connection options from config, ready for managed
 * Redis (ElastiCache/Upstash/etc. need auth + TLS). Each role — BullMQ producer,
 * BullMQ worker, cache, and the rate-limiter — builds its OWN client from this
 * base and layers on role-specific flags, so a blocking queue command can never
 * stall a cache read or a throttle check (the connections are never shared).
 */
export function buildRedisOptions(config: ConfigService): RedisOptions {
  const options: RedisOptions = {
    host: config.get<string>('redis.host', 'localhost'),
    port: config.get<number>('redis.port', 6379),
  };

  const password = config.get<string>('redis.password');
  if (password) options.password = password;

  const db = config.get<number>('redis.db');
  if (db) options.db = db;

  // Managed Redis usually requires TLS. `{}` = TLS with default (verified) certs.
  if (config.get<boolean>('redis.tls')) options.tls = {};

  return options;
}

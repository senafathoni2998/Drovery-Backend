import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Logical Redis CONCERNS. At small scale all four collapse onto ONE instance
 * (the default). Past ~1M users the single Redis is a single-threaded saturation
 * point + SPOF (it carries queue + cache + pub/sub + throttler at once), so each
 * concern can be peeled onto its OWN instance / Redis Cluster by setting the
 * matching per-role env var — WITHOUT touching any call site.
 *
 *   - 'queue'    → BullMQ (job durability; KEDA reads its depth)
 *   - 'cache'    → CacheService / GeoService (fail-open, single-key only)
 *   - 'pubsub'   → tracking + support-chat publish/subscribe (telemetry hot path)
 *   - 'throttle' → @nestjs/throttler INCR (highest-RPS Redis consumer)
 */
export type RedisRole = 'queue' | 'cache' | 'pubsub' | 'throttle';

const ROLE_CONFIG_PREFIX: Record<RedisRole, string> = {
  queue: 'redis.queue',
  cache: 'redis.cache',
  pubsub: 'redis.pubsub',
  throttle: 'redis.throttle',
};

/**
 * Builds the Redis connection options for a given ROLE, ready for managed Redis
 * (ElastiCache/Upstash/etc. need auth + TLS). Each role builds its OWN client
 * from these options and layers on role-specific flags, so a blocking queue
 * command can never stall a cache read or a throttle check (connections are
 * never shared).
 *
 * ENDPOINT RESOLUTION (additive + backward-compatible):
 *   - No `role`, OR the role has no per-role host configured → the SHARED
 *     REDIS_HOST/PORT (today's single-Redis behavior, byte-identical).
 *   - A per-role host IS configured (e.g. redis.pubsub.host from REDIS_PUBSUB_HOST)
 *     → that endpoint, falling back per-field to the shared values for any field
 *     the role doesn't override (so you can move just the host and inherit auth/TLS).
 *
 * This is THE env-gated split point for the 1M+ per-concern Redis topology:
 * unset the per-role vars → one Redis for everything; set REDIS_PUBSUB_HOST /
 * REDIS_THROTTLE_HOST / REDIS_QUEUE_HOST / REDIS_CACHE_HOST → fan the concerns
 * onto dedicated instances or Clusters.
 */
export function buildRedisOptions(
  config: ConfigService,
  role?: RedisRole,
): RedisOptions {
  const prefix = role ? ROLE_CONFIG_PREFIX[role] : undefined;

  // Per-field resolver: prefer the role-specific value, fall back to the shared one.
  const resolve = <T>(
    field: string,
    shared: string,
    fallback?: T,
  ): T | undefined => {
    if (prefix) {
      const roleVal = config.get<T>(`${prefix}.${field}`);
      if (roleVal !== undefined && roleVal !== null && roleVal !== '')
        return roleVal;
    }
    const sharedVal = config.get<T>(shared);
    return sharedVal !== undefined && sharedVal !== null ? sharedVal : fallback;
  };

  const options: RedisOptions = {
    host: resolve<string>('host', 'redis.host', 'localhost')!,
    port: resolve<number>('port', 'redis.port', 6379)!,
  };

  const password = resolve<string>('password', 'redis.password');
  if (password) options.password = password;

  const db = resolve<number>('db', 'redis.db');
  if (db) options.db = db;

  // Managed Redis usually requires TLS. `{}` = TLS with default (verified) certs.
  // A per-role tls override wins; otherwise inherit the shared flag.
  const tls = resolve<boolean>('tls', 'redis.tls');
  if (tls) options.tls = {};

  return options;
}

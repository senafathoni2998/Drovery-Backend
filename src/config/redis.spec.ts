import { buildRedisOptions, type RedisRole } from './redis';

/**
 * Minimal ConfigService stand-in: looks up dotted keys in a plain object so the
 * test can assert exactly which endpoint a role resolves to without booting Nest.
 */
function fakeConfig(values: Record<string, unknown>) {
  return {
    get: <T>(key: string, def?: T): T | undefined => {
      const v = values[key];
      return (v === undefined ? def : v) as T | undefined;
    },
  } as any;
}

const SHARED = {
  'redis.host': 'shared-redis',
  'redis.port': 6379,
  'redis.password': 'shared-pw',
  'redis.db': 0,
  'redis.tls': false,
};

describe('buildRedisOptions — per-concern endpoint resolution', () => {
  it('with no role → the shared REDIS_* endpoint (today, byte-identical)', () => {
    const opts = buildRedisOptions(fakeConfig(SHARED));
    expect(opts.host).toBe('shared-redis');
    expect(opts.port).toBe(6379);
    expect(opts.password).toBe('shared-pw');
  });

  it('with a role but NO per-role override → falls back to the shared endpoint', () => {
    const opts = buildRedisOptions(fakeConfig(SHARED), 'pubsub');
    expect(opts.host).toBe('shared-redis');
    expect(opts.port).toBe(6379);
  });

  it('with a per-role host set → uses the role endpoint (concern peeled off)', () => {
    const opts = buildRedisOptions(
      fakeConfig({
        ...SHARED,
        'redis.pubsub.host': 'pubsub-redis-cluster',
        'redis.pubsub.port': 6380,
      }),
      'pubsub',
    );
    expect(opts.host).toBe('pubsub-redis-cluster');
    expect(opts.port).toBe(6380);
  });

  it('inherits shared auth/TLS for fields the role does not override', () => {
    // Only the HOST is moved; password + tls come from the shared values.
    const opts = buildRedisOptions(
      fakeConfig({
        ...SHARED,
        'redis.tls': true,
        'redis.throttle.host': 'throttle-redis',
      }),
      'throttle',
    );
    expect(opts.host).toBe('throttle-redis');
    expect(opts.password).toBe('shared-pw'); // inherited
    expect(opts.tls).toEqual({}); // inherited TLS flag → verified-cert TLS
  });

  it('a per-role override for ONE role does not leak into ANOTHER role', () => {
    const cfg = fakeConfig({
      ...SHARED,
      'redis.queue.host': 'queue-only-redis',
    });
    expect(buildRedisOptions(cfg, 'queue').host).toBe('queue-only-redis');
    // cache has no override → still the shared endpoint.
    expect(buildRedisOptions(cfg, 'cache').host).toBe('shared-redis');
  });

  it('treats an empty-string per-role host as unset (falls back)', () => {
    const opts = buildRedisOptions(
      fakeConfig({ ...SHARED, 'redis.cache.host': '' }),
      'cache',
    );
    expect(opts.host).toBe('shared-redis');
  });

  it.each<RedisRole>(['queue', 'cache', 'pubsub', 'throttle'])(
    'resolves role %s to the shared endpoint by default',
    (role) => {
      expect(buildRedisOptions(fakeConfig(SHARED), role).host).toBe(
        'shared-redis',
      );
    },
  );
});

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  // Comma-separated allowlist for browser CORS (e.g. https://app.drovery.com).
  // Unset → wildcard (fine for the native app; lock down before a web client).
  corsOrigins: process.env.CORS_ORIGINS,

  database: {
    url: process.env.DATABASE_URL,
    // Max connections PER instance in the pg pool. With N API/worker instances,
    // keep N × poolMax under Postgres `max_connections` — or front Postgres with
    // PgBouncer (see docker-compose) so it multiplexes thousands of clients onto
    // a small server-side pool. This is the classic autoscaling failure mode.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    // Managed Redis (ElastiCache/Upstash/etc.) typically needs auth + TLS.
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    tls: process.env.REDIS_TLS === 'true',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  },

  geocoding: {
    provider: process.env.GEOCODING_PROVIDER ?? 'nominatim',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  },

  // Weather for drone serviceability — unset key → deterministic mock provider.
  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY,
  },

  expo: {
    accessToken: process.env.EXPO_ACCESS_TOKEN,
  },

  notifications: {
    // Quiet-hours are wall-clock, so they must be evaluated in a real timezone,
    // not the (UTC) container's local time. Every service area today is WIB
    // (UTC+7); per-user timezones are a future enhancement.
    timezone: process.env.NOTIFICATIONS_TZ ?? 'Asia/Jakarta',
  },

  // Prometheus metrics. enabled defaults on (set METRICS_ENABLED=false to kill
  // the endpoint). port = the worker's standalone metrics HTTP server.
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT ?? '9091', 10),
  },

  // Error tracking — unset SENTRY_DSN → reporting is a no-op (dev/local).
  sentry: {
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
  },

  mail: {
    // When unset, MailService logs emails instead of sending (dev mode).
    provider: process.env.MAIL_PROVIDER,
    from: process.env.MAIL_FROM ?? 'no-reply@drovery.com',
  },

  storage: {
    // When unset, StorageService persists photos inline (data URLs) + placeholders.
    provider: process.env.STORAGE_PROVIDER,
    placeholderBase:
      process.env.POD_PLACEHOLDER_BASE ?? 'https://picsum.photos/seed',
  },
});

import * as Sentry from '@sentry/node';

/**
 * Error tracking, real-or-mock (the codebase's standard integration pattern):
 * when SENTRY_DSN is set, exceptions are reported to Sentry; otherwise every
 * call here is a safe no-op. Sentry.init MUST run before the app's module graph
 * is imported, so this module is imported at the very top of main.ts / worker.ts
 * (right after dotenv, so the DSN is in process.env).
 */
const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // 0 = no performance tracing by default; raise to sample transactions.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
  });
}

/** Report an exception (no-op when Sentry is disabled). */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!sentryEnabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

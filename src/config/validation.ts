import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  PORT: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  // In production, refuse to boot with a weak/default JWT secret.
  if (config.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const raw = config[key];
      const value = typeof raw === 'string' ? raw : '';
      if (value.length < 24 || /change|example|xxxx|placeholder/i.test(value)) {
        throw new Error(
          `${key} is weak or a placeholder — set a strong (>=24 char) secret in production`,
        );
      }
    }

    // The load-test throttle bypass must NEVER be live in production.
    if (config.LOADTEST_BYPASS_THROTTLE === 'true') {
      throw new Error(
        'LOADTEST_BYPASS_THROTTLE must not be set in production — it disables rate limiting',
      );
    }

    // The public /payments/webhook endpoint mutates payment status and is trusted ONLY via the
    // Stripe signature. StripeService falls into an UNSIGNED mock-parse path whenever
    // STRIPE_SECRET_KEY is absent, so a production deploy missing the keys (secret-store outage,
    // partial env, key rotation) would fail OPEN and accept forged events. Require both keys
    // (non-placeholder) so we fail to BOOT instead of failing open.
    for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const) {
      const raw = config[key];
      const value = typeof raw === 'string' ? raw : '';
      if (!value || /change|example|xxxx|placeholder/i.test(value)) {
        throw new Error(
          `${key} is missing or a placeholder — required in production (the Stripe webhook must verify signatures, never run in mock/unsigned mode)`,
        );
      }
    }
  }

  return validated;
}

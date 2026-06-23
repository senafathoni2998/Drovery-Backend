import 'reflect-metadata';

import { validate } from './validation';

// A baseline of the required env (PORT + DB + both JWT secrets).
const base = () => ({
  PORT: 3000,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/drovery',
  JWT_SECRET: 'dev-access-secret',
  JWT_REFRESH_SECRET: 'dev-refresh-secret',
});

const STRONG = 'super_strong_prod_secret_value_0123456789';

describe('config validation', () => {
  it('passes with the required vars present (non-production)', () => {
    expect(() => validate(base())).not.toThrow();
  });

  it('throws when a required var is missing', () => {
    const cfg = base();
    delete (cfg as Record<string, unknown>).DATABASE_URL;
    expect(() => validate(cfg)).toThrow();
  });

  describe('production boot guards', () => {
    it('refuses to boot with a weak/placeholder JWT secret', () => {
      expect(() => validate({ ...base(), NODE_ENV: 'production' })).toThrow(
        /weak or a placeholder/,
      );
    });

    it('boots with strong secrets in production', () => {
      expect(() =>
        validate({
          ...base(),
          NODE_ENV: 'production',
          JWT_SECRET: STRONG,
          JWT_REFRESH_SECRET: `${STRONG}_refresh`,
          STRIPE_SECRET_KEY: 'sk_live_realkey0123456789',
          STRIPE_WEBHOOK_SECRET: 'whsec_realsecret0123456789',
        }),
      ).not.toThrow();
    });

    it('refuses to boot WITHOUT the Stripe keys in production (the webhook would fail open)', () => {
      expect(() =>
        validate({
          ...base(),
          NODE_ENV: 'production',
          JWT_SECRET: STRONG,
          JWT_REFRESH_SECRET: `${STRONG}_refresh`,
          STRIPE_WEBHOOK_SECRET: 'whsec_realsecret0123456789',
        }),
      ).toThrow(/STRIPE_SECRET_KEY/);
    });

    it('refuses to boot with placeholder Stripe keys in production', () => {
      expect(() =>
        validate({
          ...base(),
          NODE_ENV: 'production',
          JWT_SECRET: STRONG,
          JWT_REFRESH_SECRET: `${STRONG}_refresh`,
          STRIPE_SECRET_KEY: 'sk_test_xxxx',
          STRIPE_WEBHOOK_SECRET: 'whsec_xxxx',
        }),
      ).toThrow(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
    });

    it('refuses to boot if LOADTEST_BYPASS_THROTTLE is set in production', () => {
      expect(() =>
        validate({
          ...base(),
          NODE_ENV: 'production',
          JWT_SECRET: STRONG,
          JWT_REFRESH_SECRET: `${STRONG}_refresh`,
          LOADTEST_BYPASS_THROTTLE: 'true',
        }),
      ).toThrow(/LOADTEST_BYPASS_THROTTLE must not be set in production/);
    });

    it('allows LOADTEST_BYPASS_THROTTLE outside production', () => {
      expect(() =>
        validate({ ...base(), LOADTEST_BYPASS_THROTTLE: 'true' }),
      ).not.toThrow();
    });
  });
});

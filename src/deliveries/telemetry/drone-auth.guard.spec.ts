import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

import { DroneAuthGuard } from './drone-auth.guard';

describe('DroneAuthGuard', () => {
  const makeConfig = (env: Record<string, string | undefined>) =>
    ({ get: (k: string) => env[k] }) as any;

  const makeContext = (
    headers: Record<string, string>,
    rawBody?: Buffer,
    body?: unknown,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers, rawBody, body }),
      }),
    }) as any;

  it('denies (fail-closed) when INGEST_API_KEY is not configured', () => {
    const guard = new DroneAuthGuard(makeConfig({}));
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-key': 'anything' })),
    ).toThrow(UnauthorizedException);
  });

  it('allows a request with the correct key (no HMAC configured)', () => {
    const guard = new DroneAuthGuard(makeConfig({ INGEST_API_KEY: 'secret-key' }));
    expect(
      guard.canActivate(makeContext({ 'x-ingest-key': 'secret-key' })),
    ).toBe(true);
  });

  it('denies a request with a wrong key', () => {
    const guard = new DroneAuthGuard(makeConfig({ INGEST_API_KEY: 'secret-key' }));
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-key': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('denies a request with a missing key header', () => {
    const guard = new DroneAuthGuard(makeConfig({ INGEST_API_KEY: 'secret-key' }));
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  describe('with HMAC enabled', () => {
    const KEY = 'secret-key';
    const HMAC_SECRET = 'hmac-secret';
    const rawBody = Buffer.from(JSON.stringify({ deliveryId: 'd-1' }));
    const sign = (ts: number) =>
      crypto
        .createHmac('sha256', HMAC_SECRET)
        .update(Buffer.concat([Buffer.from(`${ts}.`), rawBody]))
        .digest('hex');

    const guard = new DroneAuthGuard(
      makeConfig({ INGEST_API_KEY: KEY, INGEST_HMAC_SECRET: HMAC_SECRET }),
    );

    it('allows a correctly-signed, fresh request', () => {
      const ts = Date.now();
      expect(
        guard.canActivate(
          makeContext(
            {
              'x-ingest-key': KEY,
              'x-ingest-timestamp': String(ts),
              'x-ingest-signature': sign(ts),
            },
            rawBody,
          ),
        ),
      ).toBe(true);
    });

    it('denies when the signature is wrong', () => {
      const ts = Date.now();
      expect(() =>
        guard.canActivate(
          makeContext(
            {
              'x-ingest-key': KEY,
              'x-ingest-timestamp': String(ts),
              'x-ingest-signature': 'deadbeef',
            },
            rawBody,
          ),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('denies when the signature header is absent', () => {
      const ts = Date.now();
      expect(() =>
        guard.canActivate(
          makeContext(
            { 'x-ingest-key': KEY, 'x-ingest-timestamp': String(ts) },
            rawBody,
          ),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('denies when the timestamp header is absent', () => {
      const ts = Date.now();
      expect(() =>
        guard.canActivate(
          makeContext(
            { 'x-ingest-key': KEY, 'x-ingest-signature': sign(ts) },
            rawBody,
          ),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('denies a stale/replayed frame (timestamp outside tolerance)', () => {
      // A captured frame: valid signature, but the timestamp is 10 minutes old.
      const staleTs = Date.now() - 10 * 60_000;
      expect(() =>
        guard.canActivate(
          makeContext(
            {
              'x-ingest-key': KEY,
              'x-ingest-timestamp': String(staleTs),
              'x-ingest-signature': sign(staleTs),
            },
            rawBody,
          ),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('denies when the timestamp is re-signed but mismatches the signed value', () => {
      // Attacker freshens the timestamp header but cannot recompute the HMAC
      // (no secret) — binding the signature to the timestamp defeats the replay.
      const oldTs = Date.now() - 60_000;
      const freshTs = Date.now();
      expect(() =>
        guard.canActivate(
          makeContext(
            {
              'x-ingest-key': KEY,
              'x-ingest-timestamp': String(freshTs),
              'x-ingest-signature': sign(oldTs),
            },
            rawBody,
          ),
        ),
      ).toThrow(UnauthorizedException);
    });
  });
});

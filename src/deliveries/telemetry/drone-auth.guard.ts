import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import * as crypto from 'crypto';

import {
  INGEST_KEY_HEADER,
  INGEST_SIGNATURE_HEADER,
  INGEST_SIGNATURE_TOLERANCE_MS,
  INGEST_TIMESTAMP_HEADER,
} from './telemetry.constants';

/**
 * Authenticates a drone-gateway (a NON-USER actor) for the telemetry ingest
 * endpoint. The route is @Public() so the global JwtAuthGuard skips it — a user
 * JWT is neither required nor sufficient here. This guard is the real gate.
 *
 * Posture mirrors the Stripe webhook (a @Public route + a machine signature
 * check) and is FAIL-CLOSED, the opposite of the fail-open TrackingPublisher:
 * if INGEST_API_KEY is unset the endpoint is disabled (every request denied), so
 * an unconfigured deployment can never be driven.
 *
 * Auth = a shared key (constant-time compared) and, when INGEST_HMAC_SECRET is
 * set, an HMAC-SHA256 over `${timestamp}.${rawBody}` PLUS a freshness window on
 * that timestamp — the same anti-replay posture as the Stripe webhook (a bare
 * body HMAC would let a captured frame be replayed verbatim). The signature is
 * verified against req.rawBody so a re-serialized body can't break the match.
 * Per-device certs / mTLS are deferred (fleet-scale); a rotatable shared key is
 * proportionate for a portfolio backend with no hardware.
 */
@Injectable()
export class DroneAuthGuard implements CanActivate {
  private readonly logger = new Logger(DroneAuthGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    const expectedKey = this.config.get<string>('INGEST_API_KEY');
    if (!expectedKey) {
      // Fail-closed: never authenticate against an unconfigured secret.
      this.logger.warn(
        'Telemetry ingest denied: INGEST_API_KEY is not configured (endpoint disabled).',
      );
      throw new UnauthorizedException('Telemetry ingest is not enabled');
    }

    const providedKey = this.headerValue(req, INGEST_KEY_HEADER);
    if (!providedKey || !this.constantTimeEquals(providedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid ingest credentials');
    }

    // Optional second factor: a timestamped HMAC over the raw body. Only enforced
    // when a secret is configured, so a key-only deployment still works.
    const hmacSecret = this.config.get<string>('INGEST_HMAC_SECRET');
    if (hmacSecret) {
      // Freshness window first — a frame whose timestamp is stale (or absent) is
      // a replay/clock-skew and is rejected before the (expensive) HMAC compare.
      const timestamp = this.headerValue(req, INGEST_TIMESTAMP_HEADER);
      const ts = Number(timestamp);
      if (!timestamp || !Number.isFinite(ts)) {
        throw new UnauthorizedException('Missing or invalid ingest timestamp');
      }
      if (Math.abs(Date.now() - ts) > INGEST_SIGNATURE_TOLERANCE_MS) {
        throw new UnauthorizedException('Ingest timestamp outside tolerance');
      }

      const signature = this.headerValue(req, INGEST_SIGNATURE_HEADER);
      const rawBody =
        req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      // Bind the signature to the timestamp AND the request line (method + full
      // path incl. query). The timestamp blocks replay with a fresh time; binding
      // method+URL blocks RETARGETING a captured signature onto a different route —
      // critical for the command channel where the selector lives OUTSIDE the body
      // (the poll's ?droneId= in the query, the ack's :id in the path). rawBody
      // stays exact bytes (no re-serialization). Strictly strengthens the telemetry
      // POST too (whose selector is already in the body).
      const method = req.method ?? '';
      const url = req.originalUrl ?? req.url ?? '';
      const signedPayload = Buffer.concat([
        Buffer.from(`${timestamp}.${method}.${url}.`),
        rawBody,
      ]);
      const expectedSig = crypto
        .createHmac('sha256', hmacSecret)
        .update(signedPayload)
        .digest('hex');
      if (!signature || !this.constantTimeEquals(signature, expectedSig)) {
        throw new UnauthorizedException('Invalid ingest signature');
      }
    }

    return true;
  }

  private headerValue(
    req: RawBodyRequest<Request>,
    name: string,
  ): string | undefined {
    const raw = req.headers?.[name];
    return Array.isArray(raw) ? raw[0] : raw;
  }

  /**
   * Constant-time string compare. Both sides are SHA-256'd to a fixed length
   * first, so neither the length nor the content of the secret leaks via timing
   * (and timingSafeEqual never throws on a length mismatch).
   */
  private constantTimeEquals(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  }
}

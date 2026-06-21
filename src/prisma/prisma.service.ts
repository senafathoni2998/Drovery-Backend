import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Applied to BOTH the primary and the reader so a replica read can NEVER leak the
// handoff OTP hash / attempt counter the primary hides. confirmHandoff opts these
// back in (omit:{...:false}) on the PRIMARY only — handoff is a write-path flow.
const READER_OMIT = {
  delivery: { handoffCodeHash: true, handoffAttempts: true },
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  // A second client bound to a READ REPLICA, built only when DATABASE_REPLICA_URL
  // is set. Null otherwise (and after a failed boot connect) → reads fall back to
  // the primary, so single-DB dev/test/CI behave byte-identically.
  private readerClient: PrismaClient | null = null;

  constructor() {
    // Bound the per-instance primary pool. With N replicas, N × max must stay
    // under Postgres `max_connections` — or point DATABASE_URL at PgBouncer.
    const max = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max });
    super({ adapter: new PrismaPg(pool as any), omit: READER_OMIT });

    // Only the API tier serves the lag-tolerant reads — the worker routes none
    // (it drives CAS writes + direct primary reads), so it must not build/connect a
    // reader it would never use (the shared configMap/secret puts the replica URL on
    // both pods). Mirrors the IS_API convention in deliveries.module.ts.
    const replicaUrl = process.env.DATABASE_REPLICA_URL;
    const isApiTier = process.env.PROCESS_ROLE !== 'worker';
    if (replicaUrl && isApiTier) {
      // Separate pool/budget for the replica (default to the primary's max; tune
      // DATABASE_REPLICA_POOL_MAX down for the API, or front the replica with its
      // own PgBouncer, so the replica's max_connections isn't exhausted at scale).
      const readerMax = parseInt(
        process.env.DATABASE_REPLICA_POOL_MAX ?? String(max),
        10,
      );
      const readerPool = new Pool({
        connectionString: replicaUrl,
        max: readerMax,
      });
      this.readerClient = new PrismaClient({
        adapter: new PrismaPg(readerPool as any),
        omit: READER_OMIT,
      });
    }
  }

  /**
   * Run a LAG-TOLERANT read (owner-scoped lists/stats/polls) against the read
   * replica when configured, falling back to the primary ONCE on a connection-class
   * error (replica down/unreachable) → a replica outage degrades to consistent
   * primary reads, never a 5xx. With no replica configured this is a plain primary
   * read. NEVER route a read that feeds a CAS, is compared/incremented, authorizes a
   * write, or is returned right after a write through here — keep those on `this`.
   *
   * NOTE: the replica is read from the private `readerClient` field, NOT a getter —
   * the Prisma client is a Proxy that intercepts arbitrary property gets (e.g. a
   * `reader` getter) as model delegates, so a getter would be silently shadowed.
   */
  async readWithFallback<T>(
    fn: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    const replica = this.readerClient;
    const primary = this as unknown as PrismaClient;
    if (!replica) return fn(primary);
    try {
      return await fn(replica);
    } catch (error) {
      if (!this.isConnectionError(error)) throw error;
      this.logger.warn(
        `Replica read failed — falling back to primary: ${(error as Error).message}`,
      );
      return fn(primary);
    }
  }

  /** Connection-class failures that warrant a primary fallback (vs a real query
   * error like P2002, which must propagate). */
  private isConnectionError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientInitializationError) return true;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P1001', 'P1002', 'P1008', 'P1017'].includes(error.code);
    }
    const code = (error as { code?: string })?.code;
    return (
      code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
    );
  }

  async onModuleInit() {
    await this.$connect();
    if (this.readerClient) {
      try {
        await this.readerClient.$connect();
        this.logger.log(
          'Read replica configured (DATABASE_REPLICA_URL) — routing lag-tolerant reads to it.',
        );
      } catch (error) {
        // A missing/unreachable replica must NOT crash boot — serve reads from the
        // primary instead. (The pg driver-adapter pool connects lazily, so a dead
        // replica usually surfaces on the first query, not here — readWithFallback
        // then degrades that read to the primary; this catch covers an eager failure.)
        this.logger.warn(
          `Read replica unavailable at boot — serving reads from the primary: ${(error as Error).message}`,
        );
        await this.readerClient.$disconnect().catch(() => undefined);
        this.readerClient = null;
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
    await this.readerClient?.$disconnect().catch(() => undefined);
  }
}

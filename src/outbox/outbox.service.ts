import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  OUTBOX_BATCH,
  OUTBOX_CLAIM_LEASE_MS,
  OUTBOX_EVENT_REFERRAL_REWARD,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_RECOVERY_ATTEMPTS,
  OUTBOX_RECOVERY_BACKOFF_MS,
} from './outbox.constants';

/** The shape a producer enqueues (the row's status/attempts/timestamps are defaulted). */
export interface OutboxEnqueue {
  aggregateType: string; // e.g. 'delivery'
  aggregateId: string; // e.g. the delivery id
  eventType: string; // routes to a handler (OUTBOX_EVENT_*)
  idempotencyKey: string; // unique — dedupes the enqueue (e.g. across a tx-retry loop)
  payload: Prisma.InputJsonValue;
}

/**
 * Transactional-outbox core (SCALING-1M.md §2). Producers call enqueueWithinTx() INSIDE
 * their own $transaction so the event commits atomically with the aggregate. A worker-tier
 * dispatcher (OutboxProcessor → dispatchDue) then applies events idempotently.
 *
 * AT-LEAST-ONCE: a handler may run more than once (crash between claim and apply, a reaped
 * stale claim, etc.), so every handler MUST be idempotent. The OutboxEvent.status is a
 * LIVENESS optimization, NOT the dedupe authority — the dedupe authority is the handler's
 * own idempotency (for the referral: the PENDING→REWARDED CAS + the unique WalletTransaction
 * idempotency keys). A re-applied event is therefore a no-op, surfaced here as P2002 →
 * treated as success (mirrors WalletService.refundForDelivery), never a false FAILED.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Write a PENDING event in the caller's tx. Atomic with the aggregate write; the
   * unique idempotencyKey makes a re-run of the same tx body (e.g. the create() tracking-id
   * collision retry) a P2002 instead of a duplicate event. */
  async enqueueWithinTx(
    tx: Prisma.TransactionClient,
    event: OutboxEnqueue,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey,
        payload: event.payload,
      },
    });
  }

  /** One dispatcher tick: reap abandoned claims, then claim + apply a batch of PENDING
   * events. Invoked only by the worker-tier OutboxProcessor. */
  async dispatchDue(): Promise<void> {
    await this.reapStaleClaims();
    await this.requeueRecoverableFailed();

    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: OUTBOX_BATCH,
      select: { id: true },
    });

    for (const { id } of pending) {
      await this.processOne(id);
    }

    await this.updateBacklogGauges();
  }

  /**
   * Atomic claim then apply-and-mark in ONE transaction.
   *
   * The claim is a conditional UPDATE (PENDING→PROCESSING, attempts++) — under Read
   * Committed a second concurrent worker re-evaluates the predicate after the first
   * commits, sees PROCESSING, and matches 0 rows, so exactly one worker owns each row
   * (no double-dispatch). The handler + the PROCESSED mark co-commit, so a crash before
   * commit leaves the row PROCESSING (reaped → retried) and never half-applied.
   */
  private async processOne(id: string): Promise<void> {
    const claim = await this.prisma.outboxEvent.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        claimedAt: new Date(),
      },
    });
    if (claim.count === 0) return; // lost the race to another worker/tick

    const event = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!event) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.applyHandler(tx, event);
        await tx.outboxEvent.update({
          where: { id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            lastError: null,
          },
        });
      });
      this.metrics?.outboxProcessedTotal.inc({
        event_type: event.eventType,
        result: 'processed',
      });
    } catch (e) {
      // An already-applied side effect surfaces as a unique-key P2002 — that is SUCCESS
      // (the money is exactly-once via the handler's own keys), so mark PROCESSED rather
      // than retrying it into a false FAILED + alert.
      if (this.isUniqueViolation(e)) {
        await this.markProcessed(id);
        this.metrics?.outboxProcessedTotal.inc({
          event_type: event.eventType,
          result: 'duplicate',
        });
        return;
      }
      // Genuine failure: record it and leave the row PROCESSING. The reaper re-PENDs it
      // after the lease (attempts was already incremented at claim); once attempts exceed
      // the cap the reaper parks it FAILED (replay-safe).
      const msg = (e as Error)?.message?.slice(0, 500) ?? 'unknown error';
      await this.prisma.outboxEvent
        .update({ where: { id }, data: { lastError: msg } })
        .catch(() => undefined);
      this.logger.warn(
        `outbox event ${id} (${event.eventType}) failed [attempt ${event.attempts}/${OUTBOX_MAX_ATTEMPTS}]: ${msg}`,
      );
      this.metrics?.outboxProcessedTotal.inc({
        event_type: event.eventType,
        result: 'error',
      });
    }
  }

  /** Return abandoned PROCESSING claims (crashed worker — claim older than the lease) to
   * PENDING, or park them FAILED once attempts are exhausted. */
  private async reapStaleClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - OUTBOX_CLAIM_LEASE_MS);
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: cutoff },
        attempts: { gte: OUTBOX_MAX_ATTEMPTS },
      },
      data: { status: 'FAILED' },
    });
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: cutoff },
        attempts: { lt: OUTBOX_MAX_ATTEMPTS },
      },
      data: { status: 'PENDING', claimedAt: null },
    });
  }

  /**
   * Make FAILED genuinely recoverable (the constants promise replay is safe — every handler is
   * idempotent — but nothing previously transitioned a row OUT of FAILED, so a money-bearing
   * event lost to a burst of TRANSIENT failures, e.g. several worker redeploys mid-apply or a
   * run of deadlocks under load, was silently dropped). Re-PEND a FAILED row after a long
   * backoff so it's retried rather than abandoned. Bounded by OUTBOX_MAX_RECOVERY_ATTEMPTS:
   * once total attempts reach the ceiling the row stays FAILED permanently (a genuinely poison
   * event — bad payload / missing handler — can't loop forever), surfaced by the outboxFailed
   * gauge. The backoff is gated on claimedAt (the last attempt time), so a just-failed row
   * waits the full backoff before its next replay.
   */
  private async requeueRecoverableFailed(): Promise<void> {
    const retryBefore = new Date(Date.now() - OUTBOX_RECOVERY_BACKOFF_MS);
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: 'FAILED',
        attempts: { lt: OUTBOX_MAX_RECOVERY_ATTEMPTS },
        claimedAt: { lt: retryBefore },
      },
      data: { status: 'PENDING', claimedAt: null },
    });
  }

  private async markProcessed(id: string): Promise<void> {
    await this.prisma.outboxEvent
      .update({
        where: { id },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      })
      .catch(() => undefined);
  }

  /** Route an event to its handler. The handler runs in the dispatch tx and must be
   * idempotent. Stage-1 carries only the referral reward. */
  private async applyHandler(
    tx: Prisma.TransactionClient,
    event: { eventType: string; payload: Prisma.JsonValue },
  ): Promise<void> {
    switch (event.eventType) {
      case OUTBOX_EVENT_REFERRAL_REWARD: {
        const payload = (event.payload ?? {}) as { refereeUserId?: string };
        if (!payload.refereeUserId) {
          throw new Error('REFERRAL_REWARD outbox event missing refereeUserId');
        }
        // Call the canonical helper VERBATIM so the PENDING→REWARDED CAS and the
        // referral-* WalletTransaction idempotency keys are the single source of truth
        // (no re-implemented grant logic to drift).
        await this.walletService.maybeGrantReferralRewardWithinTx(
          tx,
          payload.refereeUserId,
        );
        return;
      }
      default:
        throw new Error(`No outbox handler for eventType: ${event.eventType}`);
    }
  }

  /** Best-effort backlog gauges (drives backlog-age / FAILED>0 alerts). */
  private async updateBacklogGauges(): Promise<void> {
    if (!this.metrics) return;
    try {
      const [pending, failed] = await Promise.all([
        this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
        this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      ]);
      this.metrics.outboxPending.set(pending);
      this.metrics.outboxFailed.set(failed);
    } catch {
      // A counting hiccup must never fail a dispatch tick.
    }
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}

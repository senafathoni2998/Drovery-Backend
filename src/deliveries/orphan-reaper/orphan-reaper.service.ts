import { Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { PromoService } from '../../promo/promo.service';
import { MetricsService } from '../../metrics/metrics.service';
import {
  ORPHAN_BATCH,
  ORPHAN_GRACE_MS,
  ORPHAN_LOOKBACK_MS,
} from './orphan-reaper.constants';

/**
 * Reconciliation sweep for orphaned debit-first reservations (SCALING-1M.md §2 Stage-A3):
 * a committed wallet-debit / promo-redeem whose delivery never materialized (a process crash
 * between the reservation tx and the delivery tx). Reverses them with the EXISTING idempotent
 * compensations. Best-effort + idempotent: safe to run on every worker, every tick, twice.
 */
@Injectable()
export class OrphanReaperService {
  private readonly logger = new Logger(OrphanReaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly promoService: PromoService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** One sweep tick: find reservations aged past the grace window (within the lookback) whose
   * delivery does not exist, and compensate the ones not already reversed. */
  async sweep(): Promise<void> {
    const now = Date.now();
    const upper = new Date(now - ORPHAN_GRACE_MS); // older than grace = eligible
    const lower = new Date(now - ORPHAN_GRACE_MS - ORPHAN_LOOKBACK_MS); // window floor

    // Orphan candidates from both reservation kinds. RELEASED promos and (per-candidate) the
    // already-refunded debits self-exclude, so the working set stays small.
    const [debits, redemptions] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: {
          type: 'DEBIT',
          reason: 'CHECKOUT_SPEND',
          deliveryId: { not: null },
          createdAt: { gte: lower, lt: upper },
        },
        select: { deliveryId: true },
        take: ORPHAN_BATCH,
      }),
      this.prisma.promoRedemption.findMany({
        where: { status: 'REDEEMED', redeemedAt: { gte: lower, lt: upper } },
        select: { deliveryId: true },
        take: ORPHAN_BATCH,
      }),
    ]);

    const candidateIds = [
      ...new Set<string>([
        ...debits.map((d) => d.deliveryId).filter((id): id is string => !!id),
        ...redemptions.map((r) => r.deliveryId),
      ]),
    ];

    let reaped = 0;
    for (const deliveryId of candidateIds) {
      try {
        if (await this.reapIfOrphan(deliveryId)) reaped++;
      } catch (e) {
        // One stuck candidate must not abort the whole sweep.
        this.logger.warn(
          `orphan reap failed for ${deliveryId}: ${(e as Error).message}`,
        );
      }
    }

    if (reaped > 0) this.metrics?.orphanReservationsReaped.inc(reaped);
    this.metrics?.orphanReaperLastScan.set(Math.floor(now / 1000));
    if (reaped > 0) {
      this.logger.warn(
        `orphan reaper reversed ${reaped} stranded reservation(s) (no delivery after grace)`,
      );
    }
  }

  /** Compensate a single candidate IFF its delivery truly doesn't exist (re-checked NOW, not
   * from the stale candidate read) and a reversal is actually outstanding. Returns whether it
   * compensated anything (so already-reversed/legitimate candidates don't inflate metrics). */
  private async reapIfOrphan(deliveryId: string): Promise<boolean> {
    // RE-CHECK at compensation time: a slow/mid-retry delivery tx may have committed since the
    // candidate query. If the delivery exists, the reservation was legitimately consumed.
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { id: true },
    });
    if (delivery) return false;

    // Determine what is actually outstanding so we don't re-log / re-count already-reversed
    // orphans that linger in the lookback window.
    const [debit, refund, promo] = await Promise.all([
      this.prisma.walletTransaction.findFirst({
        where: { deliveryId, type: 'DEBIT', reason: 'CHECKOUT_SPEND' },
        select: { id: true },
      }),
      this.prisma.walletTransaction.findFirst({
        where: { deliveryId, reason: 'CHECKOUT_REFUND' },
        select: { id: true },
      }),
      this.prisma.promoRedemption.findFirst({
        where: { deliveryId, status: 'REDEEMED' },
        select: { id: true },
      }),
    ]);

    const needsRefund = !!debit && !refund;
    const needsRelease = !!promo;
    if (!needsRefund && !needsRelease) return false;

    if (needsRefund) await this.walletService.refundForDelivery(deliveryId);
    if (needsRelease) await this.promoService.releaseForDelivery(deliveryId);
    this.logger.warn(
      `reaped orphaned reservation for delivery ${deliveryId} ` +
        `(refund=${needsRefund} release=${needsRelease})`,
    );
    return true;
  }
}

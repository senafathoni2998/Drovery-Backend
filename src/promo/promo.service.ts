import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PromoCode } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DiscountResult, PromoPreview, PromoRejectReason } from './promo.types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type CheckResult =
  | { ok: true; code: PromoCode }
  | { ok: false; reason: PromoRejectReason; message: string };

@Injectable()
export class PromoService {
  private readonly logger = new Logger(PromoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Pure discount math. Never negative; honors the optional max-discount cap. */
  computeDiscount(code: PromoCode, originalTotal: number): DiscountResult {
    let raw =
      code.discountType === 'PERCENT'
        ? round2((originalTotal * code.discountValue) / 100)
        : code.discountValue;
    if (code.maxDiscount != null) raw = Math.min(raw, code.maxDiscount);
    const discountAmount = round2(Math.min(raw, originalTotal)); // never > order
    const finalTotal = round2(originalTotal - discountAmount); // never < 0
    return { discountAmount, finalTotal };
  }

  /**
   * Validates a code for redemption; THROWS the create-time HttpException on any
   * rejection (422 for fixable input, 409 for cap conflicts). Returns the row.
   * NOTE: the cap checks here are advisory/early — the authoritative guards are
   * the atomic CAS + partial-unique index in redeemWithinTx.
   */
  async validateForRedeem(
    rawCode: string,
    userId: string,
    originalTotal: number,
  ): Promise<PromoCode> {
    const result = await this.checkRedeemable(rawCode, userId, originalTotal);
    if (!result.ok) {
      throw this.promoError(result.reason, result.message);
    }
    return result.code;
  }

  /** Advisory preview for the app — NEVER throws (mirrors the serviceability quote). */
  async preview(
    rawCode: string,
    userId: string,
    originalTotal: number,
  ): Promise<PromoPreview> {
    try {
      const result = await this.checkRedeemable(rawCode, userId, originalTotal);
      if (!result.ok) {
        return { valid: false, reason: result.reason, message: result.message };
      }
      const { discountAmount, finalTotal } = this.computeDiscount(
        result.code,
        originalTotal,
      );
      return {
        valid: true,
        code: result.code.code,
        discountType: result.code.discountType,
        discountAmount,
        originalTotal,
        finalTotal,
      };
    } catch (e) {
      this.logger.warn(`promo preview failed: ${(e as Error).message}`);
      return {
        valid: false,
        reason: 'INVALID',
        message: 'This promo code could not be validated.',
      };
    }
  }

  /**
   * Atomic redemption — MUST run inside the same transaction as the delivery
   * create (pass the tx client). Global cap via conditional-increment CAS;
   * per-user limit via the partial-unique index (P2002 on a 2nd active redeem).
   * Throwing here rolls back the whole transaction (no orphan delivery/ledger).
   */
  async redeemWithinTx(
    tx: Prisma.TransactionClient,
    code: PromoCode,
    userId: string,
    deliveryId: string,
    originalTotal: number,
    discount: DiscountResult,
  ): Promise<void> {
    const { count } = await tx.promoCode.updateMany({
      where: {
        id: code.id,
        active: true,
        OR: [
          { maxRedemptions: null },
          { timesRedeemed: { lt: code.maxRedemptions ?? 0 } },
        ],
      },
      data: { timesRedeemed: { increment: 1 } },
    });
    if (count === 0) {
      throw this.promoError(
        'GLOBALLY_MAXED',
        'This promo code has reached its redemption limit.',
      );
    }

    try {
      await tx.promoRedemption.create({
        data: {
          promoCodeId: code.id,
          userId,
          deliveryId,
          discountAmount: discount.discountAmount,
          originalTotal,
          finalTotal: discount.finalTotal,
          status: 'REDEEMED',
        },
      });
    } catch (e) {
      if (this.isPerUserConflict(e)) {
        throw this.promoError(
          'PER_USER_EXCEEDED',
          'You have already used this promo code.',
        );
      }
      throw e;
    }
  }

  /** Cancel → release the slot: flip REDEEMED→RELEASED + decrement the counter,
   * idempotent (a double-cancel is a no-op). Keeps the row for audit. */
  async releaseForDelivery(deliveryId: string): Promise<void> {
    const redemption = await this.prisma.promoRedemption.findFirst({
      where: { deliveryId, status: 'REDEEMED' },
    });
    if (!redemption) return;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.promoRedemption.updateMany({
        where: { deliveryId, status: 'REDEEMED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      if (count === 0) return; // released concurrently — don't double-decrement
      await tx.promoCode.updateMany({
        where: { id: redemption.promoCodeId, timesRedeemed: { gt: 0 } },
        data: { timesRedeemed: { decrement: 1 } },
      });
    });
  }

  private async checkRedeemable(
    rawCode: string,
    userId: string,
    originalTotal: number,
  ): Promise<CheckResult> {
    const normalized = (rawCode ?? '').trim().toUpperCase();
    const reject = (reason: PromoRejectReason, message: string): CheckResult => ({
      ok: false,
      reason,
      message,
    });

    const code = await this.prisma.promoCode.findUnique({
      where: { code: normalized },
    });
    if (!code) return reject('INVALID', 'This promo code is not valid.');
    if (!code.active) {
      return reject('INACTIVE', 'This promo code is no longer active.');
    }
    const now = new Date();
    if (code.startsAt && now < code.startsAt) {
      return reject('NOT_STARTED', 'This promo code is not active yet.');
    }
    if (code.endsAt && now >= code.endsAt) {
      return reject('EXPIRED', 'This promo code has expired.');
    }
    if (code.minOrderTotal > 0 && originalTotal < code.minOrderTotal) {
      return reject(
        'MIN_NOT_MET',
        `This code requires an order of at least $${code.minOrderTotal.toFixed(2)}.`,
      );
    }
    if (code.maxRedemptions != null && code.timesRedeemed >= code.maxRedemptions) {
      return reject(
        'GLOBALLY_MAXED',
        'This promo code has reached its redemption limit.',
      );
    }
    const used = await this.prisma.promoRedemption.count({
      where: { promoCodeId: code.id, userId, status: 'REDEEMED' },
    });
    if (used >= code.perUserLimit) {
      return reject('PER_USER_EXCEEDED', 'You have already used this promo code.');
    }
    return { ok: true, code };
  }

  /** Object-form HttpException so the body carries a stable `code` (like the
   * serviceability/handoff errors). Cap conflicts are 409; the rest are 422. */
  private promoError(reason: PromoRejectReason, message: string): HttpException {
    const status =
      reason === 'GLOBALLY_MAXED' || reason === 'PER_USER_EXCEEDED' ? 409 : 422;
    return new HttpException(
      {
        statusCode: status,
        error: status === 409 ? 'Conflict' : 'Unprocessable Entity',
        message,
        code: `PROMO_${reason}`,
      },
      status,
    );
  }

  /** True only for the per-user partial-unique violation (NOT e.g. deliveryId). */
  private isPerUserConflict(e: unknown): boolean {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return false;
    }
    const target = JSON.stringify(e.meta?.target ?? '');
    return (
      target.includes('active_per_user') ||
      (target.includes('promoCodeId') && target.includes('userId'))
    );
  }
}

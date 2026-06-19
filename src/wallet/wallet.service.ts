import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, WalletTxnReason } from '@prisma/client';

import { PaginationDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  REFEREE_REWARD,
  REFERRER_REWARD,
  generateReferralCode,
} from './wallet.constants';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mint credits inside a transaction (increment + ledger row). The optional
   * idempotencyKey (unique) makes a retried reward/refund a no-op via P2002. */
  async creditWithinTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    reason: WalletTxnReason,
    opts: {
      deliveryId?: string;
      referralId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<void> {
    const amt = round2(amount);
    const u = await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amt } },
      select: { creditBalance: true },
    });
    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'CREDIT',
        reason,
        amount: amt,
        balanceAfter: round2(u.creditBalance),
        deliveryId: opts.deliveryId ?? null,
        referralId: opts.referralId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
      },
    });
  }

  /** Spend credits inside a transaction. Conditional-decrement CAS (balance >=
   * amount) so concurrent spends can never drive the balance negative. */
  async debitWithinTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    opts: { deliveryId: string; idempotencyKey?: string },
  ): Promise<void> {
    const amt = round2(amount);
    const { count } = await tx.user.updateMany({
      where: { id: userId, creditBalance: { gte: amt } },
      data: { creditBalance: { decrement: amt } },
    });
    if (count === 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'Conflict',
          message: 'Insufficient wallet credits.',
          code: 'WALLET_INSUFFICIENT_CREDITS',
        },
        409,
      );
    }
    const u = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'DEBIT',
        reason: 'CHECKOUT_SPEND',
        amount: amt,
        balanceAfter: round2(u?.creditBalance ?? 0),
        deliveryId: opts.deliveryId,
        idempotencyKey: opts.idempotencyKey ?? null,
      },
    });
  }

  /**
   * On the referee's first delivery, credit BOTH parties exactly once. The
   * PENDING→REWARDED CAS is the single-winner gate (a concurrent first delivery
   * or a retry sees count===0 and skips). Runs inside the delivery transaction.
   */
  async maybeGrantReferralRewardWithinTx(
    tx: Prisma.TransactionClient,
    refereeId: string,
  ): Promise<void> {
    const ref = await tx.referral.findUnique({ where: { refereeId } });
    if (!ref || ref.status !== 'PENDING') return;
    if (ref.referrerId === refereeId) return; // self-referral guard

    const { count } = await tx.referral.updateMany({
      where: { id: ref.id, status: 'PENDING' },
      data: {
        status: 'REWARDED',
        rewardedAt: new Date(),
        referrerReward: REFERRER_REWARD,
        refereeReward: REFEREE_REWARD,
      },
    });
    if (count === 0) return; // another concurrent first-delivery won

    await this.creditWithinTx(
      tx,
      ref.referrerId,
      REFERRER_REWARD,
      'REFERRAL_REWARD',
      {
        referralId: ref.id,
        idempotencyKey: `referral-referrer:${ref.id}`,
      },
    );
    await this.creditWithinTx(tx, refereeId, REFEREE_REWARD, 'REFEREE_REWARD', {
      referralId: ref.id,
      idempotencyKey: `referral-referee:${ref.id}`,
    });
  }

  /** Refund credits spent on a canceled delivery (best-effort, idempotent). */
  async refundForDelivery(deliveryId: string): Promise<void> {
    const spend = await this.prisma.walletTransaction.findFirst({
      where: { deliveryId, type: 'DEBIT', reason: 'CHECKOUT_SPEND' },
    });
    if (!spend) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.creditWithinTx(
          tx,
          spend.userId,
          spend.amount,
          'CHECKOUT_REFUND',
          {
            deliveryId,
            idempotencyKey: `refund:${deliveryId}`,
          },
        );
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) return; // already refunded — no-op
      throw e;
    }
  }

  /**
   * Make the customer whole for a failed/aborted delivery by crediting the
   * card-charged amount (estimatedPrice, i.e. the non-credit portion) to their
   * wallet + marking the Payment REFUNDED — since there is no live Stripe
   * money-refund integration yet, the wallet IS the refund channel (this is what
   * the failure comms promise). Distinct from refundForDelivery, which returns the
   * separate WALLET-credit portion; together they fully reverse the charge.
   * Best-effort + idempotent via `exception-refund:<id>`. No-op for a $0 charge.
   */
  async refundChargeToWallet(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { userId: true, estimatedPrice: true },
    });
    if (!delivery || delivery.estimatedPrice <= 0) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.creditWithinTx(
          tx,
          delivery.userId,
          delivery.estimatedPrice,
          'CHECKOUT_REFUND',
          { deliveryId, idempotencyKey: `exception-refund:${deliveryId}` },
        );
        await tx.payment.updateMany({
          where: { deliveryId },
          data: { status: 'REFUNDED' },
        });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) return; // already refunded — no-op
      throw e;
    }
  }

  async getWallet(userId: string, query: PaginationDto) {
    // Pure display read (balance + ledger), never feeds a debit/credit CAS →
    // read replica (falls back to primary). The authoritative spend/refund CAS
    // always runs on the primary inside a $transaction.
    const [user, [transactions, total]] = await this.prisma.readWithFallback(
      (c) =>
        Promise.all([
          c.user.findUnique({
            where: { id: userId },
            select: { creditBalance: true },
          }),
          c.$transaction([
            c.walletTransaction.findMany({
              where: { userId },
              orderBy: { createdAt: 'desc' },
              skip: query.skip,
              take: query.limit,
            }),
            c.walletTransaction.count({ where: { userId } }),
          ]),
        ]),
    );
    return {
      balance: round2(user?.creditBalance ?? 0),
      currency: 'usd',
      transactions,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async getReferrals(userId: string) {
    // ensureReferralCode reads-then-lazily-writes the code → stays on the PRIMARY.
    const referralCode = await this.ensureReferralCode(userId);
    // The referral list is a display read → read replica (falls back to primary).
    const referrals = await this.prisma.readWithFallback((c) =>
      c.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        include: { referee: { select: { name: true } } },
      }),
    );
    const rewarded = referrals.filter((r) => r.status === 'REWARDED').length;
    return {
      referralCode,
      rewardPerReferral: {
        referrer: REFERRER_REWARD,
        referee: REFEREE_REWARD,
        currency: 'usd',
      },
      stats: {
        total: referrals.length,
        pending: referrals.length - rewarded,
        rewarded,
      },
      referrals: referrals.map((r) => ({
        id: r.id,
        refereeName: r.referee?.name ?? null,
        status: r.status,
        rewardedAt: r.rewardedAt,
        createdAt: r.createdAt,
      })),
    };
  }

  /** The user's referral code, generating + persisting one if still null. */
  async ensureReferralCode(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (u?.referralCode) return u.referralCode;
    for (let i = 0; i < 5; i++) {
      try {
        const updated = await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode: generateReferralCode() },
          select: { referralCode: true },
        });
        return updated.referralCode as string;
      } catch (e) {
        if (this.isUniqueViolation(e)) continue; // collision — regenerate
        throw e;
      }
    }
    throw new Error('Could not generate a unique referral code');
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}

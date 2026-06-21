import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'u-1';

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(WalletService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('creditWithinTx', () => {
    it('increments the balance and writes a ledger row', async () => {
      prisma.user.update.mockResolvedValue({ creditBalance: 15 });
      await service.creditWithinTx(
        prisma as any,
        userId,
        5,
        'REFERRAL_REWARD',
        {
          referralId: 'r-1',
          idempotencyKey: 'k1',
        },
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { creditBalance: { increment: 5 } },
        select: { creditBalance: true },
      });
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          type: 'CREDIT',
          reason: 'REFERRAL_REWARD',
          amount: 5,
          balanceAfter: 15,
          idempotencyKey: 'k1',
        }),
      });
    });
  });

  describe('debitWithinTx', () => {
    it('spends via the conditional-decrement CAS and ledgers it', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 3 });
      await service.debitWithinTx(prisma as any, userId, 7, {
        deliveryId: 'd-1',
      });
      const cas = prisma.user.updateMany.mock.calls[0][0];
      expect(cas.where).toEqual({ id: userId, creditBalance: { gte: 7 } });
      expect(cas.data).toEqual({ creditBalance: { decrement: 7 } });
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DEBIT',
          reason: 'CHECKOUT_SPEND',
          amount: 7,
        }),
      });
    });

    it('throws 409 WALLET_INSUFFICIENT_CREDITS when the CAS matches nothing', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.debitWithinTx(prisma as any, userId, 7, { deliveryId: 'd-1' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('maybeGrantReferralRewardWithinTx', () => {
    it('flips PENDING→REWARDED (CAS) and credits BOTH parties once', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'ref-1',
        referrerId: 'referrer-1',
        refereeId: userId,
        status: 'PENDING',
      });
      prisma.referral.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue({ creditBalance: 5 });

      await service.maybeGrantReferralRewardWithinTx(prisma as any, userId);

      expect(prisma.referral.updateMany).toHaveBeenCalledWith({
        where: { id: 'ref-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REWARDED' }),
      });
      // referrer + referee = two credit writes
      expect(prisma.walletTransaction.create).toHaveBeenCalledTimes(2);
    });

    it('no-ops when there is no pending referral', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      await service.maybeGrantReferralRewardWithinTx(prisma as any, userId);
      expect(prisma.referral.updateMany).not.toHaveBeenCalled();
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('no-ops (no double-credit) when the CAS is lost to a concurrent first delivery', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'ref-1',
        referrerId: 'referrer-1',
        refereeId: userId,
        status: 'PENDING',
      });
      prisma.referral.updateMany.mockResolvedValue({ count: 0 });
      await service.maybeGrantReferralRewardWithinTx(prisma as any, userId);
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('refundForDelivery', () => {
    it('credits back the spent amount (idempotent)', async () => {
      prisma.walletTransaction.findFirst.mockResolvedValue({
        userId,
        amount: 4,
      });
      prisma.user.update.mockResolvedValue({ creditBalance: 4 });
      await service.refundForDelivery('d-1');
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CREDIT',
          reason: 'CHECKOUT_REFUND',
          amount: 4,
          idempotencyKey: 'refund:d-1',
        }),
      });
    });

    it('no-ops when no credits were spent on the delivery', async () => {
      prisma.walletTransaction.findFirst.mockResolvedValue(null);
      await service.refundForDelivery('d-1');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('swallows the duplicate-refund unique violation (double cancel)', async () => {
      prisma.walletTransaction.findFirst.mockResolvedValue({
        userId,
        amount: 4,
      });
      prisma.user.update.mockResolvedValue({ creditBalance: 4 });
      prisma.walletTransaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: 'wallet_transactions_idempotencyKey_key' },
        }),
      );
      await expect(service.refundForDelivery('d-1')).resolves.toBeUndefined();
    });
  });

  describe('refundChargeToWallet', () => {
    it('credits the card-charged amount to the wallet + marks the payment refunded', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId,
        estimatedPrice: 18,
      });
      prisma.user.update.mockResolvedValue({ creditBalance: 18 });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.refundChargeToWallet('d-1');

      expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CREDIT',
          reason: 'CHECKOUT_REFUND',
          amount: 18,
          idempotencyKey: 'exception-refund:d-1',
        }),
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1' },
        data: { status: 'REFUNDED' },
      });
    });

    it('no-ops for a $0 (fully credit-paid / free) charge', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId,
        estimatedPrice: 0,
      });
      await service.refundChargeToWallet('d-1');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('swallows the duplicate-refund unique violation (idempotent)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId,
        estimatedPrice: 18,
      });
      prisma.user.update.mockResolvedValue({ creditBalance: 18 });
      prisma.walletTransaction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: 'wallet_transactions_idempotencyKey_key' },
        }),
      );
      await expect(
        service.refundChargeToWallet('d-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('ensureReferralCode', () => {
    it('returns the existing code', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'ABCD2345' });
      expect(await service.ensureReferralCode(userId)).toBe('ABCD2345');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lazily generates one when null', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: null });
      prisma.user.update.mockResolvedValue({ referralCode: 'NEWCODE9' });
      expect(await service.ensureReferralCode(userId)).toBe('NEWCODE9');
    });
  });

  describe('getReferrals', () => {
    it('returns the code, stats, and the list', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'MYCODE12' });
      prisma.referral.findMany.mockResolvedValue([
        {
          id: 'r1',
          status: 'REWARDED',
          rewardedAt: new Date(),
          createdAt: new Date(),
          referee: { name: 'Bob' },
        },
        {
          id: 'r2',
          status: 'PENDING',
          rewardedAt: null,
          createdAt: new Date(),
          referee: { name: 'Cam' },
        },
      ]);
      const result = await service.getReferrals(userId);
      expect(result.referralCode).toBe('MYCODE12');
      expect(result.stats).toEqual({ total: 2, pending: 1, rewarded: 1 });
      expect(result.referrals[0]).toMatchObject({
        refereeName: 'Bob',
        status: 'REWARDED',
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { PromoService } from './promo.service';

const code = (over: Record<string, unknown> = {}) => ({
  id: 'promo-1',
  code: 'WELCOME10',
  description: null,
  discountType: 'PERCENT',
  discountValue: 10,
  minOrderTotal: 0,
  maxDiscount: 5,
  startsAt: null,
  endsAt: null,
  active: true,
  maxRedemptions: 1000,
  timesRedeemed: 0,
  perUserLimit: 1,
  ...over,
});

describe('PromoService', () => {
  let service: PromoService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'u-1';

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromoService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PromoService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('computeDiscount', () => {
    it('PERCENT discount', () => {
      expect(
        service.computeDiscount(code({ maxDiscount: null }) as any, 50),
      ).toEqual({
        discountAmount: 5,
        finalTotal: 45,
      });
    });

    it('PERCENT respects the maxDiscount cap', () => {
      // 10% of $200 = $20, capped at $5.
      expect(
        service.computeDiscount(code({ maxDiscount: 5 }) as any, 200),
      ).toEqual({
        discountAmount: 5,
        finalTotal: 195,
      });
    });

    it('FIXED discount', () => {
      const fixed = code({
        discountType: 'FIXED',
        discountValue: 5,
        maxDiscount: null,
      });
      expect(service.computeDiscount(fixed as any, 30)).toEqual({
        discountAmount: 5,
        finalTotal: 25,
      });
    });

    it('never discounts below $0 (FIXED larger than the order)', () => {
      const fixed = code({
        discountType: 'FIXED',
        discountValue: 5,
        maxDiscount: null,
      });
      expect(service.computeDiscount(fixed as any, 3)).toEqual({
        discountAmount: 3,
        finalTotal: 0,
      });
    });

    it('clamps a negative discount to 0 (never charges more than the order)', () => {
      const bad = code({
        discountType: 'FIXED',
        discountValue: -5,
        maxDiscount: null,
      });
      expect(service.computeDiscount(bad as any, 20)).toEqual({
        discountAmount: 0,
        finalTotal: 20,
      });
    });
  });

  describe('validateForRedeem', () => {
    const expectStatus = async (
      promise: Promise<unknown>,
      status: number,
      codeStr: string,
    ) => {
      await expect(promise).rejects.toMatchObject({ status });
      await promise.catch((e: HttpException) => {
        expect((e.getResponse() as any).code).toBe(codeStr);
      });
    };

    it('throws 422 PROMO_INVALID for an unknown code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);
      await expectStatus(
        service.validateForRedeem('NOPE', userId, 20),
        422,
        'PROMO_INVALID',
      );
    });

    it('throws 422 PROMO_INACTIVE / NOT_STARTED / EXPIRED / MIN_NOT_MET', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(code({ active: false }));
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        422,
        'PROMO_INACTIVE',
      );

      prisma.promoCode.findUnique.mockResolvedValue(
        code({ startsAt: new Date(Date.now() + 86400000) }),
      );
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        422,
        'PROMO_NOT_STARTED',
      );

      prisma.promoCode.findUnique.mockResolvedValue(
        code({ endsAt: new Date(Date.now() - 1000) }),
      );
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        422,
        'PROMO_EXPIRED',
      );

      prisma.promoCode.findUnique.mockResolvedValue(
        code({ minOrderTotal: 50 }),
      );
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        422,
        'PROMO_MIN_NOT_MET',
      );
    });

    it('throws 409 when the global cap or per-user limit is already hit', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        code({ maxRedemptions: 5, timesRedeemed: 5 }),
      );
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        409,
        'PROMO_GLOBALLY_MAXED',
      );

      prisma.promoCode.findUnique.mockResolvedValue(code());
      prisma.promoRedemption.count.mockResolvedValue(1); // perUserLimit 1, already used
      await expectStatus(
        service.validateForRedeem('X', userId, 20),
        409,
        'PROMO_PER_USER_EXCEEDED',
      );
    });

    it('uppercases + trims the code before lookup', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(code());
      prisma.promoRedemption.count.mockResolvedValue(0);
      await service.validateForRedeem('  welcome10 ', userId, 20);
      expect(prisma.promoCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'WELCOME10' },
      });
    });
  });

  describe('preview', () => {
    it('returns valid:false with a reason, never throwing', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);
      expect(await service.preview('NOPE', userId, 20)).toMatchObject({
        valid: false,
        reason: 'INVALID',
      });
    });

    it('returns the computed discount when valid', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        code({ maxDiscount: null }),
      );
      prisma.promoRedemption.count.mockResolvedValue(0);
      expect(await service.preview('WELCOME10', userId, 50)).toMatchObject({
        valid: true,
        discountAmount: 5,
        finalTotal: 45,
      });
    });

    it('swallows an unexpected DB error into valid:false', async () => {
      prisma.promoCode.findUnique.mockRejectedValue(new Error('db down'));
      expect(await service.preview('X', userId, 20)).toMatchObject({
        valid: false,
      });
    });
  });

  describe('redeemWithinTx', () => {
    const discount = { discountAmount: 2, finalTotal: 18 };

    it('increments the global counter (atomic guard) and writes the ledger', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.promoRedemption.create.mockResolvedValue({});
      await service.redeemWithinTx(
        prisma as any,
        code() as any,
        userId,
        'd-1',
        20,
        discount,
      );
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.promoRedemption.create).toHaveBeenCalled();
    });

    it('the atomic guard enforces the start/end window AND a column-vs-column cap', async () => {
      // Guards the audit fix: the redeem CAS must check startsAt/endsAt and compare
      // timesRedeemed against the maxRedemptions COLUMN (not the stale validate-time snapshot).
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.promoRedemption.create.mockResolvedValue({});
      await service.redeemWithinTx(
        prisma as any,
        code() as any,
        userId,
        'd-1',
        20,
        discount,
      );
      const sql = (
        prisma.$executeRaw.mock.calls[0][0] as TemplateStringsArray
      ).join(' ');
      expect(sql).toMatch(/"startsAt" IS NULL OR "startsAt" <=/);
      expect(sql).toMatch(/"endsAt" IS NULL OR "endsAt" >/);
      expect(sql).toMatch(/"timesRedeemed" < "maxRedemptions"/);
    });

    it('rejects 409 GLOBALLY_MAXED when the guard matches nothing and the cap is hit', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      prisma.promoCode.findUnique.mockResolvedValue(
        code({ maxRedemptions: 1, timesRedeemed: 1 }) as any,
      );
      await expect(
        service.redeemWithinTx(
          prisma as any,
          code() as any,
          userId,
          'd-1',
          20,
          discount,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.promoRedemption.create).not.toHaveBeenCalled();
    });

    it('rejects 422 EXPIRED at redeem time for a code expired since validation', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      prisma.promoCode.findUnique.mockResolvedValue(
        code({ endsAt: new Date(Date.now() - 1000) }) as any,
      );
      await expect(
        service.redeemWithinTx(
          prisma as any,
          code() as any,
          userId,
          'd-1',
          20,
          discount,
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(prisma.promoRedemption.create).not.toHaveBeenCalled();
    });

    it('maps the per-user partial-unique P2002 to 409 PER_USER_EXCEEDED', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.promoRedemption.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: 'promo_redemptions_active_per_user_key' },
        }),
      );
      await expect(
        service.redeemWithinTx(
          prisma as any,
          code() as any,
          userId,
          'd-1',
          20,
          discount,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('does NOT map an unrelated P2002 to PER_USER_EXCEEDED', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      const other = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: 'promo_redemptions_deliveryId_key' },
      });
      prisma.promoRedemption.create.mockRejectedValue(other);
      await expect(
        service.redeemWithinTx(
          prisma as any,
          code() as any,
          userId,
          'd-1',
          20,
          discount,
        ),
      ).rejects.toBe(other);
    });
  });

  describe('releaseForDelivery', () => {
    it('flips REDEEMED→RELEASED and decrements the counter', async () => {
      prisma.promoRedemption.findFirst.mockResolvedValue({
        id: 'red-1',
        promoCodeId: 'promo-1',
      });
      prisma.promoRedemption.updateMany.mockResolvedValue({ count: 1 });
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });

      await service.releaseForDelivery('d-1');

      expect(prisma.promoRedemption.updateMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1', status: 'REDEEMED' },
        data: { status: 'RELEASED', releasedAt: expect.any(Date) },
      });
      expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'promo-1', timesRedeemed: { gt: 0 } },
        data: { timesRedeemed: { decrement: 1 } },
      });
    });

    it('is a no-op when there is no active redemption (e.g. double-cancel)', async () => {
      prisma.promoRedemption.findFirst.mockResolvedValue(null);
      await service.releaseForDelivery('d-1');
      expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
    });
  });
});

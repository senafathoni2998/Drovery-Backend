import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { I18nService } from '../i18n/i18n.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { ProofService } from './proof/proof.service';
import { SimulationService } from './simulation/simulation.service';
import { TrackingPublisher } from './tracking/tracking.publisher';
import { TrackingHotStore } from './tracking/tracking-hot-store';
import { PromoService } from '../promo/promo.service';
import { WalletService } from '../wallet/wallet.service';
import { OutboxService } from '../outbox/outbox.service';
import { OUTBOX_EVENT_REFERRAL_REWARD } from '../outbox/outbox.constants';
import { createMockPrismaService } from '../test/prisma-mock';

const SERVICEABLE = {
  serviceable: true,
  reasons: [],
  codes: [],
  weatherHold: false,
};

jest.mock('uuid', () => ({ v4: () => 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' }));

describe('DeliveriesService', () => {
  let service: DeliveriesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let simulationService: {
    startSimulation: jest.Mock;
    scheduleKickoff: jest.Mock;
    stopSimulation: jest.Mock;
  };
  let geoService: { geocode: jest.Mock };
  let pricingService: { estimate: jest.Mock };
  let paymentsService: { createDeliveryPayment: jest.Mock };
  let proofService: { createAutoProof: jest.Mock };
  let serviceability: { checkServiceability: jest.Mock };
  let promoService: {
    validateForRedeem: jest.Mock;
    computeDiscount: jest.Mock;
    redeemWithinTx: jest.Mock;
    releaseForDelivery: jest.Mock;
  };
  let walletService: {
    debitWithinTx: jest.Mock;
    maybeGrantReferralRewardWithinTx: jest.Mock;
    refundForDelivery: jest.Mock;
    refundChargeToWallet: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let trackingPublisher: { publishUpdate: jest.Mock };
  let trackingHotStore: { enabled: boolean; readPosition: jest.Mock };
  let outbox: { enqueueWithinTx: jest.Mock };

  const userId = 'user-1';

  const createDto = {
    fromAddress: '123 Pickup St',
    toAddress: '456 Drop Ave',
    fromLat: -6.903,
    fromLng: 107.615,
    toLat: -6.922,
    toLng: 107.607,
    receiver: 'Jane Doe',
    packages: 'Electronics box',
    packageSize: 'Medium',
    packageWeight: 2,
    packageTypes: ['electronics', 'fragile'],
    pickupDate: '2026-04-10',
    pickupTime: '10:00',
  };

  const mockDelivery = {
    id: 'delivery-1',
    trackingId: 'AAAAAAAA',
    userId,
    status: DeliveryStatus.PENDING,
    fromAddress: createDto.fromAddress,
    toAddress: createDto.toAddress,
    estimatedPrice: 18,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    simulationService = {
      startSimulation: jest.fn(),
      scheduleKickoff: jest.fn(),
      stopSimulation: jest.fn().mockResolvedValue(undefined),
    };
    geoService = { geocode: jest.fn() };
    pricingService = {
      estimate: jest.fn().mockResolvedValue({
        baseFee: 2,
        sizeFee: 6,
        weightFee: 6,
        typeFee: 4,
        distanceKm: 0,
        distanceFee: 0,
        total: 18,
      }),
    };
    paymentsService = {
      createDeliveryPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
    };
    proofService = {
      createAutoProof: jest.fn().mockResolvedValue({ id: 'proof-1' }),
    };
    serviceability = {
      checkServiceability: jest.fn().mockResolvedValue(SERVICEABLE),
    };
    promoService = {
      validateForRedeem: jest.fn(),
      computeDiscount: jest.fn(),
      redeemWithinTx: jest.fn().mockResolvedValue(undefined),
      releaseForDelivery: jest.fn().mockResolvedValue(undefined),
    };
    walletService = {
      debitWithinTx: jest.fn().mockResolvedValue(undefined),
      maybeGrantReferralRewardWithinTx: jest.fn().mockResolvedValue(undefined),
      refundForDelivery: jest.fn().mockResolvedValue(undefined),
      refundChargeToWallet: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    trackingPublisher = {
      publishUpdate: jest.fn().mockResolvedValue(undefined),
    };
    trackingHotStore = { enabled: false, readPosition: jest.fn() };
    outbox = { enqueueWithinTx: jest.fn().mockResolvedValue(undefined) };
    // Default: no pending referral (keeps the no-promo path a plain create).
    prisma.referral.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SimulationService, useValue: simulationService },
        { provide: GeoService, useValue: geoService },
        { provide: PricingService, useValue: pricingService },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: ProofService, useValue: proofService },
        { provide: ServiceabilityService, useValue: serviceability },
        { provide: PromoService, useValue: promoService },
        { provide: WalletService, useValue: walletService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: TrackingPublisher, useValue: trackingPublisher },
        { provide: TrackingHotStore, useValue: trackingHotStore },
        { provide: OutboxService, useValue: outbox },
        { provide: I18nService, useValue: new I18nService() },
      ],
    }).compile();

    service = module.get<DeliveriesService>(DeliveriesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create — trackingId collision retry', () => {
    const trackingCollision = () =>
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['trackingId'] },
      });

    it('retries the insert on a trackingId unique collision, then succeeds', async () => {
      prisma.delivery.create
        .mockRejectedValueOnce(trackingCollision())
        .mockResolvedValueOnce(mockDelivery);

      const result = await service.create(userId, createDto);

      expect(prisma.delivery.create).toHaveBeenCalledTimes(2); // collided once, retried
      expect((result as any).id).toBe(mockDelivery.id);
    });

    // Phase-3 §2 Stage-A1 keystone: the delivery id is pre-generated ONCE (the money
    // idempotency keys derive from it) and stays stable across the trackingId retry loop —
    // a re-run must NOT mint a second id (that would double-debit in the A2 saga). Vary
    // uuid per call so a per-attempt regeneration would be observable, and snapshot the id
    // at call time (deliveryData is mutated in place, so capture the value, not the ref).
    it('mints the delivery id once and reuses it across the trackingId retry loop', async () => {
      const uuidMod = require('uuid') as { v4: () => string };
      const spy = jest.spyOn(uuidMod, 'v4');
      let i = 0;
      spy.mockImplementation(() => `id-${i++}`);
      const seenIds: string[] = [];
      prisma.delivery.create.mockImplementation((args: any) => {
        seenIds.push(args.data.id as string);
        return seenIds.length === 1
          ? Promise.reject(trackingCollision())
          : Promise.resolve(mockDelivery);
      });

      await service.create(userId, createDto);

      expect(seenIds).toHaveLength(2);
      expect(seenIds[0]).toBeTruthy();
      expect(seenIds[0]).toBe(seenIds[1]); // same id on both attempts — minted once
      spy.mockRestore();
    });

    it('does NOT retry a non-trackingId unique violation (rethrows)', async () => {
      const other = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['idempotencyKey'] },
      });
      prisma.delivery.create.mockRejectedValue(other);

      await expect(service.create(userId, createDto)).rejects.toBe(other);
      expect(prisma.delivery.create).toHaveBeenCalledTimes(1);
    });

    it('gives up with a ConflictException after exhausting retries', async () => {
      prisma.delivery.create.mockRejectedValue(trackingCollision());

      await expect(service.create(userId, createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.delivery.create).toHaveBeenCalledTimes(5); // MAX_TRACKING_ID_TRIES
    });

    // Since `deliveries` is partitioned, trackingId is only a plain index there — global
    // uniqueness now lives on tracking_id_registry's PK, so a real collision surfaces on
    // the REGISTRY insert (delivery.create can no longer raise a trackingId P2002). The
    // whole tx rolls back and re-runs on a regenerated trackingId.
    it('retries when the REGISTRY insert collides on trackingId, then succeeds', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      prisma.trackingIdRegistry.create
        .mockRejectedValueOnce(trackingCollision())
        .mockResolvedValueOnce({});

      const result = await service.create(userId, createDto);

      expect(prisma.trackingIdRegistry.create).toHaveBeenCalledTimes(2);
      expect(prisma.delivery.create).toHaveBeenCalledTimes(2); // whole tx re-ran
      expect((result as any).id).toBe(mockDelivery.id);
    });

    it('inserts the registry row inside the create tx (enforces global trackingId uniqueness)', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(prisma.trackingIdRegistry.create).toHaveBeenCalledWith({
        data: {
          trackingId: mockDelivery.trackingId,
          deliveryId: mockDelivery.id,
          deliveryCreatedAt: mockDelivery.createdAt,
        },
      });
    });
  });

  describe('create', () => {
    it('should price via PricingService and store the returned total', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      // Delegates pricing to the single source of truth, passing coords
      expect(pricingService.estimate).toHaveBeenCalledWith(
        expect.objectContaining({
          packageSize: 'Medium',
          packageWeight: 2,
          packageTypes: ['electronics', 'fragile'],
          fromLat: createDto.fromLat,
          toLng: createDto.toLng,
        }),
      );
      const createCall = prisma.delivery.create.mock.calls[0][0];
      expect(createCall.data.estimatedPrice).toBe(18); // pricing.total
      expect(createCall.data.status).toBe(DeliveryStatus.PENDING);
      expect(createCall.data.trackingId).toBe('AAAAAAAA');
      // charges the delivery via PaymentsService for the priced total
      expect(paymentsService.createDeliveryPayment).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        18,
      );
    });

    it('should start simulation after creation', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(simulationService.startSimulation).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        userId,
        {
          fromLat: createDto.fromLat,
          fromLng: createDto.fromLng,
          toLat: createDto.toLat,
          toLng: createDto.toLng,
        },
      );
      // Coords supplied → no geocoding needed
      expect(geoService.geocode).not.toHaveBeenCalled();
    });

    it('should geocode missing coordinates from addresses', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      geoService.geocode
        .mockResolvedValueOnce({ lat: 1.1, lng: 2.2 }) // fromAddress
        .mockResolvedValueOnce({ lat: 3.3, lng: 4.4 }); // toAddress

      const dtoNoCoords = {
        ...createDto,
        fromLat: undefined,
        fromLng: undefined,
        toLat: undefined,
        toLng: undefined,
      };

      await service.create(userId, dtoNoCoords as any);

      expect(geoService.geocode).toHaveBeenCalledWith(createDto.fromAddress);
      expect(geoService.geocode).toHaveBeenCalledWith(createDto.toAddress);
      const createCall = prisma.delivery.create.mock.calls[0][0];
      expect(createCall.data.fromLat).toBe(1.1);
      expect(createCall.data.toLng).toBe(4.4);
      expect(simulationService.startSimulation).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        userId,
        { fromLat: 1.1, fromLng: 2.2, toLat: 3.3, toLng: 4.4 },
      );
    });
  });

  describe('create — scheduling', () => {
    // A pickup well in the future → SCHEDULED + a deferred kickoff (no immediate sim).
    const futureDto = () => {
      const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return {
        ...createDto,
        pickupDate: `${yyyy}-${mm}-${dd}`,
        pickupTime: '12:00',
      };
    };

    it('defers a future pickup: status SCHEDULED, kickoff scheduled, no immediate sim', async () => {
      prisma.delivery.create.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.SCHEDULED,
      });

      await service.create(userId, futureDto());

      const createCall = prisma.delivery.create.mock.calls[0][0];
      expect(createCall.data.status).toBe(DeliveryStatus.SCHEDULED);
      expect(createCall.data.scheduledFor).toBeInstanceOf(Date);
      expect(simulationService.scheduleKickoff).toHaveBeenCalledTimes(1);
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('treats a now/past pickup as immediate (status PENDING, sim starts now)', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      // createDto.pickupDate is 2026-04-10 (past) → immediate.
      await service.create(userId, createDto);

      const createCall = prisma.delivery.create.mock.calls[0][0];
      expect(createCall.data.status).toBe(DeliveryStatus.PENDING);
      expect(createCall.data.scheduledFor).toBeNull();
      expect(simulationService.startSimulation).toHaveBeenCalledTimes(1);
      expect(simulationService.scheduleKickoff).not.toHaveBeenCalled();
    });

    it('rejects a pickup beyond the max scheduling horizon', async () => {
      const d = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000); // +200 days
      const far = {
        ...createDto,
        pickupDate: d.toISOString().slice(0, 10),
        pickupTime: '12:00',
      };
      await expect(service.create(userId, far)).rejects.toMatchObject({
        status: 400,
      });
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });
  });

  describe('create — promo codes', () => {
    const fakeCode = { id: 'promo-1', code: 'WELCOME10' };

    it('applies the discount: charges + stores the discounted total and redeems atomically', async () => {
      promoService.validateForRedeem.mockResolvedValue(fakeCode);
      promoService.computeDiscount.mockReturnValue({
        discountAmount: 1.8,
        finalTotal: 16.2,
      });
      prisma.delivery.create.mockResolvedValue({
        ...mockDelivery,
        estimatedPrice: 16.2,
      });

      await service.create(userId, { ...createDto, promoCode: 'WELCOME10' });

      expect(promoService.validateForRedeem).toHaveBeenCalledWith(
        'WELCOME10',
        userId,
        18, // pricing.total
      );
      // The discounted total is what gets stored AND charged.
      expect(prisma.delivery.create.mock.calls[0][0].data.estimatedPrice).toBe(
        16.2,
      );
      expect(promoService.redeemWithinTx).toHaveBeenCalledWith(
        expect.anything(), // tx client
        fakeCode,
        userId,
        mockDelivery.id,
        18,
        { discountAmount: 1.8, finalTotal: 16.2 },
      );
      expect(paymentsService.createDeliveryPayment).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        16.2,
      );
    });

    it('skips payment for a free order (100% / over-value code)', async () => {
      promoService.validateForRedeem.mockResolvedValue(fakeCode);
      promoService.computeDiscount.mockReturnValue({
        discountAmount: 18,
        finalTotal: 0,
      });
      prisma.delivery.create.mockResolvedValue({
        ...mockDelivery,
        estimatedPrice: 0,
      });

      await service.create(userId, { ...createDto, promoCode: 'FREE100' });

      expect(paymentsService.createDeliveryPayment).not.toHaveBeenCalled();
    });

    it('does not touch promo when no code is supplied (unchanged path)', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      await service.create(userId, createDto);
      expect(promoService.validateForRedeem).not.toHaveBeenCalled();
      expect(promoService.redeemWithinTx).not.toHaveBeenCalled();
      expect(paymentsService.createDeliveryPayment).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        18,
      );
    });
  });

  describe('create — wallet credits & referral', () => {
    it('applies wallet credits stacked after promo (debit + reduced charge)', async () => {
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 10 });
      prisma.delivery.create.mockResolvedValue({
        ...mockDelivery,
        estimatedPrice: 8,
      });

      await service.create(userId, { ...createDto, useCredits: true });

      // 18 (total) - 10 (credits, clamped to balance) = 8 charged + stored.
      expect(prisma.delivery.create.mock.calls[0][0].data.estimatedPrice).toBe(
        8,
      );
      expect(walletService.debitWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        10,
        expect.objectContaining({ deliveryId: mockDelivery.id }),
      );
      expect(paymentsService.createDeliveryPayment).toHaveBeenCalledWith(
        mockDelivery.id,
        expect.any(Date),
        8,
      );
    });

    it('grants the referral reward on the first delivery (pending referral present)', async () => {
      prisma.referral.findFirst.mockResolvedValue({
        id: 'ref-1',
        refereeId: userId,
      });
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(
        walletService.maybeGrantReferralRewardWithinTx,
      ).toHaveBeenCalledWith(expect.anything(), userId);
    });

    it('does not spend credits when useCredits is absent', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      await service.create(userId, createDto);
      expect(walletService.debitWithinTx).not.toHaveBeenCalled();
    });
  });

  // The producer side of the outbox fork (DELIVERY_OUTBOX_REFERRAL=true). The flag is an
  // import-time const, so we drive the gate via referralOutboxEnabled() to exercise the
  // ENQUEUE arm — pinning that it enqueues the right event inside the tx, on the same
  // pendingReferral gate, and crucially does NOT also grant inline (no double-credit, B4).
  describe('create — referral via the outbox (routing enabled)', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'referralOutboxEnabled').mockReturnValue(true);
      prisma.delivery.create.mockResolvedValue(mockDelivery);
    });

    it('enqueues a REFERRAL_REWARD event inside the tx and does NOT grant inline', async () => {
      prisma.referral.findFirst.mockResolvedValue({
        id: 'ref-1',
        refereeId: userId,
      });

      await service.create(userId, createDto);

      expect(outbox.enqueueWithinTx).toHaveBeenCalledTimes(1);
      expect(outbox.enqueueWithinTx).toHaveBeenCalledWith(
        expect.anything(), // the tx handle — proves it runs inside $transaction
        expect.objectContaining({
          aggregateType: 'delivery',
          aggregateId: mockDelivery.id,
          eventType: OUTBOX_EVENT_REFERRAL_REWARD,
          idempotencyKey: `outbox-referral:${mockDelivery.id}`,
          payload: { refereeUserId: userId },
        }),
      );
      // No double-apply: the inline grant must NOT also fire.
      expect(
        walletService.maybeGrantReferralRewardWithinTx,
      ).not.toHaveBeenCalled();
    });

    it('neither enqueues nor grants when there is no pending referral (same gate)', async () => {
      prisma.referral.findFirst.mockResolvedValue(null);

      await service.create(userId, createDto);

      expect(outbox.enqueueWithinTx).not.toHaveBeenCalled();
      expect(
        walletService.maybeGrantReferralRewardWithinTx,
      ).not.toHaveBeenCalled();
    });
  });

  // Phase-3 §2 Stage-A2: the debit-first saga (DELIVERY_DEBIT_FIRST=ON). The charge-gating
  // promo-redeem + wallet-debit move into their OWN single-shard txns BEFORE the delivery
  // tx, keyed to the pre-generated id; orphaned reservations are reversed by the existing
  // idempotent compensations. The flag is an import-time const, so drive it via the gate.
  describe('create — debit-first saga (reservations enabled)', () => {
    // The uuid mock is fixed, so the pre-generated deliveryId is deterministic.
    const PREGEN_ID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
    const fakeCode = { id: 'promo-1', code: 'WELCOME10' };

    beforeEach(() => {
      jest.spyOn(service as any, 'debitFirstEnabled').mockReturnValue(true);
    });

    it('reserves promo + debit (own txns, keyed to the pre-generated id) and NOT inside the delivery tx', async () => {
      promoService.validateForRedeem.mockResolvedValue(fakeCode);
      promoService.computeDiscount.mockReturnValue({
        discountAmount: 1.8,
        finalTotal: 16.2,
      });
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 5 });
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, {
        ...createDto,
        promoCode: 'WELCOME10',
        useCredits: true,
      });

      // Reservations are keyed to the PRE-GENERATED id (not the returned row id) — proof
      // they ran in the pre-delivery reserve steps, not the legacy in-tx path.
      expect(promoService.redeemWithinTx).toHaveBeenCalledTimes(1);
      expect(promoService.redeemWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        fakeCode,
        userId,
        PREGEN_ID,
        18,
        { discountAmount: 1.8, finalTotal: 16.2 },
      );
      expect(walletService.debitWithinTx).toHaveBeenCalledTimes(1);
      expect(walletService.debitWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        5, // min(balance 5, afterPromo 16.2)
        { deliveryId: PREGEN_ID, idempotencyKey: `debit:${PREGEN_ID}` },
      );
      // The reserves committed before the delivery was created.
      expect(
        promoService.redeemWithinTx.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.delivery.create.mock.invocationCallOrder[0]);
      // No compensation on the happy path.
      expect(promoService.releaseForDelivery).not.toHaveBeenCalled();
      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
    });

    it('compensates BOTH reservations and aborts when the debit fails (no delivery, no charge)', async () => {
      promoService.validateForRedeem.mockResolvedValue(fakeCode);
      promoService.computeDiscount.mockReturnValue({
        discountAmount: 0,
        finalTotal: 18,
      });
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 10 });
      walletService.debitWithinTx.mockRejectedValue(
        new Error('WALLET_INSUFFICIENT_CREDITS'),
      );

      await expect(
        service.create(userId, {
          ...createDto,
          promoCode: 'WELCOME10',
          useCredits: true,
        }),
      ).rejects.toThrow('WALLET_INSUFFICIENT_CREDITS');

      // Both compensations run unconditionally: release the promo reserved first, AND refund
      // — refund is a no-op when the debit didn't commit (clean insufficient-credits), but is
      // the ONLY thing that reverses a debit whose $transaction committed yet rejected on the
      // way out (a post-commit driver error landing in this in-process catch). The delivery is
      // never created and the card is never charged.
      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(PREGEN_ID);
      expect(walletService.refundForDelivery).toHaveBeenCalledWith(PREGEN_ID);
      expect(prisma.delivery.create).not.toHaveBeenCalled();
      expect(paymentsService.createDeliveryPayment).not.toHaveBeenCalled();
    });

    it('compensates BOTH reservations when the delivery insert fails (non-collision error)', async () => {
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 10 });
      prisma.delivery.create.mockRejectedValue(new Error('db exploded'));

      await expect(
        service.create(userId, { ...createDto, useCredits: true }),
      ).rejects.toThrow('db exploded');

      expect(walletService.refundForDelivery).toHaveBeenCalledWith(PREGEN_ID);
      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(PREGEN_ID);
    });

    it('compensates and does NOT re-debit when the trackingId retries are exhausted', async () => {
      const collision = () =>
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['trackingId'] },
        });
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 10 });
      prisma.delivery.create.mockRejectedValue(collision());

      await expect(
        service.create(userId, { ...createDto, useCredits: true }),
      ).rejects.toThrow(ConflictException);

      // Debit ran exactly ONCE (in the reserve step) — the in-tx path is skipped under the
      // flag, so the retry loop never re-attempts it against the already-committed key.
      expect(walletService.debitWithinTx).toHaveBeenCalledTimes(1);
      expect(prisma.delivery.create).toHaveBeenCalledTimes(5); // MAX_TRACKING_ID_TRIES
      expect(walletService.refundForDelivery).toHaveBeenCalledWith(PREGEN_ID);
    });

    it('compensates the promo reservation when the promo redeem rejects with NO debit (post-commit leak)', async () => {
      // promoCode set + useCredits=false → creditsToApply=0, so the debit block is SKIPPED and
      // the promo $transaction is the only money write. A $transaction can commit and then have
      // its awaited promise reject (a post-commit driver error); that must still compensate
      // synchronously. Regression: the promo redeem used to sit outside any try/catch, so this
      // leaked a consumed promo slot with no delivery and no charge until the orphan reaper.
      promoService.validateForRedeem.mockResolvedValue(fakeCode);
      promoService.computeDiscount.mockReturnValue({
        discountAmount: 0,
        finalTotal: 18,
      });
      promoService.redeemWithinTx.mockRejectedValue(
        new Error('post-commit connection reset'),
      );

      await expect(
        service.create(userId, {
          ...createDto,
          promoCode: 'WELCOME10',
          useCredits: false,
        }),
      ).rejects.toThrow('post-commit connection reset');

      // The promo slot is released (idempotent) even though no debit ran...
      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(PREGEN_ID);
      // ...and nothing downstream happened: no debit, no delivery, no card charge.
      expect(walletService.debitWithinTx).not.toHaveBeenCalled();
      expect(prisma.delivery.create).not.toHaveBeenCalled();
      expect(paymentsService.createDeliveryPayment).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('clones a past delivery into a new one (via create) with an immediate pickup', async () => {
      // findOne (owner-scoped) returns the source; create() then runs fresh.
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId,
        fromAddress: 'Old From',
        toAddress: 'Old To',
        fromLat: -6.9,
        fromLng: 107.6,
        toLat: -6.92,
        toLng: 107.62,
        receiver: 'Repeat Bob',
        packages: 'Same box',
        packageSize: 'Medium',
        packageWeight: 2,
        packageTypes: ['electronics'],
      });
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.reorder(userId, 'delivery-1');

      // A NEW delivery row was created, cloning the source's params.
      const data = prisma.delivery.create.mock.calls[0][0].data;
      expect(data.fromAddress).toBe('Old From');
      expect(data.receiver).toBe('Repeat Bob');
      expect(data.pickupDate).toBeInstanceOf(Date); // create() wraps the string
      expect(data.pickupTime).toMatch(/^\d{2}:\d{2}$/);
      // Immediate (now) → PENDING, not SCHEDULED.
      expect(data.status).toBe(DeliveryStatus.PENDING);
    });

    it('throws NotFound when reordering a delivery the user does not own', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId: 'other',
      });
      await expect(service.reorder(userId, 'delivery-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create — serviceability gate', () => {
    it('rejects out-of-area with 422 and NO side effects', async () => {
      serviceability.checkServiceability.mockResolvedValue({
        serviceable: false,
        reasons: ['Pickup or dropoff is outside our service area.'],
        codes: ['OUT_OF_AREA'],
        weatherHold: false,
      });

      await expect(service.create(userId, createDto)).rejects.toMatchObject({
        status: 422,
      });
      // No DB write, no payment, no simulation enqueued.
      expect(prisma.delivery.create).not.toHaveBeenCalled();
      expect(paymentsService.createDeliveryPayment).not.toHaveBeenCalled();
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('rejects a weather hold with 503 (retryable)', async () => {
      serviceability.checkServiceability.mockResolvedValue({
        serviceable: false,
        reasons: ['A storm is grounding drones right now.'],
        codes: ['WEATHER_STORM'],
        weatherHold: true,
      });

      await expect(service.create(userId, createDto)).rejects.toMatchObject({
        status: 503,
      });
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });

    it('rejects with 422 when coordinates cannot be resolved (no safety bypass)', async () => {
      geoService.geocode.mockResolvedValue(null);
      // address-only dto + geocode fails → no coords → can't verify → reject.
      const { fromLat, fromLng, toLat, toLng, ...addressOnly } = createDto;

      await expect(
        service.create(userId, addressOnly as any),
      ).rejects.toMatchObject({ status: 422 });
      expect(serviceability.checkServiceability).not.toHaveBeenCalled();
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should filter by current (active) statuses', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { status: 'current' } as any);

      const where = prisma.delivery.findMany.mock.calls[0][0].where;
      expect(where.status.in).toEqual([
        DeliveryStatus.PENDING,
        DeliveryStatus.CONFIRMED,
        DeliveryStatus.DRONE_ASSIGNED,
        DeliveryStatus.PICKUP_IN_PROGRESS,
        DeliveryStatus.IN_TRANSIT,
        DeliveryStatus.AWAITING_HANDOFF,
        // A returning drone is still airborne/live, so it stays in the active list.
        DeliveryStatus.RETURNING,
      ]);
    });

    it('should filter "completed" by all settled outcomes incl. terminal exceptions', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { status: 'completed' } as any);

      const where = prisma.delivery.findMany.mock.calls[0][0].where;
      // Failed / returned-to-base must be discoverable (not orphaned from every list).
      expect(where.status.in).toEqual([
        DeliveryStatus.DELIVERED,
        DeliveryStatus.DELIVERY_FAILED,
        DeliveryStatus.RETURNED_TO_BASE,
      ]);
    });

    it('should filter by canceled status', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { status: 'canceled' } as any);

      const where = prisma.delivery.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(DeliveryStatus.CANCELED);
    });

    it('should apply search query across trackingId, packages, receiver', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { q: 'test' } as any);

      const where = prisma.delivery.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(3);
    });

    it('should sort by title when specified', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { sort: 'title' } as any);

      const orderBy = prisma.delivery.findMany.mock.calls[0][0].orderBy;
      expect(orderBy).toEqual({ packages: 'asc' });
    });

    it('should return paginated result', async () => {
      prisma.delivery.findMany.mockResolvedValue([mockDelivery]);
      prisma.delivery.count.mockResolvedValue(1);

      const result = await service.findAll(userId, {
        page: 1,
        limit: 20,
      } as any);

      expect(result).toEqual({
        items: [mockDelivery],
        total: 1,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('findOne', () => {
    it('should return delivery with relations', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        tracking: null,
        workflowSteps: [],
        payment: null,
      });

      const result = await service.findOne(userId, 'delivery-1');

      expect(result.id).toBe('delivery-1');
      expect(prisma.delivery.findUnique).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        include: {
          tracking: true,
          workflowSteps: true,
          payment: true,
          proofOfDelivery: true,
          rating: true,
        },
      });
    });

    it('overlays the live hot-store position onto the poll when the hot-store is on', async () => {
      trackingHotStore.enabled = true;
      trackingHotStore.readPosition.mockResolvedValue({
        droneLat: -6.9,
        droneLng: 107.6,
        droneStatus: 'En route',
      });
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        tracking: {
          deliveryId: 'delivery-1',
          droneLat: 0,
          droneLng: 0,
          eta: null,
        },
        workflowSteps: [],
        payment: null,
      });

      const result = await service.findOne(userId, 'delivery-1');

      // The checkpointed (stale) 0,0 is overlaid with the live Redis position.
      expect(result.tracking!.droneLat).toBe(-6.9);
      expect(result.tracking!.droneLng).toBe(107.6);
      expect(result.tracking!.droneStatus).toBe('En route');
      expect(trackingHotStore.readPosition).toHaveBeenCalledWith('delivery-1');
    });

    it('does NOT touch the hot-store when it is disabled (default)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        tracking: { deliveryId: 'delivery-1', droneLat: 1, droneLng: 2 },
      });

      const result = await service.findOne(userId, 'delivery-1');

      expect(result.tracking!.droneLat).toBe(1); // unchanged
      expect(trackingHotStore.readPosition).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if delivery not found', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if delivery belongs to another user', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId: 'other-user',
      });

      await expect(service.findOne(userId, 'delivery-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByTrackingId', () => {
    it('should return the delivery by tracking ID for its owner', async () => {
      prisma.trackingIdRegistry.findUnique.mockResolvedValue({
        deliveryId: mockDelivery.id,
        deliveryCreatedAt: mockDelivery.createdAt,
      });
      prisma.delivery.findUnique.mockResolvedValue(mockDelivery);

      const result = await service.findByTrackingId(userId, 'AAAAAAAA');

      expect(result).toEqual(mockDelivery);
    });

    it('should throw NotFoundException if tracking ID not found', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);

      await expect(service.findByTrackingId(userId, 'INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if it belongs to another user (no leak)', async () => {
      prisma.trackingIdRegistry.findUnique.mockResolvedValue({
        deliveryId: mockDelivery.id,
        deliveryCreatedAt: mockDelivery.createdAt,
      });
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId: 'other-user',
      });

      await expect(
        service.findByTrackingId(userId, 'AAAAAAAA'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getActive', () => {
    it('should return active deliveries for user', async () => {
      prisma.delivery.findMany.mockResolvedValue([mockDelivery]);

      const result = await service.getActive(userId);

      expect(result).toEqual([mockDelivery]);
      const call = prisma.delivery.findMany.mock.calls[0][0];
      expect(call.where.status.in).toContain(DeliveryStatus.PENDING);
      expect(call.take).toBe(5);
    });
  });

  describe('getRecent', () => {
    it('should return recently delivered items', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);

      await service.getRecent(userId);

      const call = prisma.delivery.findMany.mock.calls[0][0];
      expect(call.where.status).toBe(DeliveryStatus.DELIVERED);
      expect(call.take).toBe(5);
    });
  });

  describe('cancel', () => {
    it('should cancel a PENDING delivery', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.PENDING,
      });
      prisma.delivery.update.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.CANCELED,
      });

      const result = await service.cancel(userId, 'delivery-1');

      expect(result.status).toBe(DeliveryStatus.CANCELED);
      expect(simulationService.stopSimulation).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('should cancel a CONFIRMED delivery', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.CONFIRMED,
      });
      prisma.delivery.update.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.CANCELED,
      });

      const result = await service.cancel(userId, 'delivery-1');

      expect(result.status).toBe(DeliveryStatus.CANCELED);
    });

    it('releases any promo redemption on cancel (best-effort)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.PENDING,
      });
      prisma.delivery.update.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.CANCELED,
      });

      await service.cancel(userId, 'delivery-1');

      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('should cancel a SCHEDULED delivery (removes the pending kickoff job)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.SCHEDULED,
      });
      prisma.delivery.update.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.CANCELED,
      });

      const result = await service.cancel(userId, 'delivery-1');

      expect(result.status).toBe(DeliveryStatus.CANCELED);
      // stopSimulation removes the :kickoff job (and any stage/pos jobs).
      expect(simulationService.stopSimulation).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('should throw NotFoundException if delivery not found', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);

      await expect(service.cancel(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if delivery belongs to another user', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId: 'other-user',
      });

      await expect(service.cancel(userId, 'delivery-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if delivery is IN_TRANSIT', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        status: DeliveryStatus.IN_TRANSIT,
      });

      await expect(service.cancel(userId, 'delivery-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('recipient handoff OTP', () => {
    const CODE = '123456';
    const hashOf = (c: string) =>
      crypto.createHash('sha256').update(c).digest('hex');
    const arrived = {
      ...mockDelivery,
      status: DeliveryStatus.AWAITING_HANDOFF,
      handoffCodeHash: hashOf(CODE),
      handoffAttempts: 0,
      toLat: -6.922,
      toLng: 107.607,
      receiver: 'Jane Doe',
    };

    it('create() generates a 6-digit code, stores only its SHA-256 hash, returns plaintext once', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      const result = await service.create(userId, createDto);

      const data = prisma.delivery.create.mock.calls[0][0].data;
      expect(data.handoffCodeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data).not.toHaveProperty('handoffCode'); // plaintext never persisted
      expect((result as any).handoffCode).toMatch(/^\d{6}$/);
      // the stored hash is the hash of the returned plaintext
      expect(data.handoffCodeHash).toBe(hashOf((result as any).handoffCode));
    });

    it('confirms with the correct code → DELIVERED (atomic) + records proof', async () => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce(arrived) // confirm read (opts in the hash)
        .mockResolvedValueOnce({
          ...arrived,
          status: DeliveryStatus.DELIVERED,
        }); // findOne re-fetch
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.confirmHandoff(userId, 'delivery-1', CODE);

      const upd = prisma.delivery.updateMany.mock.calls[0][0];
      expect(upd.where.status).toBe(DeliveryStatus.AWAITING_HANDOFF);
      expect(upd.data.status).toBe(DeliveryStatus.DELIVERED);
      expect(proofService.createAutoProof).toHaveBeenCalledWith(
        'delivery-1',
        expect.any(Date),
        {
          lat: -6.922,
          lng: 107.607,
          recipientName: 'Jane Doe',
        },
      );
    });

    it('rejects a wrong code with 401 and atomically increments the counter', async () => {
      prisma.delivery.findUnique.mockResolvedValue(arrived);
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.confirmHandoff(userId, 'delivery-1', '000000'),
      ).rejects.toThrow(UnauthorizedException);

      // Conditional increment (only while under the cap) — TOCTOU-safe.
      expect(prisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'delivery-1', handoffAttempts: { lt: 5 } },
        data: { handoffAttempts: { increment: 1 } },
      });
    });

    it('returns 423 when the attempt cap is reached concurrently (atomic guard)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...arrived,
        handoffAttempts: 4,
      });
      // Another concurrent request just hit the cap → conditional increment misses.
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.confirmHandoff(userId, 'delivery-1', '000000'),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('an already-locked handoff (attempts === MAX) self-heals to DELIVERY_FAILED and returns 423', async () => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce({ ...arrived, handoffAttempts: 5 }) // confirm read
        .mockResolvedValueOnce({ userId }); // announceException read
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 }); // fail CAS applies

      await expect(
        service.confirmHandoff(userId, 'delivery-1', CODE),
      ).rejects.toMatchObject({ status: 423 });

      // Self-heal: a locked-but-untransitioned delivery is failed on the next touch.
      const failCas = prisma.delivery.updateMany.mock.calls.find(
        (c: any) => c[0]?.data?.status === DeliveryStatus.DELIVERY_FAILED,
      );
      expect(failCas).toBeTruthy();
    });

    it('auto-fails the delivery (DELIVERY_FAILED / RECIPIENT_UNAVAILABLE) when the wrong-attempt counter reaches the cap', async () => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce({ ...arrived, handoffAttempts: 4 }) // confirm read
        .mockResolvedValueOnce({ handoffAttempts: 5 }) // post-CAS re-read (now at cap)
        .mockResolvedValueOnce({ userId }); // announceException read
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.confirmHandoff(userId, 'delivery-1', '000000'),
      ).rejects.toMatchObject({ status: 423 });

      const failCas = prisma.delivery.updateMany.mock.calls.find(
        (c: any) => c[0]?.data?.status === DeliveryStatus.DELIVERY_FAILED,
      );
      expect(failCas).toBeTruthy();
      expect(failCas![0].data.failureReason).toBe('RECIPIENT_UNAVAILABLE');
      // recipient-fault → NO auto-refund.
      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
      expect(walletService.refundChargeToWallet).not.toHaveBeenCalled();
    });

    it('does NOT lock/fail on a non-final wrong attempt (counter still below cap)', async () => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce({ ...arrived, handoffAttempts: 1 }) // confirm read
        .mockResolvedValueOnce({ handoffAttempts: 2 }); // post-CAS re-read (still under cap)
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.confirmHandoff(userId, 'delivery-1', '000000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const failCas = prisma.delivery.updateMany.mock.calls.find(
        (c: any) => c[0]?.data?.status === DeliveryStatus.DELIVERY_FAILED,
      );
      expect(failCas).toBeFalsy();
    });

    it('rejects confirm when not yet AWAITING_HANDOFF (409)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...arrived,
        status: DeliveryStatus.IN_TRANSIT,
      });
      await expect(
        service.confirmHandoff(userId, 'delivery-1', CODE),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects confirm when already DELIVERED (409)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...arrived,
        status: DeliveryStatus.DELIVERED,
      });
      await expect(
        service.confirmHandoff(userId, 'delivery-1', CODE),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects another user's delivery with NotFound (no leak)", async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...arrived,
        userId: 'other-user',
      });
      await expect(
        service.confirmHandoff(userId, 'delivery-1', CODE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delivery exceptions (P3 #16)', () => {
    beforeEach(() => {
      prisma.delivery.findUnique.mockResolvedValue({ userId });
    });

    it('failExceptional → DELIVERY_FAILED via a guarded in-flight-only CAS, with drone-fault refund + comms', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const applied = await service.failExceptional(
        'delivery-1',
        'WEATHER_ABORT' as any,
      );

      expect(applied).toBe(true);
      const cas = prisma.delivery.updateMany.mock.calls[0][0];
      expect(cas.where.status.in).toEqual(
        expect.arrayContaining([
          'DRONE_ASSIGNED',
          'PICKUP_IN_PROGRESS',
          'IN_TRANSIT',
          'AWAITING_HANDOFF',
        ]),
      );
      // Never from a terminal or an early (cancelable) state.
      expect(cas.where.status.in).not.toContain('DELIVERED');
      expect(cas.where.status.in).not.toContain('CANCELED');
      expect(cas.where.status.in).not.toContain('PENDING');
      expect(cas.data).toEqual({
        status: 'DELIVERY_FAILED',
        failureReason: 'WEATHER_ABORT',
      });
      expect(simulationService.stopSimulation).toHaveBeenCalledWith(
        'delivery-1',
      );
      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(
        'delivery-1',
      );
      expect(walletService.refundForDelivery).toHaveBeenCalledWith(
        'delivery-1',
      );
      // Make the customer whole: the card-charged portion is credited to the wallet.
      expect(walletService.refundChargeToWallet).toHaveBeenCalledWith(
        'delivery-1',
      );
      expect(notificationsService.create).toHaveBeenCalled();
      expect(trackingPublisher.publishUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DELIVERY_FAILED' }),
      );
    });

    it('failExceptional is a no-op (no cleanup/comms) when the CAS matches nothing', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      const applied = await service.failExceptional(
        'delivery-1',
        'MECHANICAL' as any,
      );

      expect(applied).toBe(false);
      expect(simulationService.stopSimulation).not.toHaveBeenCalled();
      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('recipient-fault failure stops the sim but does NOT auto-refund or release the promo', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.failExceptional(
        'delivery-1',
        'RECIPIENT_UNAVAILABLE' as any,
      );

      expect(simulationService.stopSimulation).toHaveBeenCalled();
      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
      expect(walletService.refundChargeToWallet).not.toHaveBeenCalled();
      expect(promoService.releaseForDelivery).not.toHaveBeenCalled();
    });

    it('adminForceCancel cannot resurrect a settled exception terminal (excludes all terminals)', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.DELIVERY_FAILED,
      });

      await expect(service.adminForceCancel('delivery-1')).rejects.toThrow(
        ConflictException,
      );
      const cas = prisma.delivery.updateMany.mock.calls[0][0];
      expect(cas.where.status.notIn).toEqual(
        expect.arrayContaining([
          'DELIVERED',
          'CANCELED',
          'DELIVERY_FAILED',
          'RETURNED_TO_BASE',
        ]),
      );
    });

    it('failExceptional can rescue a stuck RETURNING flight (RETURNING is failable)', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
      await service.failExceptional('delivery-1', 'MECHANICAL' as any);
      const cas = prisma.delivery.updateMany.mock.calls[0][0];
      expect(cas.where.status.in).toContain('RETURNING');
    });

    it('localizes the exception notification + map label to the owner locale', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
      // announceException reads userId + the owner's locale in one query.
      prisma.delivery.findUnique.mockResolvedValue({
        userId,
        user: { locale: 'id' },
      });

      await service.failExceptional('delivery-1', 'WEATHER_ABORT' as any);

      expect(notificationsService.create).toHaveBeenCalledWith(
        userId,
        'Pengiriman Dibatalkan — Cuaca',
        expect.stringContaining('Cuaca buruk'),
        expect.objectContaining({ failureReason: 'WEATHER_ABORT' }),
        'delivery',
      );
      expect(trackingPublisher.publishUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ droneStatus: 'Dibatalkan — cuaca' }),
      );
    });

    it('beginReturnToBase enters RETURNING from a package-carrying state and refunds at the abort', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const applied = await service.beginReturnToBase(
        'delivery-1',
        'WEATHER_ABORT' as any,
      );

      expect(applied).toBe(true);
      const cas = prisma.delivery.updateMany.mock.calls[0][0];
      expect(cas.where.status.in).toEqual(
        expect.arrayContaining([
          'PICKUP_IN_PROGRESS',
          'IN_TRANSIT',
          'AWAITING_HANDOFF',
        ]),
      );
      // Not from DRONE_ASSIGNED — nothing picked up yet → that's a FAIL, not a return.
      expect(cas.where.status.in).not.toContain('DRONE_ASSIGNED');
      expect(cas.data).toEqual({
        status: 'RETURNING',
        failureReason: 'WEATHER_ABORT',
      });
      expect(walletService.refundForDelivery).toHaveBeenCalled();
    });

    it('completeReturnToBase only fires from RETURNING and runs no second cleanup', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      const applied = await service.completeReturnToBase('delivery-1');

      expect(applied).toBe(true);
      const cas = prisma.delivery.updateMany.mock.calls[0][0];
      expect(cas.where.status).toBe('RETURNING');
      expect(cas.data).toEqual({ status: 'RETURNED_TO_BASE' });
      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
      expect(trackingPublisher.publishUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'RETURNED_TO_BASE' }),
      );
    });

    it('adminFail throws 404 when the delivery does not exist', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });
      prisma.delivery.findUnique.mockResolvedValue(null);
      await expect(
        service.adminFail('missing', 'ADMIN_ABORT' as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('adminFail throws 409 when the delivery is in a non-failable state', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.DELIVERED,
      });
      await expect(
        service.adminFail('delivery-1', 'ADMIN_ABORT' as any),
      ).rejects.toThrow(ConflictException);
    });
  });
});

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
import { FAILABLE_STATUSES } from './delivery-exceptions';
import { DispatchService } from '../dispatch/dispatch.service';
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
    // At the Medium cap (MAX_WEIGHT_KG.Medium = 1.5). create() now rejects an
    // over-capacity package, so the shared fixture has to be a package a drone
    // can actually lift. Pricing is mocked below, so the number here does not
    // feed any expected total.
    packageWeight: 1.5,
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
    // create() geocodes BOTH addresses on every call now (the geocode is
    // authoritative for pricing/serviceability — caller coords are never trusted),
    // so the default mock has to resolve. It returns the fixture's coords so the
    // existing "stored/simulated with these coords" assertions still describe the
    // same delivery. Per-test mockResolvedValueOnce/mockResolvedValue overrides
    // still take precedence.
    geoService = {
      geocode: jest.fn((address: string) =>
        Promise.resolve(
          address === createDto.fromAddress
            ? { lat: createDto.fromLat, lng: createDto.fromLng }
            : { lat: createDto.toLat, lng: createDto.toLng },
        ),
      ),
    };
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
        // The REAL engine, wired to the same mock prisma — so these specs exercise
        // the actual dispatch decision rather than a stub that always agrees.
        DispatchService,
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
          packageWeight: 1.5,
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
      // Coords supplied, but the server still geocodes: the address is the
      // authoritative source for pricing + serviceability. (It used to short-circuit
      // here, which is what let a caller price their own delivery.)
      expect(geoService.geocode).toHaveBeenCalledWith(createDto.fromAddress);
      expect(geoService.geocode).toHaveBeenCalledWith(createDto.toAddress);
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

    afterEach(() => {
      delete process.env.LIVE_DISPATCH;
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

    it('hands back the claimed aircraft when the debit fails', async () => {
      // The claim commits on `drones` — a separate, non-partitioned row that no
      // delivery rollback touches — so an aborted create() that skips the release
      // strands the airframe against a deliveryId that will never exist. No later
      // release can key on it, and no sweeper exists. The collision and
      // tracking-id-exhausted paths below already do this; the reservation path
      // was the one throw out of create() that did not.
      process.env.LIVE_DISPATCH = 'true';
      prisma.drone.findMany.mockResolvedValue([
        {
          id: 'drone-7',
          maxPayloadKg: 5,
          rangeKm: 40,
          batteryPercent: 100,
          homeBaseLat: createDto.fromLat,
          homeBaseLng: createDto.fromLng,
          currentLat: null,
          currentLng: null,
        },
      ]);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });
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

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: PREGEN_ID },
        data: { activeDeliveryId: null, status: 'AVAILABLE' },
      });
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
        // Stored coords deliberately far from whatever 'Old From'/'Old To' geocode
        // to: reorder must NOT replay them into the caller-coord deviation check.
        fromLat: -6.9,
        fromLng: 107.6,
        toLat: -6.92,
        toLng: 107.62,
        receiver: 'Repeat Bob',
        packages: 'Same box',
        packageSize: 'Medium',
        packageWeight: 1.5, // within the Medium cap — reorder goes through create()
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

    it('does not replay the source delivery coords into the caller-coord check', async () => {
      // The source carries coords that disagree with what its addresses geocode to.
      // If reorder forwarded them, assertCoordAgreesWithAddress would 400 — so a
      // customer could never reorder a delivery created before the geocode became
      // authoritative. create() re-geocodes instead.
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId,
        fromAddress: 'Old From',
        toAddress: 'Old To',
        fromLat: 10,
        fromLng: 120,
        toLat: -30,
        toLng: -60,
        packageSize: 'Medium',
        packageWeight: 1.5,
        packageTypes: ['electronics'],
      });
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      geoService.geocode.mockImplementation((address: string) =>
        Promise.resolve(
          address === 'Old From'
            ? { lat: -6.5, lng: 107.1 }
            : { lat: -6.6, lng: 107.2 },
        ),
      );

      await expect(
        service.reorder(userId, 'delivery-1'),
      ).resolves.toBeDefined();

      // Geocoded from the addresses — the stored (10, 120) never reaches the row.
      const data = prisma.delivery.create.mock.calls[0][0].data;
      expect(data.fromLat).toBe(-6.5);
      expect(data.fromLng).toBe(107.1);
      expect(data.toLat).toBe(-6.6);
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

  describe('create — pricing trust boundary', () => {
    // The distance fee (PER_KM_RATE × haversine) is the largest single component of
    // the price. It used to be computed from coordinates the CALLER supplied, so
    // posting fromLat/fromLng === toLat/toLng zeroed it — and the same coords were
    // then handed to the serviceability check, passing the geofence by construction.
    it('prices from the server geocode, NOT the caller coords', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      // Caller coords nudged ~55 m — inside the 1 km tolerance, so they survive
      // validation and the ONLY thing that can reject them is being ignored.
      await service.create(userId, {
        ...createDto,
        fromLat: createDto.fromLat + 0.0005,
        fromLng: createDto.fromLng + 0.0005,
        toLat: createDto.toLat + 0.0005,
        toLng: createDto.toLng + 0.0005,
      } as any);

      // Priced on the geocoded route (the fixture's real, distinct coords).
      expect(pricingService.estimate).toHaveBeenCalledWith(
        expect.objectContaining({
          fromLat: createDto.fromLat,
          fromLng: createDto.fromLng,
          toLat: createDto.toLat,
          toLng: createDto.toLng,
        }),
      );

      // …and the geocoded route is what gets stored + flown.
      const data = prisma.delivery.create.mock.calls[0][0].data;
      expect(data.toLat).toBe(createDto.toLat);
      expect(data.toLng).toBe(createDto.toLng);
    });

    it('serviceability is checked against the geocode, not the caller coords', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, {
        ...createDto,
        fromLat: createDto.fromLat + 0.0005,
        fromLng: createDto.fromLng + 0.0005,
        toLat: createDto.toLat + 0.0005,
        toLng: createDto.toLng + 0.0005,
      } as any);

      expect(serviceability.checkServiceability).toHaveBeenCalledWith(
        createDto.fromLat,
        createDto.fromLng,
        createDto.toLat,
        createDto.toLng,
      );
    });

    it('rejects the zero-the-distance-fee shape (pickup coords claimed at the dropoff)', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await expect(
        service.create(userId, {
          ...createDto,
          toLat: createDto.fromLat,
          toLng: createDto.fromLng,
        } as any),
      ).rejects.toMatchObject({ status: 400 });

      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });

    it('rejects a caller coord that disagrees with its address by more than 1 km', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      // ~11 km north of the geocoded pickup.
      await expect(
        service.create(userId, {
          ...createDto,
          fromLat: createDto.fromLat + 0.1,
        } as any),
      ).rejects.toMatchObject({ status: 400 });

      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });

    it('accepts a caller coord within 1 km of its address (rooftop pin vs street centroid)', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      // ~55 m off — a plausible precise drop point.
      await expect(
        service.create(userId, {
          ...createDto,
          fromLat: createDto.fromLat + 0.0005,
        } as any),
      ).resolves.toBeDefined();
    });

    it('rejects a pickupDate that matches the shape regex but is not a real date', async () => {
      // The DTO's @Matches is shape-only, so "2026-02-31" reaches the service. Date.UTC
      // would roll it to Mar 3 and schedule the flight for a day nobody asked for.
      await expect(
        service.create(userId, {
          ...createDto,
          pickupDate: '2026-02-31',
        } as any),
      ).rejects.toMatchObject({ status: 400 });

      // Rejected before any geocode / pricing / DB work.
      expect(geoService.geocode).not.toHaveBeenCalled();
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });

    it('rejects a package over the per-size payload cap', async () => {
      await expect(
        service.create(userId, {
          ...createDto,
          packageSize: 'Small',
          packageWeight: 500,
        } as any),
      ).rejects.toMatchObject({ status: 400 });

      // Rejected before any geocode / pricing / DB work.
      expect(geoService.geocode).not.toHaveBeenCalled();
      expect(pricingService.estimate).not.toHaveBeenCalled();
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });

    it('enforces the payload cap on reorder, which never sees the ValidationPipe', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId,
        packageSize: 'Small',
        packageWeight: 500,
        packageTypes: ['electronics'],
      });

      await expect(service.reorder(userId, 'delivery-1')).rejects.toMatchObject(
        {
          status: 400,
        },
      );
      expect(prisma.delivery.create).not.toHaveBeenCalled();
    });
  });

  describe('create — dispatch (LIVE)', () => {
    // A registered airframe the mock fleet query returns. Generous range so the
    // default createDto route is comfortably feasible; individual tests narrow it.
    const aircraft = {
      id: 'drone-1',
      maxPayloadKg: 5,
      rangeKm: 40,
      batteryPercent: 100,
      homeBaseLat: createDto.fromLat,
      homeBaseLng: createDto.fromLng,
      currentLat: null,
      currentLng: null,
    };

    beforeEach(() => {
      // LIVE dispatch is opt-in per deployment; every other spec in this file runs
      // with it off, which is the default and the pre-existing behavior.
      process.env.LIVE_DISPATCH = 'true';
      prisma.drone.findMany.mockResolvedValue([aircraft]);
    });
    afterEach(() => {
      delete process.env.LIVE_DISPATCH;
    });

    it('selects an aircraft the customer never named and claims it atomically', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });

      await service.create(userId, createDto);

      // A conditional update, not a read-then-write: every precondition is in the
      // WHERE, so two creates racing for the last aircraft cannot both win.
      const arg = prisma.drone.updateMany.mock.calls[0][0];
      expect(arg.where).toMatchObject({
        id: 'drone-1',
        airworthy: true,
        status: 'AVAILABLE',
        activeDeliveryId: null,
      });
      expect(arg.where.maxPayloadKg).toEqual({ gte: createDto.packageWeight });
      expect(arg.data).toMatchObject({ status: 'IN_FLIGHT' });
      expect(arg.data.activeDeliveryId).toEqual(expect.any(String));

      const created = prisma.delivery.create.mock.calls[0][0].data;
      expect(created.assignedDroneId).toBe('drone-1');
      expect(created.trackingSource).toBe('LIVE');
      // A live delivery is driven by real telemetry — it must enqueue no sim jobs.
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('prefers the SMALLEST sufficient airframe, not the nearest', async () => {
      // Sending the heavy-lift drone on a light job is locally optimal and globally
      // wrong: it is the only aircraft that can take the next heavy booking.
      prisma.drone.findMany.mockResolvedValue([
        { ...aircraft, id: 'heavy', maxPayloadKg: 25 },
        { ...aircraft, id: 'light', maxPayloadKg: 2 },
      ]);
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });

      await service.create(userId, createDto);

      expect(prisma.drone.updateMany.mock.calls[0][0].where.id).toBe('light');
    });

    it('moves to the next candidate when another booking wins the race', async () => {
      prisma.drone.findMany.mockResolvedValue([
        { ...aircraft, id: 'first', maxPayloadKg: 2 },
        { ...aircraft, id: 'second', maxPayloadKg: 3 },
      ]);
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      // The ranked-first aircraft was claimed between the read and the write.
      prisma.drone.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValue({ count: 1 });

      await service.create(userId, createDto);

      expect(prisma.drone.updateMany.mock.calls[0][0].where.id).toBe('first');
      expect(prisma.drone.updateMany.mock.calls[1][0].where.id).toBe('second');
      expect(prisma.delivery.create.mock.calls[0][0].data.assignedDroneId).toBe(
        'second',
      );
    });

    it('rejects rather than downgrading to a simulation when the fleet is saturated', async () => {
      // The failure mode this guards: quietly creating a SIMULATED delivery so the
      // customer watches an animation of a drone that was never dispatched.
      prisma.drone.findMany.mockResolvedValue([]);
      prisma.drone.count.mockResolvedValue(3); // capable aircraft exist, all busy

      await expect(service.create(userId, createDto)).rejects.toMatchObject({
        status: 409,
      });

      expect(prisma.delivery.create).not.toHaveBeenCalled();
      expect(simulationService.startSimulation).not.toHaveBeenCalled();
    });

    it('says the package is too heavy when NO airframe in the fleet could ever lift it', async () => {
      // Distinct from saturation: "try again later" is a lie when the answer will
      // never change. This is the one fleet fact worth telling a customer.
      prisma.drone.findMany.mockResolvedValue([]);
      prisma.drone.count.mockResolvedValue(0);

      await expect(service.create(userId, createDto)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          messageKey: 'error.delivery.dispatch.no_capacity',
        }),
      });
    });

    it('will not dispatch an aircraft that cannot also get home', async () => {
      // Range is an OUT-AND-BACK budget. A drone that reaches the dropoff and
      // cannot return is not a delivery, it is a crash site with a parcel next to it.
      prisma.drone.findMany.mockResolvedValue([{ ...aircraft, rangeKm: 0.2 }]);
      prisma.drone.count.mockResolvedValue(1);

      await expect(service.create(userId, createDto)).rejects.toMatchObject({
        status: 409,
      });
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('holds no aircraft for a SCHEDULED pickup', async () => {
      // You do not take an airframe out of service for three weeks. A scheduled
      // flight is dispatched at its kickoff.
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const pickupDate = future.toISOString().slice(0, 10);

      await service.create(userId, { ...createDto, pickupDate });

      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
      expect(
        prisma.delivery.create.mock.calls[0][0].data.assignedDroneId,
      ).toBeNull();
    });

    it('gives the aircraft back when the create that claimed it never commits', async () => {
      prisma.drone.updateMany.mockResolvedValue({ count: 1 });
      prisma.delivery.create.mockRejectedValue(new Error('insert exploded'));

      await expect(service.create(userId, createDto)).rejects.toThrow(
        'insert exploded',
      );

      // The claim committed on `drones` (a separate, non-partitioned row), so the
      // delivery tx rolling back does NOT undo it — and every later release is keyed
      // on a delivery row that will never exist. Without this the airframe is held
      // out of service permanently.
      const release = prisma.drone.updateMany.mock.calls.at(-1)![0];
      expect(release.where).toEqual({ activeDeliveryId: expect.any(String) });
      expect(release.data).toMatchObject({
        activeDeliveryId: null,
        status: 'AVAILABLE',
      });
    });
  });

  describe('dispatch — the fleet is only touched when live dispatch is on', () => {
    it('does not touch the fleet for a SIMULATED delivery', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(prisma.drone.findMany).not.toHaveBeenCalled();
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
      expect(
        prisma.delivery.create.mock.calls[0][0].data.assignedDroneId,
      ).toBeNull();
    });
  });

  describe('aircraft release — the claim lifecycle', () => {
    const seeCancelable = () => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce({
          ...mockDelivery,
          status: DeliveryStatus.PENDING,
        })
        .mockResolvedValue({
          ...mockDelivery,
          status: DeliveryStatus.CANCELED,
        });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    };

    it('releases the aircraft to the fleet on cancel', async () => {
      seeCancelable();

      await service.cancel(userId, 'delivery-1');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'delivery-1' },
        data: { activeDeliveryId: null, status: 'AVAILABLE' },
      });
    });

    it('releases the aircraft on a SUCCESSFUL delivery', async () => {
      // The regression this exists for: every terminal path released except the one
      // that actually happens, so a healthy fleet lost one airframe per completed
      // delivery until dispatch had nothing left to assign.
      const code = '123456';
      const arrived = {
        ...mockDelivery,
        status: DeliveryStatus.AWAITING_HANDOFF,
        handoffCodeHash: crypto.createHash('sha256').update(code).digest('hex'),
        handoffAttempts: 0,
      };
      prisma.delivery.findUnique
        .mockResolvedValueOnce(arrived) // confirm read (opts in the hash)
        .mockResolvedValueOnce({
          ...arrived,
          status: DeliveryStatus.DELIVERED,
        });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.confirmHandoff(userId, 'delivery-1', code);

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'delivery-1' },
        data: { activeDeliveryId: null, status: 'AVAILABLE' },
      });
    });

    it('does NOT release a drone that is still airborne (RETURNING)', async () => {
      // RETURNING is terminal for the delivery's money side but the aircraft is in
      // the air with the parcel. Releasing here hands a flying drone to the next
      // booking.
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.beginReturnToBase('delivery-1', 'WEATHER_ABORT' as any);

      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('releases and GROUNDS the aircraft when the return flight lands', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.completeReturnToBase('delivery-1');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'delivery-1' },
        data: {
          activeDeliveryId: null,
          status: 'MAINTENANCE',
          airworthy: false,
        },
      });
    });

    it('grounds an aircraft implicated in the failure', async () => {
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      // Drone fault — it does not rejoin the pool on the strength of the same
      // telemetry silence that got the delivery reaped.
      await service.failExceptional('delivery-1', 'MECHANICAL' as any);
      expect(prisma.drone.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'MAINTENANCE',
        airworthy: false,
      });
    });

    /**
     * Model the DB, not the call shape: answer whichever conditional CAS the code
     * issues according to the status the delivery is ACTUALLY in. `updateMany`
     * cannot report which row it matched, so the disposition of the aircraft has
     * to be derived from the status the transition fired FROM — and a test that
     * hard-codes a count sequence would pass for the wrong reason.
     */
    const deliveryReallyIn = (
      status: DeliveryStatus,
      id: string = 'delivery-1',
    ) => {
      // Reads have to agree with the CAS. failExceptional now reads the row's exact
      // status inside the transaction (that is what an audit row records), so a helper
      // that only answered updateMany would let a test assert a fired-from status the
      // modelled delivery was never in.
      prisma.delivery.findUnique.mockResolvedValue({ ...mockDelivery, status });
      prisma.delivery.updateMany.mockImplementation((args: any) => {
        const where = args?.where ?? {};
        // Faithful to Postgres: an absent filter constrains NOTHING. A CAS that
        // forgot its id therefore still "matches" here, exactly as it would in the
        // database — which is why the WHERE shape is asserted directly below
        // rather than inferred from a count.
        if (where.id !== undefined && where.id !== id) {
          return Promise.resolve({ count: 0 });
        }
        const gate = where.status;
        const matches =
          gate === undefined
            ? true
            : gate.in
              ? gate.in.includes(status)
              : gate.notIn
                ? !gate.notIn.includes(status)
                : gate === status;
        return Promise.resolve({ count: matches ? 1 : 0 });
      });
    };

    /**
     * The fired-from reads specifically — `select: { status: true }` on one delivery.
     * A bare "findFirst was never called" assertion cannot express this: every failure
     * path ends in announceException, which reads the delivery to localize the comms.
     * That read is not the one being gated, so match on the projection instead.
     *
     * TWO WAYS THIS GOES VACUOUSLY GREEN — check both before trusting it:
     *
     * 1. It watches `findFirst` only. prisma-mock defines `findFirst` as DELEGATING to
     *    `findUnique`, so `findUnique.mock.calls` carries identical args and watching
     *    either one sees a `findFirst` read — but an implementation that read via
     *    `delivery.findUnique` DIRECTLY would leave `findFirst.mock.calls` empty and
     *    this helper would report zero reads for a read that happened.
     * 2. The `{ where: { id }, select: { status: true } }` shape is NOT unique to the
     *    gated read. adminForceCancel and adminFail both issue the identical projection
     *    on their not-applied paths. This helper therefore identifies the gated read
     *    only in tests that do not drive those two methods.
     */
    const statusReadsOf = (id: string) =>
      prisma.delivery.findFirst.mock.calls.filter(
        ([args]: [any]) =>
          args?.where?.id === id && args?.select?.status === true,
      );

    /** Every CAS a terminal path issues must be scoped to ONE delivery. */
    const expectEveryCasScopedToOneDelivery = (id: string) => {
      expect(prisma.delivery.updateMany.mock.calls.length).toBeGreaterThan(0);
      for (const [args] of prisma.delivery.updateMany.mock.calls) {
        // Without this, one admin force-cancel cancels every in-flight delivery
        // in the fleet — and a count-based assertion cannot see it.
        expect(args.where.id).toBe(id);
      }
    };

    it('scopes every force-cancel CAS to the one delivery and the right statuses', async () => {
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

      await service.adminForceCancel('delivery-1');

      expectEveryCasScopedToOneDelivery('delivery-1');
      // The airborne CAS must carry a status gate too: an unguarded second CAS
      // would flip a DELIVERED delivery to CANCELED and refund it.
      const airborne = prisma.delivery.updateMany.mock.calls[1][0];
      expect(airborne.where.status.in).toEqual(FAILABLE_STATUSES);
    });

    it('scopes the airborne failure CAS to the one delivery', async () => {
      deliveryReallyIn(DeliveryStatus.AWAITING_HANDOFF);

      await service.failExceptional('delivery-1', 'MECHANICAL' as any);

      expectEveryCasScopedToOneDelivery('delivery-1');
    });

    it('force-cancel still refuses a settled terminal through BOTH CASes', async () => {
      // The no-resurrect guard now has two predicates to get past, not one.
      deliveryReallyIn(DeliveryStatus.DELIVERED);
      prisma.delivery.findUnique.mockResolvedValue({
        status: DeliveryStatus.DELIVERED,
      });

      await expect(service.adminForceCancel('delivery-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT return an airborne aircraft to the pool on force-cancel', async () => {
      // adminForceCancel is deliberately legal from the in-flight statuses. The
      // delivery ends; the aircraft is still up there with the parcel, and the
      // claim is the only thing keeping the engine from selling it to the next
      // booking. Nulling it here is worse than a leak — it double-books an
      // airframe that is physically mid-mission.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

      await service.adminForceCancel('delivery-1');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'delivery-1' },
        data: {
          activeDeliveryId: null,
          status: 'MAINTENANCE',
          airworthy: false,
        },
      });
    });

    it('returns the aircraft to the fleet when the force-cancel beat the launch', async () => {
      // Nothing has flown, so grounding the fleet on an admin cancel would be a
      // self-inflicted capacity outage.
      deliveryReallyIn(DeliveryStatus.PENDING);

      await service.adminForceCancel('delivery-1');

      expect(prisma.drone.updateMany).toHaveBeenCalledWith({
        where: { activeDeliveryId: 'delivery-1' },
        data: { activeDeliveryId: null, status: 'AVAILABLE' },
      });
    });

    it('keeps an airborne aircraft out of the pool even when it is blameless', async () => {
      // "The airframe is not implicated" and "the airframe is parked" are different
      // questions, and only the second one licenses a release. A no-show at the door
      // leaves a drone hovering over someone's garden holding their parcel.
      deliveryReallyIn(DeliveryStatus.AWAITING_HANDOFF);

      await service.failExceptional(
        'delivery-1',
        'RECIPIENT_UNAVAILABLE' as any,
      );

      expect(prisma.drone.updateMany.mock.calls[0][0].data).not.toMatchObject({
        status: 'AVAILABLE',
      });
    });

    it('still re-pools a blameless aircraft that never left the ground', async () => {
      // The pre-flight abort fires from SCHEDULED, where no airframe is claimed and
      // none has moved. Grounding on this path would punish the fleet for weather.
      deliveryReallyIn(DeliveryStatus.SCHEDULED);

      await service.failExceptional(
        'delivery-1',
        'RECIPIENT_UNAVAILABLE' as any,
        [DeliveryStatus.SCHEDULED],
      );

      expect(prisma.drone.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'AVAILABLE',
      });
    });

    it('runs the audit callback inside the CAS transaction, before any cleanup', async () => {
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

      // Record the transaction boundary, not just the fact of a transaction.
      //
      // "$transaction was called AND audit was called" is satisfied just as well by a
      // transaction containing only the two CASes with the audit write hoisted out
      // after it — which reads as tidier, and would silently destroy the one property
      // this increment exists to create: the CAS commits, the audit write then fails,
      // and a delivery has been failed by an operator with no record of who. The mock
      // aliases `tx` to `prisma`, so no assertion on the callback's arguments can see
      // that either. Only the ordering can.
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.drone.updateMany.mockImplementation(() => {
        order.push('cleanup');
        return Promise.resolve({ count: 1 });
      });
      // .mockImplementation rather than jest.fn(impl): the latter would infer the
      // call tuple from a zero-arg implementation, and the firedFrom assertion below
      // reads calls[0][1].
      const audit = jest.fn().mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.failExceptional(
        'delivery-1',
        'MECHANICAL' as any,
        undefined,
        audit,
      );

      // Co-committed with the transition, not bolted on after it — and the cleanup,
      // which does network I/O, is strictly outside the committed transaction.
      expect(order).toEqual(['begin', 'audit', 'commit', 'cleanup']);
      expect(audit).toHaveBeenCalledTimes(1);
      // And it learns which status the transition fired FROM — the fact that decides
      // whether an aircraft was airborne. The row's ACTUAL status: the allowed set here
      // is the whole in-flight family, so a value derived from the set rather than read
      // from the row would record DRONE_ASSIGNED for this IN_TRANSIT delivery.
      expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.IN_TRANSIT);
    });

    it('does not read the row when nobody is recording the failure', async () => {
      // The watchdog reaps in bulk. An extra indexed read per reap, for a field no
      // automated caller writes down, is a cost with no buyer.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

      await service.failExceptional('delivery-1', 'MECHANICAL' as any);

      expect(statusReadsOf('delivery-1')).toHaveLength(0);
    });

    it('hands the callback the exact status when the caller narrows to one', async () => {
      // firedFrom is read, not derived, so it is exact whatever the allowed set — a
      // singleton set is simply the case where a derived value would have been right
      // by luck.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.failExceptional(
        'delivery-1',
        'MECHANICAL' as any,
        [DeliveryStatus.IN_TRANSIT],
        audit,
      );

      expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.IN_TRANSIT);
    });

    it('does not audit a transition that did not happen', async () => {
      deliveryReallyIn(DeliveryStatus.DELIVERED); // outside FAILABLE_STATUSES
      const audit = jest.fn().mockResolvedValue(undefined);

      const applied = await service.failExceptional(
        'delivery-1',
        'MECHANICAL' as any,
        undefined,
        audit,
      );

      expect(applied).toBe(false);
      expect(audit).not.toHaveBeenCalled();
    });

    it('rolls the failure back when the audit write throws', async () => {
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
      const audit = jest
        .fn()
        .mockRejectedValue(new Error('audit write failed'));

      await expect(
        service.failExceptional(
          'delivery-1',
          'MECHANICAL' as any,
          undefined,
          audit,
        ),
      ).rejects.toThrow('audit write failed');

      // The cleanup must not have run — the transition it cleans up after never committed.
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('is byte-identical for callers that pass no callback', async () => {
      // The watchdog and the pre-flight abort are not operator actions and get no row.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

      const applied = await service.failExceptional(
        'delivery-1',
        'MECHANICAL' as any,
      );

      expect(applied).toBe(true);
      expect(prisma.drone.updateMany).toHaveBeenCalled(); // cleanup still ran
    });

    it('runs the force-cancel audit callback inside the CAS transaction, before any cleanup', async () => {
      // Same property as the failure path, and the same reason for asserting ORDER
      // rather than "both were called": the audit write hoisted out after the
      // transaction reads as tidier and destroys the guarantee. force-cancel adds a
      // second thing to protect — cleanupAfterTermination refunds, releases the
      // airframe and cancels sim jobs, all network I/O that must not be held open
      // inside a transaction.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('begin');
        const r = await fn(prisma);
        order.push('commit');
        return r;
      });
      prisma.drone.updateMany.mockImplementation(() => {
        order.push('cleanup');
        return Promise.resolve({ count: 1 });
      });
      const audit = jest.fn().mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });

      await service.adminForceCancel('delivery-1', audit);

      expect(order).toEqual(['begin', 'audit', 'commit', 'cleanup']);
      // The EXACT status, not a member of the CAS's set: "you cancelled an IN_TRANSIT
      // delivery" is the whole reason to record it, and the in-flight CAS spans four
      // statuses that updateMany cannot tell apart.
      expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.IN_TRANSIT);
    });

    it('hands the force-cancel callback the pre-launch status when it beat the launch', async () => {
      // The other CAS. A firedFrom wired to the in-flight branch alone would record
      // nothing here, or record it as airborne — the disposition is the opposite one.
      deliveryReallyIn(DeliveryStatus.PENDING);
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.adminForceCancel('delivery-1', audit);

      expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.PENDING);
    });

    it('does not audit a force-cancel that both CASes refused', async () => {
      deliveryReallyIn(DeliveryStatus.DELIVERED);
      const audit = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.adminForceCancel('delivery-1', audit),
      ).rejects.toThrow(ConflictException);
      expect(audit).not.toHaveBeenCalled();
    });

    it('rolls the force-cancel back when the audit write throws', async () => {
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
      const audit = jest
        .fn()
        .mockRejectedValue(new Error('audit write failed'));

      await expect(
        service.adminForceCancel('delivery-1', audit),
      ).rejects.toThrow('audit write failed');

      // The cleanup must not have run — the cancel it cleans up after never committed.
      expect(prisma.drone.updateMany).not.toHaveBeenCalled();
    });

    it('does not read the row when nobody is recording the force-cancel', async () => {
      deliveryReallyIn(DeliveryStatus.PENDING);

      await service.adminForceCancel('delivery-1');

      // Deliberately NOT statusReadsOf: that helper cannot tell the gated read from
      // the not-applied 404/409 read, which adminForceCancel issues with the identical
      // projection. This case takes the applied path, where that read never happens,
      // so a local count is exact — and stays exact if the helper's caveat is ever
      // forgotten.
      const gatedReads = prisma.delivery.findFirst.mock.calls.filter(
        ([args]: [any]) =>
          args?.where?.id === 'delivery-1' && args?.select?.status === true,
      );
      expect(gatedReads).toHaveLength(0);
    });

    it('adminFail threads the audit callback into the failure transaction', async () => {
      // adminFail owns nothing itself — it delegates to failExceptional. The callback
      // has to survive that hop or the /fail route records nothing.
      deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.adminFail('delivery-1', 'ADMIN_ABORT' as any, audit);

      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.IN_TRANSIT);
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
    /** Owner read returns `status`; the CAS wins; the post-CAS read returns CANCELED. */
    const arrangeCancel = (status: DeliveryStatus) => {
      prisma.delivery.findUnique
        .mockResolvedValueOnce({ ...mockDelivery, status })
        .mockResolvedValue({
          ...mockDelivery,
          status: DeliveryStatus.CANCELED,
        });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    };

    it('should cancel a PENDING delivery', async () => {
      arrangeCancel(DeliveryStatus.PENDING);

      const result = await service.cancel(userId, 'delivery-1');

      expect(result?.status).toBe(DeliveryStatus.CANCELED);
      expect(simulationService.stopSimulation).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('should cancel a CONFIRMED delivery', async () => {
      arrangeCancel(DeliveryStatus.CONFIRMED);
      const result = await service.cancel(userId, 'delivery-1');
      expect(result?.status).toBe(DeliveryStatus.CANCELED);
    });

    it('should cancel a SCHEDULED delivery (removes the pending kickoff job)', async () => {
      arrangeCancel(DeliveryStatus.SCHEDULED);

      const result = await service.cancel(userId, 'delivery-1');

      expect(result?.status).toBe(DeliveryStatus.CANCELED);
      // stopSimulation removes the :kickoff job (and any stage/pos jobs).
      expect(simulationService.stopSimulation).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('claims the transition with a status-guarded CAS', async () => {
      // The pre-read is advisory — the delivery can be dispatched or delivered while
      // cleanup round-trips are in flight. Only a guarded write can be the winner.
      arrangeCancel(DeliveryStatus.PENDING);

      await service.cancel(userId, 'delivery-1');

      expect(prisma.delivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'delivery-1', status: { in: expect.any(Array) } },
        data: { status: DeliveryStatus.CANCELED },
      });
    });

    it('refunds BOTH legs — credits and the card-charged portion', async () => {
      // cancel() used to return the wallet-credit portion only, so a customer who
      // paid partly by card was silently short-refunded, while every exception path
      // returned both.
      arrangeCancel(DeliveryStatus.PENDING);

      await service.cancel(userId, 'delivery-1');

      expect(promoService.releaseForDelivery).toHaveBeenCalledWith(
        'delivery-1',
      );
      expect(walletService.refundForDelivery).toHaveBeenCalledWith(
        'delivery-1',
      );
      expect(walletService.refundChargeToWallet).toHaveBeenCalledWith(
        'delivery-1',
      );
    });

    it('does NOT clean up or refund when it loses the race', async () => {
      // Someone else moved the delivery between the read and the CAS. The loser must
      // not refund a delivery that has already completed.
      prisma.delivery.findUnique
        .mockResolvedValueOnce({
          ...mockDelivery,
          status: DeliveryStatus.PENDING,
        })
        .mockResolvedValue({
          ...mockDelivery,
          status: DeliveryStatus.DELIVERED,
        });
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(userId, 'delivery-1')).rejects.toMatchObject({
        status: 409,
      });

      expect(walletService.refundForDelivery).not.toHaveBeenCalled();
      expect(walletService.refundChargeToWallet).not.toHaveBeenCalled();
      expect(promoService.releaseForDelivery).not.toHaveBeenCalled();
      expect(simulationService.stopSimulation).not.toHaveBeenCalled();
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

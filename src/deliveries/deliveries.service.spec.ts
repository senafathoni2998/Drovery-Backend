import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import * as crypto from 'crypto';

import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { ProofService } from './proof/proof.service';
import { SimulationService } from './simulation/simulation.service';
import { PromoService } from '../promo/promo.service';
import { WalletService } from '../wallet/wallet.service';
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
  };

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
      stopSimulation: jest.fn(),
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
    };
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
      ],
    }).compile();

    service = module.get<DeliveriesService>(DeliveriesService);
  });

  afterEach(() => jest.clearAllMocks());

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
        18,
      );
    });

    it('should start simulation after creation', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(simulationService.startSimulation).toHaveBeenCalledWith(
        mockDelivery.id,
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
      return { ...createDto, pickupDate: `${yyyy}-${mm}-${dd}`, pickupTime: '12:00' };
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
      expect(prisma.delivery.create.mock.calls[0][0].data.estimatedPrice).toBe(16.2);
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
        18,
      );
    });
  });

  describe('create — wallet credits & referral', () => {
    it('applies wallet credits stacked after promo (debit + reduced charge)', async () => {
      prisma.user.findUnique.mockResolvedValue({ creditBalance: 10 });
      prisma.delivery.create.mockResolvedValue({ ...mockDelivery, estimatedPrice: 8 });

      await service.create(userId, { ...createDto, useCredits: true });

      // 18 (total) - 10 (credits, clamped to balance) = 8 charged + stored.
      expect(prisma.delivery.create.mock.calls[0][0].data.estimatedPrice).toBe(8);
      expect(walletService.debitWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        10,
        expect.objectContaining({ deliveryId: mockDelivery.id }),
      );
      expect(paymentsService.createDeliveryPayment).toHaveBeenCalledWith(mockDelivery.id, 8);
    });

    it('grants the referral reward on the first delivery (pending referral present)', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'ref-1', refereeId: userId });
      prisma.delivery.create.mockResolvedValue(mockDelivery);

      await service.create(userId, createDto);

      expect(walletService.maybeGrantReferralRewardWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        userId,
      );
    });

    it('does not spend credits when useCredits is absent', async () => {
      prisma.delivery.create.mockResolvedValue(mockDelivery);
      await service.create(userId, createDto);
      expect(walletService.debitWithinTx).not.toHaveBeenCalled();
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
      prisma.delivery.findUnique.mockResolvedValue({ ...mockDelivery, userId: 'other' });
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
      ]);
    });

    it('should filter by completed status', async () => {
      prisma.delivery.findMany.mockResolvedValue([]);
      prisma.delivery.count.mockResolvedValue(0);

      await service.findAll(userId, { status: 'completed' } as any);

      const where = prisma.delivery.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(DeliveryStatus.DELIVERED);
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

      const result = await service.findAll(userId, { page: 1, limit: 20 } as any);

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
      prisma.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        userId: 'other-user',
      });

      await expect(service.findByTrackingId(userId, 'AAAAAAAA')).rejects.toThrow(
        NotFoundException,
      );
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
      expect(simulationService.stopSimulation).toHaveBeenCalledWith('delivery-1');
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

      expect(promoService.releaseForDelivery).toHaveBeenCalledWith('delivery-1');
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
      expect(simulationService.stopSimulation).toHaveBeenCalledWith('delivery-1');
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
        .mockResolvedValueOnce({ ...arrived, status: DeliveryStatus.DELIVERED }); // findOne re-fetch
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.confirmHandoff(userId, 'delivery-1', CODE);

      const upd = prisma.delivery.updateMany.mock.calls[0][0];
      expect(upd.where.status).toBe(DeliveryStatus.AWAITING_HANDOFF);
      expect(upd.data.status).toBe(DeliveryStatus.DELIVERED);
      expect(proofService.createAutoProof).toHaveBeenCalledWith('delivery-1', {
        lat: -6.922,
        lng: 107.607,
        recipientName: 'Jane Doe',
      });
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

    it('locks the handoff after 5 failed attempts (423)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        ...arrived,
        handoffAttempts: 5,
      });

      await expect(
        service.confirmHandoff(userId, 'delivery-1', CODE),
      ).rejects.toMatchObject({ status: 423 });
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
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
});

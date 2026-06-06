import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { SimulationService } from './simulation/simulation.service';
import { createMockPrismaService } from '../test/prisma-mock';

jest.mock('uuid', () => ({ v4: () => 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' }));

describe('DeliveriesService', () => {
  let service: DeliveriesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let simulationService: { startSimulation: jest.Mock; stopSimulation: jest.Mock };
  let geoService: { geocode: jest.Mock };
  let pricingService: { estimate: jest.Mock };
  let paymentsService: { createDeliveryPayment: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SimulationService, useValue: simulationService },
        { provide: GeoService, useValue: geoService },
        { provide: PricingService, useValue: pricingService },
        { provide: PaymentsService, useValue: paymentsService },
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
    it('should return delivery by tracking ID', async () => {
      prisma.delivery.findUnique.mockResolvedValue(mockDelivery);

      const result = await service.findByTrackingId('AAAAAAAA');

      expect(result).toEqual(mockDelivery);
    });

    it('should throw NotFoundException if tracking ID not found', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);

      await expect(service.findByTrackingId('INVALID')).rejects.toThrow(
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
});

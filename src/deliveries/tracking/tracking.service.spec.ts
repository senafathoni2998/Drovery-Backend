import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { TrackingService } from './tracking.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('TrackingService', () => {
  let service: TrackingService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  const mockTracking = {
    id: 'tracking-1',
    deliveryId: 'delivery-1',
    droneLat: -6.903,
    droneLng: 107.615,
    droneStatus: 'En route to destination',
    eta: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TrackingService>(TrackingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getTracking', () => {
    it('should return tracking data for a delivery', async () => {
      prisma.deliveryTracking.findUnique.mockResolvedValue(mockTracking);

      const result = await service.getTracking('delivery-1');

      expect(result).toEqual(mockTracking);
      expect(prisma.deliveryTracking.findUnique).toHaveBeenCalledWith({
        where: { deliveryId: 'delivery-1' },
      });
    });

    it('should throw NotFoundException if tracking not found', async () => {
      prisma.deliveryTracking.findUnique.mockResolvedValue(null);

      await expect(service.getTracking('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateTracking', () => {
    it('should upsert tracking data', async () => {
      const updateData = {
        droneLat: -6.91,
        droneLng: 107.61,
        droneStatus: 'In transit',
        eta: new Date(),
      };
      prisma.deliveryTracking.upsert.mockResolvedValue({
        ...mockTracking,
        ...updateData,
      });

      const result = await service.updateTracking('delivery-1', updateData);

      expect(result.droneLat).toBe(updateData.droneLat);
      expect(prisma.deliveryTracking.upsert).toHaveBeenCalledWith({
        where: { deliveryId: 'delivery-1' },
        create: {
          deliveryId: 'delivery-1',
          ...updateData,
        },
        update: updateData,
      });
    });
  });
});

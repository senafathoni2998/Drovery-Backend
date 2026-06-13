import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  let service: FavoritesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: { findOne: jest.Mock; create: jest.Mock };
  const userId = 'u-1';

  const srcDelivery = {
    id: 'd-1',
    fromAddress: 'A',
    toAddress: 'B',
    fromLat: -6.9,
    fromLng: 107.6,
    toLat: -6.92,
    toLng: 107.62,
    receiver: 'R',
    packages: 'Box',
    packageSize: 'Medium',
    packageWeight: 2,
    packageTypes: ['electronics'],
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    deliveries = {
      findOne: jest.fn().mockResolvedValue(srcDelivery),
      create: jest.fn().mockResolvedValue({ id: 'new-d' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoritesService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeliveriesService, useValue: deliveries },
      ],
    }).compile();
    service = module.get(FavoritesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('snapshots an owner-scoped delivery into a favorite', async () => {
      prisma.favorite.create.mockResolvedValue({ id: 'fav-1' });
      await service.create(userId, { label: 'Weekly', deliveryId: 'd-1' });
      expect(deliveries.findOne).toHaveBeenCalledWith(userId, 'd-1');
      expect(prisma.favorite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          label: 'Weekly',
          fromAddress: 'A',
          receiver: 'R',
          packageTypes: ['electronics'],
        }),
      });
    });

    it('propagates NotFound from a non-owned delivery', async () => {
      deliveries.findOne.mockRejectedValue(new NotFoundException());
      await expect(
        service.create(userId, { label: 'x', deliveryId: 'd-x' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.favorite.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFound when not owned', async () => {
      prisma.favorite.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.remove(userId, 'fav-x')).rejects.toThrow(NotFoundException);
    });

    it('deletes an owned favorite', async () => {
      prisma.favorite.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.remove(userId, 'fav-1')).resolves.toBeUndefined();
      expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
        where: { id: 'fav-1', userId },
      });
    });
  });

  describe('order', () => {
    it('places a delivery from an owned favorite (immediate by default)', async () => {
      prisma.favorite.findFirst.mockResolvedValue({
        ...srcDelivery,
        id: 'fav-1',
      });
      await service.order(userId, 'fav-1');
      expect(deliveries.create).toHaveBeenCalledTimes(1);
      const [uid, dto] = deliveries.create.mock.calls[0];
      expect(uid).toBe(userId);
      expect(dto).toMatchObject({ fromAddress: 'A', receiver: 'R' });
      expect(dto.pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dto.pickupTime).toMatch(/^\d{2}:\d{2}$/);
    });

    it('honors a pickup override (schedule the reorder)', async () => {
      prisma.favorite.findFirst.mockResolvedValue({ ...srcDelivery, id: 'fav-1' });
      await service.order(userId, 'fav-1', {
        pickupDate: '2026-12-25',
        pickupTime: '09:00',
      });
      const dto = deliveries.create.mock.calls[0][1];
      expect(dto.pickupDate).toBe('2026-12-25');
      expect(dto.pickupTime).toBe('09:00');
    });

    it('throws NotFound for a non-owned/missing favorite', async () => {
      prisma.favorite.findFirst.mockResolvedValue(null);
      await expect(service.order(userId, 'fav-x')).rejects.toThrow(NotFoundException);
      expect(deliveries.create).not.toHaveBeenCalled();
    });
  });
});

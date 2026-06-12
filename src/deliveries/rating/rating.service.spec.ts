import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import { RatingService } from './rating.service';
import { createMockPrismaService } from '../../test/prisma-mock';

describe('RatingService', () => {
  let service: RatingService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'u1';

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new RatingService(prisma as any);
  });

  describe('rate', () => {
    it('upserts a rating for a DELIVERED delivery the user owns', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'd1',
        userId,
        status: DeliveryStatus.DELIVERED,
      });
      prisma.deliveryRating.upsert.mockResolvedValue({ id: 'r1', stars: 5 });

      await service.rate(userId, 'd1', { stars: 5, comment: 'Great' });

      expect(prisma.deliveryRating.upsert).toHaveBeenCalledWith({
        where: { deliveryId: 'd1' },
        create: { deliveryId: 'd1', userId, stars: 5, comment: 'Great' },
        update: { stars: 5, comment: 'Great' },
      });
    });

    it('rejects rating a delivery that is not yet DELIVERED (409)', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'd1',
        userId,
        status: DeliveryStatus.IN_TRANSIT,
      });

      await expect(
        service.rate(userId, 'd1', { stars: 4 }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.deliveryRating.upsert).not.toHaveBeenCalled();
    });

    it("rejects rating another user's delivery (404, no leak)", async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        id: 'd1',
        userId: 'someone-else',
        status: DeliveryStatus.DELIVERED,
      });

      await expect(
        service.rate(userId, 'd1', { stars: 4 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a missing delivery (404)', async () => {
      prisma.delivery.findUnique.mockResolvedValue(null);
      await expect(
        service.rate(userId, 'nope', { stars: 4 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRating', () => {
    it('returns the rating for an owned delivery', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ id: 'd1', userId });
      prisma.deliveryRating.findUnique.mockResolvedValue({ id: 'r1', stars: 4 });

      expect(await service.getRating(userId, 'd1')).toMatchObject({ stars: 4 });
    });

    it('throws 404 when the delivery has no rating yet', async () => {
      prisma.delivery.findUnique.mockResolvedValue({ id: 'd1', userId });
      prisma.deliveryRating.findUnique.mockResolvedValue(null);
      await expect(service.getRating(userId, 'd1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  const userId = 'user-1';

  const mockNotification = {
    id: 'notif-1',
    userId,
    title: 'Delivery Confirmed',
    body: 'Your delivery has been confirmed.',
    data: null,
    read: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('should return notifications for user', async () => {
      prisma.notification.findMany.mockResolvedValue([mockNotification]);

      const result = await service.findAll(userId);

      expect(result).toEqual([mockNotification]);
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue(mockNotification);
      prisma.notification.update.mockResolvedValue({
        ...mockNotification,
        read: true,
      });

      const result = await service.markAsRead(userId, 'notif-1');

      expect(result.read).toBe(true);
    });

    it('should throw NotFoundException if notification not found', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(
        service.markAsRead(userId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if notification belongs to another user', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        ...mockNotification,
        userId: 'other-user',
      });

      await expect(
        service.markAsRead(userId, 'notif-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead(userId);

      expect(result).toEqual({ updated: 5 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        data: { read: true },
      });
    });
  });

  describe('registerDevice', () => {
    it('should upsert device registration', async () => {
      const dto = { pushToken: 'expo-token-123', platform: 'ios' };
      prisma.device.upsert.mockResolvedValue({
        id: 'device-1',
        userId,
        ...dto,
      });

      const result = await service.registerDevice(userId, dto);

      expect(result.pushToken).toBe(dto.pushToken);
      expect(prisma.device.upsert).toHaveBeenCalledWith({
        where: {
          userId_pushToken: { userId, pushToken: dto.pushToken },
        },
        update: { platform: dto.platform },
        create: { userId, pushToken: dto.pushToken, platform: dto.platform },
      });
    });
  });

  describe('create', () => {
    it('should create a notification', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);

      const result = await service.create(
        userId,
        'Delivery Confirmed',
        'Your delivery has been confirmed.',
        { deliveryId: 'd-1' },
      );

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId,
          title: 'Delivery Confirmed',
          body: 'Your delivery has been confirmed.',
          data: { deliveryId: 'd-1' },
        },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(userId);

      expect(result).toEqual({ count: 3 });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, read: false },
      });
    });
  });
});

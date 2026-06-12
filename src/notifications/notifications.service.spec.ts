import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

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
        { provide: ConfigService, useValue: { get: jest.fn() } },
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

    it('should push to registered Expo devices and ignore non-Expo tokens', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);
      prisma.device.findMany.mockResolvedValue([
        { pushToken: 'ExponentPushToken[abc]', platform: 'ios' },
        { pushToken: 'fcm-raw-token', platform: 'android' },
      ]);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      (global as any).fetch = fetchMock;

      await service.create(userId, 'Title', 'Body', { deliveryId: 'd-1' });
      // let the fire-and-forget push microtask run
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('exp.host');
      const sent = JSON.parse(opts.body);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('ExponentPushToken[abc]');
      expect(sent[0].title).toBe('Title');
    });

    it('should not call the push service when no devices are registered', async () => {
      prisma.notification.create.mockResolvedValue(mockNotification);
      prisma.device.findMany.mockResolvedValue([]);
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await service.create(userId, 'Title', 'Body');
      await new Promise((resolve) => setImmediate(resolve));

      expect(fetchMock).not.toHaveBeenCalled();
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

  describe('preferences', () => {
    it('returns defaults when the user has not customized them', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      const prefs = await service.getPreferences(userId);
      expect(prefs).toMatchObject({
        userId,
        pushEnabled: true,
        deliveryUpdates: true,
        promotions: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      });
    });

    it('returns the persisted preferences when present', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        userId,
        pushEnabled: false,
      });
      expect(await service.getPreferences(userId)).toMatchObject({
        pushEnabled: false,
      });
    });

    it('updatePreferences upserts', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({});
      await service.updatePreferences(userId, { deliveryUpdates: false });
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId, deliveryUpdates: false },
        update: { deliveryUpdates: false },
      });
    });
  });

  describe('push gating', () => {
    const gate = (cat: 'delivery' | 'promotion' | 'system') =>
      (service as any).shouldSendPush(userId, cat) as Promise<boolean>;
    const setPrefs = (p: Record<string, unknown>) =>
      prisma.notificationPreference.findUnique.mockResolvedValue({ userId, ...p });

    it('sends when push is enabled and the category is on (no quiet hours)', async () => {
      setPrefs({ pushEnabled: true, deliveryUpdates: true, quietHoursStart: null, quietHoursEnd: null });
      expect(await gate('delivery')).toBe(true);
    });

    it('suppresses when push is globally disabled', async () => {
      setPrefs({ pushEnabled: false, deliveryUpdates: true });
      expect(await gate('delivery')).toBe(false);
    });

    it('suppresses a delivery push when deliveryUpdates is off', async () => {
      setPrefs({ pushEnabled: true, deliveryUpdates: false, quietHoursStart: null, quietHoursEnd: null });
      expect(await gate('delivery')).toBe(false);
    });

    it('suppresses a promotion when promotions is off', async () => {
      setPrefs({ pushEnabled: true, promotions: false, quietHoursStart: null, quietHoursEnd: null });
      expect(await gate('promotion')).toBe(false);
    });

    it('inQuietHours handles wrap-around windows', () => {
      const inQuiet = (s: number | null, e: number | null, h: number) =>
        (service as any).inQuietHours(s, e, h) as boolean;
      expect(inQuiet(22, 7, 23)).toBe(true); // overnight window, late
      expect(inQuiet(22, 7, 3)).toBe(true); // overnight window, early morning
      expect(inQuiet(22, 7, 9)).toBe(false); // daytime
      expect(inQuiet(9, 17, 12)).toBe(true); // same-day window
      expect(inQuiet(9, 17, 18)).toBe(false);
      expect(inQuiet(null, null, 3)).toBe(false); // disabled
    });
  });
});

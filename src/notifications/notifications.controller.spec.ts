import { Test, TestingModule } from '@nestjs/testing';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: {
    findAll: jest.Mock;
    getUnreadCount: jest.Mock;
    markAsRead: jest.Mock;
    markAllAsRead: jest.Mock;
    registerDevice: jest.Mock;
  };

  const userId = 'user-1';
  const mockNotif = { id: 'notif-1', userId, title: 'Test', read: false };

  beforeEach(async () => {
    notificationsService = {
      findAll: jest.fn().mockResolvedValue([mockNotif]),
      getUnreadCount: jest.fn().mockResolvedValue({ count: 3 }),
      markAsRead: jest.fn().mockResolvedValue({ ...mockNotif, read: true }),
      markAllAsRead: jest.fn().mockResolvedValue({ updated: 5 }),
      registerDevice: jest.fn().mockResolvedValue({ id: 'device-1', userId }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  describe('findAll', () => {
    it('should delegate to notificationsService.findAll', async () => {
      const result = await controller.findAll(userId);

      expect(notificationsService.findAll).toHaveBeenCalledWith(userId);
      expect(result).toEqual([mockNotif]);
    });
  });

  describe('getUnreadCount', () => {
    it('should delegate to notificationsService.getUnreadCount', async () => {
      const result = await controller.getUnreadCount(userId);

      expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('markAsRead', () => {
    it('should delegate to notificationsService.markAsRead', async () => {
      const result = await controller.markAsRead(userId, 'notif-1');

      expect(notificationsService.markAsRead).toHaveBeenCalledWith(
        userId,
        'notif-1',
      );
      expect(result.read).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('should delegate to notificationsService.markAllAsRead', async () => {
      const result = await controller.markAllAsRead(userId);

      expect(notificationsService.markAllAsRead).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ updated: 5 });
    });
  });

  describe('registerDevice', () => {
    it('should delegate to notificationsService.registerDevice', async () => {
      const dto = { pushToken: 'token-123', platform: 'ios' };

      const result = await controller.registerDevice(userId, dto);

      expect(notificationsService.registerDevice).toHaveBeenCalledWith(
        userId,
        dto,
      );
      expect(result.id).toBe('device-1');
    });
  });
});

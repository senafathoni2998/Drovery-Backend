import { Test, TestingModule } from '@nestjs/testing';

import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

describe('DeliveriesController', () => {
  let controller: DeliveriesController;
  let deliveriesService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    findByTrackingId: jest.Mock;
    getActive: jest.Mock;
    getRecent: jest.Mock;
    cancel: jest.Mock;
    confirmHandoff: jest.Mock;
  };

  const userId = 'user-1';
  const mockDelivery = { id: 'delivery-1', trackingId: 'ABC123', userId };

  beforeEach(async () => {
    deliveriesService = {
      create: jest.fn().mockResolvedValue(mockDelivery),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      findOne: jest.fn().mockResolvedValue(mockDelivery),
      findByTrackingId: jest.fn().mockResolvedValue(mockDelivery),
      getActive: jest.fn().mockResolvedValue([mockDelivery]),
      getRecent: jest.fn().mockResolvedValue([]),
      cancel: jest.fn().mockResolvedValue({ ...mockDelivery, status: 'CANCELED' }),
      confirmHandoff: jest
        .fn()
        .mockResolvedValue({ ...mockDelivery, status: 'DELIVERED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveriesController],
      providers: [{ provide: DeliveriesService, useValue: deliveriesService }],
    }).compile();

    controller = module.get<DeliveriesController>(DeliveriesController);
  });

  describe('create', () => {
    it('should delegate to deliveriesService.create', async () => {
      const dto = { fromAddress: 'A', toAddress: 'B' } as any;

      const result = await controller.create(userId, dto);

      expect(deliveriesService.create).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(mockDelivery);
    });
  });

  describe('findAll', () => {
    it('should delegate to deliveriesService.findAll', async () => {
      const query = { status: 'current' } as any;

      const result = await controller.findAll(userId, query);

      expect(deliveriesService.findAll).toHaveBeenCalledWith(userId, query);
      expect(result.items).toEqual([]);
    });
  });

  describe('getActive', () => {
    it('should delegate to deliveriesService.getActive', async () => {
      const result = await controller.getActive(userId);

      expect(deliveriesService.getActive).toHaveBeenCalledWith(userId);
      expect(result).toEqual([mockDelivery]);
    });
  });

  describe('getRecent', () => {
    it('should delegate to deliveriesService.getRecent', async () => {
      const result = await controller.getRecent(userId);

      expect(deliveriesService.getRecent).toHaveBeenCalledWith(userId);
      expect(result).toEqual([]);
    });
  });

  describe('findByTrackingId', () => {
    it('should delegate to deliveriesService.findByTrackingId with the user id', async () => {
      const result = await controller.findByTrackingId(userId, 'ABC123');

      expect(deliveriesService.findByTrackingId).toHaveBeenCalledWith(
        userId,
        'ABC123',
      );
      expect(result).toEqual(mockDelivery);
    });
  });

  describe('findOne', () => {
    it('should delegate to deliveriesService.findOne', async () => {
      const result = await controller.findOne(userId, 'delivery-1');

      expect(deliveriesService.findOne).toHaveBeenCalledWith(userId, 'delivery-1');
      expect(result).toEqual(mockDelivery);
    });
  });

  describe('cancel', () => {
    it('should delegate to deliveriesService.cancel', async () => {
      const result = await controller.cancel(userId, 'delivery-1');

      expect(deliveriesService.cancel).toHaveBeenCalledWith(userId, 'delivery-1');
      expect(result.status).toBe('CANCELED');
    });
  });

  describe('confirmHandoff', () => {
    it('should delegate to deliveriesService.confirmHandoff with the code', async () => {
      const result = await controller.confirmHandoff(userId, 'delivery-1', {
        code: '123456',
      });

      expect(deliveriesService.confirmHandoff).toHaveBeenCalledWith(
        userId,
        'delivery-1',
        '123456',
      );
      expect(result.status).toBe('DELIVERED');
    });
  });
});

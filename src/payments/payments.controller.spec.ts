import { Test, TestingModule } from '@nestjs/testing';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    findAll: jest.Mock;
    addPaymentMethod: jest.Mock;
    remove: jest.Mock;
    setDefault: jest.Mock;
    createSetupSession: jest.Mock;
    syncCards: jest.Mock;
  };

  const userId = 'user-1';
  const mockPm = { id: 'pm-1', userId, network: 'Visa', last4: '4242' };

  beforeEach(async () => {
    paymentsService = {
      findAll: jest.fn().mockResolvedValue([mockPm]),
      addPaymentMethod: jest.fn().mockResolvedValue(mockPm),
      remove: jest.fn().mockResolvedValue({ success: true }),
      setDefault: jest.fn().mockResolvedValue({ ...mockPm, isDefault: true }),
      createSetupSession: jest
        .fn()
        .mockResolvedValue({ setupIntentClientSecret: 'seti', mock: true }),
      syncCards: jest.fn().mockResolvedValue([mockPm]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: paymentsService }],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  describe('setup-intent & sync', () => {
    it('createSetupIntent delegates to paymentsService.createSetupSession', async () => {
      const result = await controller.createSetupIntent(userId);
      expect(paymentsService.createSetupSession).toHaveBeenCalledWith(userId);
      expect(result).toMatchObject({ mock: true });
    });

    it('sync delegates to paymentsService.syncCards', async () => {
      const result = await controller.sync(userId);
      expect(paymentsService.syncCards).toHaveBeenCalledWith(userId);
      expect(result).toEqual([mockPm]);
    });
  });

  describe('findAll', () => {
    it('should delegate to paymentsService.findAll', async () => {
      const result = await controller.findAll(userId);

      expect(paymentsService.findAll).toHaveBeenCalledWith(userId);
      expect(result).toEqual([mockPm]);
    });
  });

  describe('addPaymentMethod', () => {
    it('should delegate to paymentsService.addPaymentMethod', async () => {
      const dto = { network: 'Visa', last4: '4242', holderName: 'John', expiry: '12/28' };

      const result = await controller.addPaymentMethod(userId, dto);

      expect(paymentsService.addPaymentMethod).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(mockPm);
    });
  });

  describe('remove', () => {
    it('should delegate to paymentsService.remove', async () => {
      const result = await controller.remove(userId, 'pm-1');

      expect(paymentsService.remove).toHaveBeenCalledWith(userId, 'pm-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('setDefault', () => {
    it('should delegate to paymentsService.setDefault', async () => {
      const result = await controller.setDefault(userId, 'pm-1');

      expect(paymentsService.setDefault).toHaveBeenCalledWith(userId, 'pm-1');
      expect(result.isDefault).toBe(true);
    });
  });
});

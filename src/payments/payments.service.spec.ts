import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  const userId = 'user-1';

  const mockPaymentMethod = {
    id: 'pm-1',
    userId,
    stripePaymentMethodId: 'manual_123',
    network: 'Visa',
    last4: '4242',
    holderName: 'John Doe',
    expiry: '12/28',
    isDefault: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('should return all payment methods for user', async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([mockPaymentMethod]);

      const result = await service.findAll(userId);

      expect(result).toEqual([mockPaymentMethod]);
      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('addPaymentMethod', () => {
    const dto = {
      network: 'Visa',
      last4: '4242',
      holderName: 'John Doe',
      expiry: '12/28',
    };

    it('should set isDefault to true for first payment method', async () => {
      prisma.paymentMethod.count.mockResolvedValue(0);
      prisma.paymentMethod.create.mockResolvedValue({
        ...mockPaymentMethod,
        isDefault: true,
      });

      await service.addPaymentMethod(userId, dto);

      const createCall = prisma.paymentMethod.create.mock.calls[0][0];
      expect(createCall.data.isDefault).toBe(true);
    });

    it('should set isDefault to false for subsequent payment methods', async () => {
      prisma.paymentMethod.count.mockResolvedValue(2);
      prisma.paymentMethod.create.mockResolvedValue({
        ...mockPaymentMethod,
        isDefault: false,
      });

      await service.addPaymentMethod(userId, dto);

      const createCall = prisma.paymentMethod.create.mock.calls[0][0];
      expect(createCall.data.isDefault).toBe(false);
    });
  });

  describe('remove', () => {
    it('should delete the payment method', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue({
        ...mockPaymentMethod,
        isDefault: false,
      });
      prisma.paymentMethod.delete.mockResolvedValue(mockPaymentMethod);

      const result = await service.remove(userId, 'pm-1');

      expect(result).toEqual({ success: true });
      expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({
        where: { id: 'pm-1' },
      });
    });

    it('should promote most recent card when default is removed', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue({
        ...mockPaymentMethod,
        isDefault: true,
      });
      prisma.paymentMethod.delete.mockResolvedValue(mockPaymentMethod);
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-2',
        userId,
      });
      prisma.paymentMethod.update.mockResolvedValue({});

      await service.remove(userId, 'pm-1');

      expect(prisma.paymentMethod.findFirst).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-2' },
        data: { isDefault: true },
      });
    });

    it('should throw NotFoundException if payment method not found', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue(null);

      await expect(service.remove(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if payment method belongs to another user', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue({
        ...mockPaymentMethod,
        userId: 'other-user',
      });

      await expect(service.remove(userId, 'pm-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('setDefault', () => {
    it('should unset all defaults and set the chosen one', async () => {
      prisma.paymentMethod.findUnique
        .mockResolvedValueOnce(mockPaymentMethod) // initial check
        .mockResolvedValueOnce({ ...mockPaymentMethod, isDefault: true }); // final return
      prisma.paymentMethod.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentMethod.update.mockResolvedValue({});

      const result = await service.setDefault(userId, 'pm-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException if payment method not found', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue(null);

      await expect(service.setDefault(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if payment method belongs to another user', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue({
        ...mockPaymentMethod,
        userId: 'other-user',
      });

      await expect(service.setDefault(userId, 'pm-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

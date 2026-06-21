import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { createMockPrismaService } from '../test/prisma-mock';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let stripe: {
    createPaymentIntent: jest.Mock;
    createCustomer: jest.Mock;
    createSetupSession: jest.Mock;
    listCards: jest.Mock;
    isMock: boolean;
    publishableKey: string | null;
  };

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
    stripe = {
      isMock: true,
      publishableKey: null,
      createPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_mock_d1',
        clientSecret: 'pi_mock_d1_secret_mock',
        status: 'succeeded',
        amount: 1800,
        currency: 'usd',
      }),
      createCustomer: jest.fn().mockResolvedValue('cus_mock_user-1'),
      createSetupSession: jest.fn().mockResolvedValue({
        setupIntentClientSecret: 'seti_mock_secret',
        ephemeralKeySecret: 'ek_mock',
        customerId: 'cus_mock_user-1',
      }),
      listCards: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StripeService, useValue: stripe },
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

  describe('createDeliveryPayment', () => {
    it('creates a PaymentIntent and a Payment row for the delivery', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
      });

      const result = await service.createDeliveryPayment(
        'd-1',
        new Date('2026-06-01T00:00:00.000Z'),
        18,
      );

      expect(stripe.createPaymentIntent).toHaveBeenCalledWith({
        amount: 1800, // dollars → cents
        currency: 'usd',
        metadata: { deliveryId: 'd-1' },
      });
      const createArg = prisma.payment.create.mock.calls[0][0];
      expect(createArg.data).toEqual(
        expect.objectContaining({
          deliveryId: 'd-1',
          stripePaymentIntentId: 'pi_mock_d1',
          amount: 18,
          currency: 'usd',
          status: 'COMPLETED', // mapped from 'succeeded'
        }),
      );
      expect(result).toEqual({ id: 'pay-1', status: 'COMPLETED' });
    });

    it('is idempotent — returns the existing payment without re-charging', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'pay-existing' });

      const result = await service.createDeliveryPayment(
        'd-1',
        new Date('2026-06-01T00:00:00.000Z'),
        18,
      );

      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'pay-existing' });
    });
  });

  describe('handleWebhookEvent', () => {
    it('marks the payment COMPLETED on payment_intent.succeeded', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.handleWebhookEvent({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_123' } },
      });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: { status: 'COMPLETED' },
      });
      expect(result).toEqual({ received: true });
    });

    it('marks the payment FAILED on payment_intent.payment_failed', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.handleWebhookEvent({
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_123' } },
      });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: { status: 'FAILED' },
      });
    });

    it('ignores unrelated event types', async () => {
      const result = await service.handleWebhookEvent({
        type: 'charge.refunded',
        data: { object: { id: 'pi_123' } },
      });

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ received: true });
    });
  });

  describe('createSetupSession', () => {
    it('creates a Stripe customer on first use and returns a setup session', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        name: 'A',
        stripeCustomerId: null,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.createSetupSession('user-1');

      expect(stripe.createCustomer).toHaveBeenCalledWith({
        email: 'a@b.com',
        name: 'A',
        metadata: { userId: 'user-1' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { stripeCustomerId: 'cus_mock_user-1' },
      });
      expect(stripe.createSetupSession).toHaveBeenCalledWith('cus_mock_user-1');
      expect(result).toMatchObject({
        setupIntentClientSecret: 'seti_mock_secret',
        mock: true,
      });
    });

    it('reuses an existing Stripe customer', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        name: 'A',
        stripeCustomerId: 'cus_existing',
      });

      await service.createSetupSession('user-1');

      expect(stripe.createCustomer).not.toHaveBeenCalled();
      expect(stripe.createSetupSession).toHaveBeenCalledWith('cus_existing');
    });
  });

  describe('syncCards', () => {
    it('creates local rows for new Stripe cards', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'A',
        stripeCustomerId: 'cus_1',
      });
      stripe.listCards.mockResolvedValue([
        {
          id: 'pm_1',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        },
      ]);
      prisma.paymentMethod.findFirst.mockResolvedValue(null);
      prisma.paymentMethod.count.mockResolvedValue(0);
      prisma.paymentMethod.create.mockResolvedValue({});
      prisma.paymentMethod.findMany.mockResolvedValue([{ id: 'pm-local' }]);

      const result = await service.syncCards('user-1');

      const arg = prisma.paymentMethod.create.mock.calls[0][0];
      expect(arg.data).toMatchObject({
        userId: 'user-1',
        stripePaymentMethodId: 'pm_1',
        last4: '4242',
        expiry: '12/2030',
        isDefault: true,
      });
      expect(result).toEqual([{ id: 'pm-local' }]);
    });

    it('returns existing cards when the user has no Stripe customer', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        stripeCustomerId: null,
      });
      prisma.paymentMethod.findMany.mockResolvedValue([mockPaymentMethod]);

      const result = await service.syncCards('user-1');

      expect(stripe.listCards).not.toHaveBeenCalled();
      expect(result).toEqual([mockPaymentMethod]);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { DroneCommandService } from '../deliveries/commands/drone-command.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupportChatPublisher } from '../support/chat/support-chat.publisher';
import { WalletService } from '../wallet/wallet.service';
import { createMockPrismaService } from '../test/prisma-mock';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let deliveries: { adminForceCancel: jest.Mock; adminFail: jest.Mock };
  let wallet: { creditWithinTx: jest.Mock };
  let publisher: { publishMessage: jest.Mock };
  let droneCommands: { issue: jest.Mock; listForDelivery: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    deliveries = {
      adminForceCancel: jest.fn().mockResolvedValue({ id: 'd-1' }),
      adminFail: jest.fn().mockResolvedValue({ id: 'd-1' }),
    };
    wallet = { creditWithinTx: jest.fn().mockResolvedValue(undefined) };
    publisher = { publishMessage: jest.fn().mockResolvedValue(undefined) };
    droneCommands = {
      issue: jest.fn().mockResolvedValue({ id: 'c-1' }),
      listForDelivery: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeliveriesService, useValue: deliveries },
        { provide: WalletService, useValue: wallet },
        { provide: SupportChatPublisher, useValue: publisher },
        { provide: DroneCommandService, useValue: droneCommands },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('support inbox', () => {
    it('lists ALL tickets (cross-user, no userId filter)', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([]);
      prisma.supportTicket.count.mockResolvedValue(0);
      await service.listTickets({
        status: 'OPEN',
        skip: 0,
        limit: 20,
        page: 1,
      } as any);
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where).toEqual({
        status: 'OPEN',
      });
    });

    it('replies as AGENT (attributed), advances OPEN→IN_PROGRESS, and publishes live', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
      const msg = {
        id: 'm-1',
        ticketId: 't-1',
        senderRole: 'AGENT',
        senderUserId: 'agent-1',
        content: 'hi',
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
      };
      prisma.supportChatMessage.create.mockResolvedValue(msg);
      prisma.supportTicket.update.mockResolvedValue({});

      await service.replyAsAgent('agent-1', 't-1', 'hi');

      expect(prisma.supportChatMessage.create).toHaveBeenCalledWith({
        data: {
          ticketId: 't-1',
          senderRole: 'AGENT',
          senderUserId: 'agent-1',
          content: 'hi',
        },
      });
      expect(prisma.supportTicket.update.mock.calls[0][0].data.status).toBe(
        'IN_PROGRESS',
      );
      expect(publisher.publishMessage).toHaveBeenCalled();
    });

    it('rejects replying to a CLOSED ticket', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue({ status: 'CLOSED' });
      await expect(service.replyAsAgent('a', 't-1', 'hi')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deliveries', () => {
    it('fail delegates to DeliveriesService.adminFail with the given reason', async () => {
      await service.fail('d-1', 'WEATHER_ABORT' as any);
      expect(deliveries.adminFail).toHaveBeenCalledWith('d-1', 'WEATHER_ABORT');
    });

    it('fail defaults the reason to ADMIN_ABORT when omitted', async () => {
      await service.fail('d-1');
      expect(deliveries.adminFail).toHaveBeenCalledWith('d-1', 'ADMIN_ABORT');
    });

    it('force-cancel delegates to DeliveriesService.adminForceCancel', async () => {
      await service.forceCancel('d-1');
      expect(deliveries.adminForceCancel).toHaveBeenCalledWith('d-1');
    });

    it('issueDroneCommand delegates to DroneCommandService.issue with the admin id', async () => {
      const dto = { type: 'RETURN_TO_BASE' as any };
      await service.issueDroneCommand('admin-1', 'd-1', dto);
      expect(droneCommands.issue).toHaveBeenCalledWith('admin-1', 'd-1', dto);
    });

    it('listDroneCommands delegates to DroneCommandService.listForDelivery', async () => {
      await service.listDroneCommands('d-1');
      expect(droneCommands.listForDelivery).toHaveBeenCalledWith('d-1');
    });

    it('refunds as a wallet credit + marks the payment REFUNDED', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      await service.refund('d-1');
      expect(wallet.creditWithinTx).toHaveBeenCalledWith(
        expect.anything(),
        'u-1',
        18,
        'CHECKOUT_REFUND',
        expect.objectContaining({ idempotencyKey: 'admin-refund:d-1' }),
      );
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { deliveryId: 'd-1' },
        data: { status: 'REFUNDED' },
      });
    });

    it('rejects a refund larger than the charged total', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      await expect(service.refund('d-1', 50)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('maps a duplicate refund (P2002) to 409', async () => {
      prisma.delivery.findUnique.mockResolvedValue({
        userId: 'u-1',
        estimatedPrice: 18,
      });
      wallet.creditWithinTx.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(service.refund('d-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('promo CRUD', () => {
    it('creates a promo (uppercased code)', async () => {
      prisma.promoCode.create.mockResolvedValue({ id: 'p-1' });
      await service.createPromo({
        code: 'save10',
        discountType: 'PERCENT',
        discountValue: 10,
      } as any);
      expect(prisma.promoCode.create.mock.calls[0][0].data.code).toBe('SAVE10');
    });

    it('rejects a PERCENT discount over 100', async () => {
      await expect(
        service.createPromo({
          code: 'X',
          discountType: 'PERCENT',
          discountValue: 150,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a duplicate code (P2002) to 409', async () => {
      prisma.promoCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.createPromo({
          code: 'DUP',
          discountType: 'FIXED',
          discountValue: 5,
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects updating a PERCENT promo above 100%', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
      });
      await expect(
        service.updatePromo('p-1', { discountValue: 150 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.promoCode.updateMany).not.toHaveBeenCalled();
    });

    it('applies a valid discountValue update', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({
        id: 'p-1',
        discountType: 'PERCENT',
      });
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      await service.updatePromo('p-1', { discountValue: 50 } as any);
      expect(
        prisma.promoCode.updateMany.mock.calls[0][0].data.discountValue,
      ).toBe(50);
    });
  });

  describe('overview', () => {
    it('shapes the dashboard, backfilling every delivery status to 0', async () => {
      prisma.user.count.mockResolvedValue(7);
      prisma.delivery.groupBy.mockResolvedValue([
        { status: 'DELIVERED', _count: { _all: 3 } },
        { status: 'PENDING', _count: { _all: 2 } },
      ]);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 123.4 } });
      prisma.supportTicket.count.mockResolvedValue(1);
      prisma.recurringDelivery.count.mockResolvedValue(4);

      const result = await service.getOverview();
      expect(result.users).toBe(7);
      expect(result.deliveriesByStatus.DELIVERED).toBe(3);
      expect(result.deliveriesByStatus.CANCELED).toBe(0); // backfilled
      expect(result.revenue).toBe(123.4);
      expect(result.openTickets).toBe(1);
      expect(result.activeRecurringSchedules).toBe(4);
    });
  });

  describe('setRole', () => {
    it('promotes a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
      prisma.user.update.mockResolvedValue({
        id: 'u-2',
        email: 'x',
        role: 'AGENT',
      });
      await service.setRole('admin-1', 'u-2', 'AGENT' as any);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('refuses to demote the last admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
      prisma.user.count.mockResolvedValue(1);
      await expect(
        service.setRole('admin-1', 'u-2', 'USER' as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

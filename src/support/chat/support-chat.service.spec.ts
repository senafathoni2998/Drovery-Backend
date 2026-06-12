import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/prisma-mock';
import { SupportChatService } from './support-chat.service';

describe('SupportChatService', () => {
  let service: SupportChatService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const userId = 'user-1';
  const ticketId = 'ticket-1';

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportChatService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SupportChatService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('assertOwnedTicket', () => {
    it('returns the ticket when the user owns it', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue({ id: ticketId, userId });
      await expect(service.assertOwnedTicket(userId, ticketId)).resolves.toMatchObject({
        id: ticketId,
      });
      expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith({
        where: { id: ticketId, userId },
      });
    });

    it('throws NotFound when the ticket is absent or owned by another user', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(service.assertOwnedTicket(userId, ticketId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMessages', () => {
    it('returns ordered, paginated history with a hasMore flag', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue({ id: ticketId, userId });
      const rows = [{ id: 'm-1' }, { id: 'm-2' }];
      prisma.supportChatMessage.findMany.mockResolvedValue(rows);
      prisma.supportChatMessage.count.mockResolvedValue(5);

      const result = await service.getMessages(userId, ticketId, 2, 0);

      expect(prisma.supportChatMessage.findMany).toHaveBeenCalledWith({
        where: { ticketId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2,
        skip: 0,
      });
      expect(result).toEqual({ messages: rows, total: 5, hasMore: true });
    });

    it('reports hasMore=false on the last page', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue({ id: ticketId, userId });
      prisma.supportChatMessage.findMany.mockResolvedValue([{ id: 'm-5' }]);
      prisma.supportChatMessage.count.mockResolvedValue(5);
      const result = await service.getMessages(userId, ticketId, 2, 4);
      expect(result.hasMore).toBe(false);
    });

    it('refuses history for a non-owned ticket', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(service.getMessages(userId, ticketId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.supportChatMessage.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createUserMessage', () => {
    it('persists a USER message and bumps lastMessageAt', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue({
        id: ticketId,
        userId,
        status: 'OPEN',
      });
      const created = { id: 'm-1', ticketId, senderRole: 'USER', content: 'hi' };
      prisma.supportChatMessage.create.mockResolvedValue(created);
      prisma.supportTicket.update.mockResolvedValue({});

      const result = await service.createUserMessage(userId, ticketId, 'hi');

      expect(result).toEqual(created);
      expect(prisma.supportChatMessage.create).toHaveBeenCalledWith({
        data: { ticketId, senderRole: 'USER', senderUserId: userId, content: 'hi' },
      });
      expect(prisma.supportTicket.update).toHaveBeenCalledWith({
        where: { id: ticketId },
        data: { lastMessageAt: expect.any(Date) },
      });
    });

    it('rejects sending to a CLOSED ticket without writing', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue({
        id: ticketId,
        userId,
        status: 'CLOSED',
      });
      await expect(
        service.createUserMessage(userId, ticketId, 'hi'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supportChatMessage.create).not.toHaveBeenCalled();
    });

    it('rejects sending to a non-owned ticket', async () => {
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(
        service.createUserMessage(userId, ticketId, 'hi'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

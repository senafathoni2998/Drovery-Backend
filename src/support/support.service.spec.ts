import { Test, TestingModule } from '@nestjs/testing';

import { SupportService } from './support.service';
import { PrismaService } from '../prisma/prisma.service';
import { FAQS } from './data/faqs';
import { createMockPrismaService } from '../test/prisma-mock';

describe('SupportService', () => {
  let service: SupportService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getFaqs', () => {
    it('should return all FAQs', () => {
      const result = service.getFaqs();

      expect(result).toEqual(FAQS);
      expect(result.length).toBe(6);
    });
  });

  describe('submitTicket', () => {
    it('persists the ticket, seeds the chat thread (user msg + system ack), and returns its id', async () => {
      prisma.supportTicket.create.mockResolvedValue({ id: 'ticket-db-1' });
      prisma.supportChatMessage.createMany.mockResolvedValue({ count: 2 });

      const result = await service.submitTicket('user-1', 'I need help');

      expect(prisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          message: 'I need help',
          lastMessageAt: expect.any(Date),
        },
      });

      expect(prisma.supportChatMessage.createMany).toHaveBeenCalledTimes(1);
      const seeded = prisma.supportChatMessage.createMany.mock.calls[0][0].data;
      expect(seeded).toHaveLength(2);
      expect(seeded[0]).toMatchObject({
        ticketId: 'ticket-db-1',
        senderRole: 'USER',
        senderUserId: 'user-1',
        content: 'I need help',
      });
      expect(seeded[1]).toMatchObject({
        ticketId: 'ticket-db-1',
        senderRole: 'SYSTEM',
        senderUserId: null,
      });
      // The system ack must sort AFTER the user message in chronological history.
      expect(seeded[0].createdAt.getTime()).toBeLessThan(
        seeded[1].createdAt.getTime(),
      );

      expect(result).toEqual({ success: true, ticketId: 'ticket-db-1' });
    });
  });

  describe('getTickets', () => {
    it('returns the user tickets most-recently-active first', async () => {
      const tickets = [{ id: 't-1', userId: 'user-1', message: 'hi' }];
      prisma.supportTicket.findMany.mockResolvedValue(tickets);

      const result = await service.getTickets('user-1');

      expect(result).toEqual(tickets);
      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });
});

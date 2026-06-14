import { Test, TestingModule } from '@nestjs/testing';

import { SupportService } from './support.service';
import { I18nService } from '../i18n/i18n.service';
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
        { provide: I18nService, useValue: new I18nService() },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getFaqs', () => {
    it('returns all FAQs in English (default) — same content as the source', () => {
      const result = service.getFaqs();

      expect(result).toEqual(FAQS);
      expect(result.length).toBe(6);
    });

    it('returns FAQs localized to Indonesian', () => {
      const result = service.getFaqs('id');

      expect(result.length).toBe(6);
      expect(result[0].question).toBe(
        'Bagaimana cara melacak pengiriman saya?',
      );
      expect(result[0].question).not.toBe(FAQS[0].question);
    });
  });

  describe('submitTicket', () => {
    it('atomically creates the ticket + seed thread (user msg + system ack) and returns its id', async () => {
      prisma.supportTicket.create.mockResolvedValue({ id: 'ticket-db-1' });

      const result = await service.submitTicket('user-1', 'I need help');

      // Single nested create — the ticket and both seed messages commit together.
      expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
      const data = prisma.supportTicket.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: 'user-1',
        message: 'I need help',
        lastMessageAt: expect.any(Date),
      });

      const seeded = data.messages.create;
      expect(seeded).toHaveLength(2);
      expect(seeded[0]).toMatchObject({
        senderRole: 'USER',
        senderUserId: 'user-1',
        content: 'I need help',
      });
      expect(seeded[1]).toMatchObject({ senderRole: 'SYSTEM' });
      expect(seeded[1].senderUserId).toBeUndefined();
      // The system ack must sort AFTER the user message in chronological history.
      expect(seeded[0].createdAt.getTime()).toBeLessThan(
        seeded[1].createdAt.getTime(),
      );

      // No separate, non-atomic second write.
      expect(prisma.supportChatMessage.createMany).not.toHaveBeenCalled();

      expect(result).toEqual({ success: true, ticketId: 'ticket-db-1' });
    });

    it('localizes the SYSTEM auto-ack to the ticket owner locale', async () => {
      prisma.user.findUnique.mockResolvedValue({ locale: 'id' });
      prisma.supportTicket.create.mockResolvedValue({ id: 'ticket-db-2' });

      await service.submitTicket('user-1', 'Tolong bantu saya');

      const seeded =
        prisma.supportTicket.create.mock.calls[0][0].data.messages.create;
      expect(seeded[1].senderRole).toBe('SYSTEM');
      expect(seeded[1].content).toContain('Terima kasih telah menghubungi');
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

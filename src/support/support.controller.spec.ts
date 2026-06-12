import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { SupportChatPublisher } from './chat/support-chat.publisher';
import { SupportChatService } from './chat/support-chat.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

describe('SupportController', () => {
  let controller: SupportController;
  let supportService: { getFaqs: jest.Mock; submitTicket: jest.Mock; getTickets: jest.Mock };
  let chat: { getMessages: jest.Mock; createUserMessage: jest.Mock };
  let publisher: { publishMessage: jest.Mock };

  beforeEach(async () => {
    supportService = {
      getFaqs: jest.fn().mockReturnValue([{ id: '1', question: 'Q?', answer: 'A.' }]),
      submitTicket: jest.fn().mockReturnValue({ success: true, ticketId: 'ticket-1' }),
      getTickets: jest.fn().mockResolvedValue([]),
    };
    chat = {
      getMessages: jest.fn().mockResolvedValue({ messages: [], total: 0, hasMore: false }),
      createUserMessage: jest.fn(),
      assertOwnedTicket: jest.fn(),
    } as any;
    publisher = { publishMessage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportController],
      providers: [
        { provide: SupportService, useValue: supportService },
        { provide: SupportChatService, useValue: chat },
        { provide: SupportChatPublisher, useValue: publisher },
      ],
    }).compile();

    controller = module.get<SupportController>(SupportController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getFaqs', () => {
    it('should delegate to supportService.getFaqs', () => {
      const result = controller.getFaqs();

      expect(supportService.getFaqs).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('submitTicket', () => {
    it('should delegate to supportService.submitTicket (trimmed)', () => {
      const result = controller.submitTicket('user-1', { message: '  Help me  ' });

      expect(supportService.submitTicket).toHaveBeenCalledWith('user-1', 'Help me');
      expect(result).toEqual({ success: true, ticketId: 'ticket-1' });
    });

    it('should throw BadRequestException for empty message', () => {
      expect(() =>
        controller.submitTicket('user-1', { message: '   ' }),
      ).toThrow(BadRequestException);
    });
  });

  describe('getMessages', () => {
    it('delegates to chat.getMessages with paging defaults', () => {
      controller.getMessages('user-1', 'ticket-1', {});
      expect(chat.getMessages).toHaveBeenCalledWith('user-1', 'ticket-1', 50, 0);
    });

    it('passes through explicit limit/offset', () => {
      controller.getMessages('user-1', 'ticket-1', { limit: 10, offset: 20 });
      expect(chat.getMessages).toHaveBeenCalledWith('user-1', 'ticket-1', 10, 20);
    });
  });

  describe('sendMessage', () => {
    it('persists then publishes the message and returns the wire payload', async () => {
      const created = {
        id: 'm-1',
        ticketId: 'ticket-1',
        senderRole: 'USER',
        senderUserId: 'user-1',
        content: 'hello',
        createdAt: new Date('2026-06-12T10:00:00.000Z'),
      };
      chat.createUserMessage.mockResolvedValue(created);

      const result = await controller.sendMessage('user-1', 'ticket-1', {
        content: '  hello  ',
      });

      expect(chat.createUserMessage).toHaveBeenCalledWith('user-1', 'ticket-1', 'hello');
      expect(publisher.publishMessage).toHaveBeenCalledWith(result);
      expect(result).toEqual({
        id: 'm-1',
        ticketId: 'ticket-1',
        senderRole: 'USER',
        senderUserId: 'user-1',
        content: 'hello',
        createdAt: '2026-06-12T10:00:00.000Z',
      });
    });
  });
});

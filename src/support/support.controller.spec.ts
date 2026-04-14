import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { SupportController } from './support.controller';
import { SupportService } from './support.service';

describe('SupportController', () => {
  let controller: SupportController;
  let supportService: { getFaqs: jest.Mock; submitTicket: jest.Mock };

  beforeEach(async () => {
    supportService = {
      getFaqs: jest.fn().mockReturnValue([{ id: '1', question: 'Q?', answer: 'A.' }]),
      submitTicket: jest.fn().mockReturnValue({ success: true, ticketId: 'ticket-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportController],
      providers: [{ provide: SupportService, useValue: supportService }],
    }).compile();

    controller = module.get<SupportController>(SupportController);
  });

  describe('getFaqs', () => {
    it('should delegate to supportService.getFaqs', () => {
      const result = controller.getFaqs();

      expect(supportService.getFaqs).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('submitTicket', () => {
    it('should delegate to supportService.submitTicket', () => {
      const result = controller.submitTicket('user-1', { message: 'Help me' });

      expect(supportService.submitTicket).toHaveBeenCalledWith('user-1', 'Help me');
      expect(result).toEqual({ success: true, ticketId: 'ticket-1' });
    });

    it('should throw BadRequestException for empty message', () => {
      expect(() =>
        controller.submitTicket('user-1', { message: '' }),
      ).toThrow(BadRequestException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';

import { SupportService } from './support.service';
import { FAQS } from './data/faqs';

jest.mock('uuid', () => ({ v4: () => 'mock-ticket-id' }));

describe('SupportService', () => {
  let service: SupportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupportService],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  describe('getFaqs', () => {
    it('should return all FAQs', () => {
      const result = service.getFaqs();

      expect(result).toEqual(FAQS);
      expect(result.length).toBe(6);
    });
  });

  describe('submitTicket', () => {
    it('should return success with ticket ID', () => {
      const result = service.submitTicket('user-1', 'I need help');

      expect(result).toEqual({ success: true, ticketId: 'mock-ticket-id' });
    });
  });
});

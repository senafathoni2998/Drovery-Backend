import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import { FAQS } from './data/faqs';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  getFaqs() {
    return FAQS;
  }

  submitTicket(userId: string, message: string) {
    const ticketId = uuidv4();

    // TODO: Persist ticket to database and integrate with actual ticketing system
    this.logger.log(
      `Support ticket ${ticketId} submitted by user ${userId}: ${message.slice(0, 100)}`,
    );

    return { success: true, ticketId };
  }
}

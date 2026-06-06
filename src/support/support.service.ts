import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { FAQS } from './data/faqs';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly prisma: PrismaService) {}

  getFaqs() {
    return FAQS;
  }

  async submitTicket(userId: string, message: string) {
    const ticket = await this.prisma.supportTicket.create({
      data: { userId, message },
    });

    this.logger.log(
      `Support ticket ${ticket.id} submitted by user ${userId}`,
    );

    return { success: true, ticketId: ticket.id };
  }

  async getTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

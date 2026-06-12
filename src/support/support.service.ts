import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { FAQS } from './data/faqs';

// The automatic first reply, so a user gets an instant acknowledgement even
// though no live agent exists yet. Recorded as a SYSTEM chat message.
const AUTO_ACK_MESSAGE =
  "Thanks for reaching out to Drovery support! We've received your message and a " +
  'member of our team will get back to you shortly. Feel free to add any other ' +
  'details here in the meantime.';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly prisma: PrismaService) {}

  getFaqs() {
    return FAQS;
  }

  async submitTicket(userId: string, message: string) {
    // Stamp the SYSTEM ack 1ms after the user's message so the chronological
    // history (ordered by createdAt) always renders [user, then auto-reply].
    const now = new Date();
    const ackAt = new Date(now.getTime() + 1);

    // One atomic nested create: the ticket + its seed thread (opening USER
    // message + the auto-acknowledgement) commit together, so a crash can never
    // leave a ticket with an empty/partial thread (no re-seed path exists).
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        message,
        lastMessageAt: ackAt,
        messages: {
          create: [
            {
              senderRole: 'USER',
              senderUserId: userId,
              content: message,
              createdAt: now,
            },
            {
              senderRole: 'SYSTEM',
              content: AUTO_ACK_MESSAGE,
              createdAt: ackAt,
            },
          ],
        },
      },
    });

    this.logger.log(
      `Support ticket ${ticket.id} submitted by user ${userId}`,
    );

    return { success: true, ticketId: ticket.id };
  }

  async getTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      // Most-recently-active first (falls back to creation time for legacy rows).
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });
  }
}

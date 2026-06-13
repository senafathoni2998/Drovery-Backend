import { Injectable, Logger } from '@nestjs/common';

import { Locale } from '../i18n/catalog';
import { I18nService } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';
import { FAQS } from './data/faqs';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /** FAQs localized to the caller's language (anonymous → Accept-Language). */
  getFaqs(locale: Locale = 'en') {
    return FAQS.map((faq) => ({
      id: faq.id,
      question: this.i18n.translate(`faq.${faq.id}.question`, locale),
      answer: this.i18n.translate(`faq.${faq.id}.answer`, locale),
    }));
  }

  async submitTicket(userId: string, message: string) {
    // The automatic first reply (an instant acknowledgement; no live agent yet),
    // recorded as a SYSTEM chat message in the ticket-owner's language. Persisted
    // localized — a historical message doesn't re-localize if the user later
    // changes locale.
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    const autoAck = this.i18n.translate('support.autoAck', owner?.locale);

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
              content: autoAck,
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

import { Injectable } from '@nestjs/common';

import {
  AppBadRequestException,
  AppNotFoundException,
} from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SupportChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner-scoped lookup — throws (generic) NotFound unless the user owns it. */
  async assertOwnedTicket(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });
    if (!ticket) {
      throw new AppNotFoundException('error.support.ticket.not_found');
    }
    return ticket;
  }

  /** Paginated, chronological message history for a ticket the user owns. */
  async getMessages(userId: string, ticketId: string, limit = 50, offset = 0) {
    await this.assertOwnedTicket(userId, ticketId);
    const [messages, total] = await this.prisma.$transaction([
      this.prisma.supportChatMessage.findMany({
        where: { ticketId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.supportChatMessage.count({ where: { ticketId } }),
    ]);
    return { messages, total, hasMore: offset + messages.length < total };
  }

  /**
   * Persist a USER message and bump the ticket's recency, atomically. Rejects a
   * CLOSED ticket. (No status transition is driven by a user message — IN_PROGRESS
   * means an agent has picked it up, which is the future admin surface's job.)
   *
   * The status read is outside the write transaction; that's a benign TOCTOU
   * today because nothing can CLOSE a ticket yet (no admin endpoint). When the
   * agent surface lands, move this to a conditional update.
   */
  async createUserMessage(userId: string, ticketId: string, content: string) {
    const ticket = await this.assertOwnedTicket(userId, ticketId);
    if (ticket.status === 'CLOSED') {
      throw new AppBadRequestException('error.support.ticket.closed');
    }
    const [message] = await this.prisma.$transaction([
      this.prisma.supportChatMessage.create({
        data: { ticketId, senderRole: 'USER', senderUserId: userId, content },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  }
}

import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

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

  /** The connecting user's role, for socket authorization. Null if the user is gone. */
  async getUserRole(userId: string): Promise<Role | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role ?? null;
  }

  /**
   * Read access to a ticket, by role.
   *
   * Staff get an EXISTENCE check; everyone else gets the ownership check. Support
   * agents are never the ticket owner — that is the whole point of a support ticket —
   * so gating the socket on ownership meant an agent could never subscribe to any
   * ticket, and the console's live chat read "Offline" permanently.
   *
   * Deliberately NOT used for writing: `createUserMessage` hardcodes
   * senderRole USER, and an agent's reply goes through the admin REST endpoint
   * (AdminService, senderRole AGENT) so it is attributed correctly. Letting staff
   * write through this path would record their replies as customer messages.
   */
  async assertTicketAccess(
    userId: string,
    role: Role | null,
    ticketId: string,
  ) {
    if (role === 'AGENT' || role === 'ADMIN') {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket) {
        throw new AppNotFoundException('error.support.ticket.not_found');
      }
      return ticket;
    }
    return this.assertOwnedTicket(userId, ticketId);
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

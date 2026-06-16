import { ApiProperty } from '@nestjs/swagger';
import { SupportChatSenderRole, SupportTicketStatus } from '@prisma/client';

// Response DTOs for Swagger/OpenAPI documentation of the support module.
// The @nestjs/swagger CLI plugin infers most field types from TS at build;
// @ApiProperty is added only for enums and fields that benefit from a description.

export class FaqResponseDto {
  id: string;
  question: string;
  answer: string;
}

export class SupportTicketResponseDto {
  id: string;
  userId: string;
  /** The opening message text — kept for mobile ticket-list display. */
  message: string;
  @ApiProperty({ enum: SupportTicketStatus })
  status: SupportTicketStatus;
  /** Timestamp of the most recent message; drives "active first" ordering. */
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SubmitTicketResponseDto {
  success: boolean;
  ticketId: string;
}

export class SupportChatMessageDto {
  id: string;
  ticketId: string;
  @ApiProperty({ enum: SupportChatSenderRole })
  senderRole: SupportChatSenderRole;
  /** The user ID of the author; null for AGENT/SYSTEM messages. */
  senderUserId: string | null;
  content: string;
  createdAt: Date;
}

export class PaginatedSupportChatMessagesDto {
  @ApiProperty({ type: [SupportChatMessageDto] })
  messages: SupportChatMessageDto[];
  total: number;
  hasMore: boolean;
}

/** Wire shape returned by the REST send endpoint (and WS frames).
 *  createdAt is serialized as an ISO 8601 string on the wire. */
export class SupportChatMessagePayloadDto {
  id: string;
  ticketId: string;
  @ApiProperty({ enum: ['USER', 'AGENT', 'SYSTEM'] })
  senderRole: string;
  /** The user ID of the author; null for AGENT/SYSTEM messages. */
  senderUserId: string | null;
  content: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

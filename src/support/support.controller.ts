import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  SupportChatPublisher,
  toSupportChatPayload,
} from './chat/support-chat.publisher';
import { SupportChatService } from './chat/support-chat.service';
import {
  CreateTicketDto,
  GetMessagesQueryDto,
  SendChatMessageDto,
} from './dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly chat: SupportChatService,
    private readonly publisher: SupportChatPublisher,
  ) {}

  @Public()
  @Get('faq')
  getFaqs() {
    return this.supportService.getFaqs();
  }

  @Get('tickets')
  getTickets(@CurrentUser('sub') userId: string) {
    return this.supportService.getTickets(userId);
  }

  @Post('tickets')
  submitTicket(
    @CurrentUser('sub') userId: string,
    @Body() body: CreateTicketDto,
  ) {
    if (!body.message || body.message.trim().length === 0) {
      throw new BadRequestException('Message is required');
    }

    return this.supportService.submitTicket(userId, body.message.trim());
  }

  // Chat history for a ticket (also the polling backstop when the WS drops).
  @Get('tickets/:ticketId/messages')
  getMessages(
    @CurrentUser('sub') userId: string,
    @Param('ticketId') ticketId: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.chat.getMessages(
      userId,
      ticketId,
      query.limit ?? 50,
      query.offset ?? 0,
    );
  }

  // REST send — identical effect to the WS 'send' frame (persist + realtime
  // fanout), so a client without a live socket still works.
  @Post('tickets/:ticketId/messages')
  async sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: SendChatMessageDto,
  ) {
    const message = await this.chat.createUserMessage(
      userId,
      ticketId,
      dto.content.trim(),
    );
    const payload = toSupportChatPayload(message);
    await this.publisher.publishMessage(payload);
    return payload;
  }
}

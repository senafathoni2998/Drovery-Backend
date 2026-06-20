import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { AppBadRequestException } from '../common/exceptions/app-exception';
import { parseLocale } from '../i18n/accept-language';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PublicApi } from '../common/decorators/public-api.decorator';
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
import {
  FaqResponseDto,
  PaginatedSupportChatMessagesDto,
  SubmitTicketResponseDto,
  SupportChatMessagePayloadDto,
  SupportTicketResponseDto,
} from './dto/support-response.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly chat: SupportChatService,
    private readonly publisher: SupportChatPublisher,
  ) {}

  @PublicApi()
  @Get('faq')
  @ApiOkResponse({ type: [FaqResponseDto] })
  getFaqs(@Headers('accept-language') acceptLanguage?: string) {
    return this.supportService.getFaqs(parseLocale(acceptLanguage));
  }

  @Get('tickets')
  @ApiOkResponse({ type: [SupportTicketResponseDto] })
  getTickets(@CurrentUser('sub') userId: string) {
    return this.supportService.getTickets(userId);
  }

  @Post('tickets')
  @ApiCreatedResponse({ type: SubmitTicketResponseDto })
  submitTicket(
    @CurrentUser('sub') userId: string,
    @Body() body: CreateTicketDto,
  ) {
    if (!body.message || body.message.trim().length === 0) {
      throw new AppBadRequestException('error.support.message_required');
    }

    return this.supportService.submitTicket(userId, body.message.trim());
  }

  // Chat history for a ticket (also the polling backstop when the WS drops).
  @Get('tickets/:ticketId/messages')
  @ApiOkResponse({ type: PaginatedSupportChatMessagesDto })
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
  @ApiCreatedResponse({ type: SupportChatMessagePayloadDto })
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

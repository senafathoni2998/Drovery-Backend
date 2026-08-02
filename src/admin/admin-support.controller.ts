import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator';
import { SupportChatMessagePayloadDto } from '../support/dto/support-response.dto';
import { AdminService } from './admin.service';
import {
  AdminTicketQueryDto,
  AgentReplyDto,
  TicketStatusDto,
} from './dto/admin.dto';
import {
  AdminPaginatedSupportTicketsDto,
  AdminSupportTicketDetailDto,
  AdminSupportTicketStatusDto,
} from './dto/admin-response.dto';
import { AuditActor } from './audit/audit-actor.decorator';

// Support agent inbox — agents and admins.
@Roles(Role.AGENT, Role.ADMIN)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly admin: AdminService) {}

  @Get('tickets')
  @ApiOkResponse({ type: AdminPaginatedSupportTicketsDto })
  listTickets(@Query() query: AdminTicketQueryDto) {
    return this.admin.listTickets(query);
  }

  @Get('tickets/:id')
  @ApiOkResponse({ type: AdminSupportTicketDetailDto })
  getTicket(@Param('id') id: string) {
    return this.admin.getTicket(id);
  }

  @Post('tickets/:id/messages')
  @ApiCreatedResponse({ type: SupportChatMessagePayloadDto })
  reply(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: AgentReplyDto,
  ) {
    return this.admin.replyAsAgent(actor, id, dto.content);
  }

  @Patch('tickets/:id/status')
  @ApiOkResponse({ type: AdminSupportTicketStatusDto })
  setStatus(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: TicketStatusDto,
  ) {
    return this.admin.setTicketStatus(actor, id, dto.status);
  }
}

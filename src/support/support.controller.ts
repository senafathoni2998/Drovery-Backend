import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Public()
  @Get('faq')
  getFaqs() {
    return this.supportService.getFaqs();
  }

  @Post('tickets')
  submitTicket(
    @CurrentUser('sub') userId: string,
    @Body() body: { message: string },
  ) {
    if (!body.message || body.message.trim().length === 0) {
      throw new BadRequestException('Message is required');
    }

    return this.supportService.submitTicket(userId, body.message);
  }
}

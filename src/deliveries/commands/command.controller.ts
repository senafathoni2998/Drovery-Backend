import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { DroneAuthGuard } from '../telemetry/drone-auth.guard';
import { AckCommandDto } from './dto/ack-command.dto';
import {
  AckCommandResponseDto,
  PollCommandResponseDto,
} from './dto/command-response.dto';
import { PollCommandDto } from './dto/poll-command.dto';
import { DroneCommandService } from './drone-command.service';

/**
 * The backend -> drone command channel, drone side. Same transport + auth as
 * telemetry: @Public() (a drone is not a user) gated by DroneAuthGuard (fail-closed
 * shared key + optional timestamped HMAC). A drone polls its queue and acks; the
 * ack is what actually drives the delivery transition.
 */
@ApiTags('drone-ingest')
@ApiSecurity('ingest-key')
@Controller('ingest')
export class CommandController {
  constructor(private readonly commands: DroneCommandService) {}

  @Public()
  @UseGuards(DroneAuthGuard)
  @Get('commands')
  @ApiOkResponse({ type: PollCommandResponseDto })
  async poll(@Query() query: PollCommandDto) {
    return this.commands.fetchPending(query.droneId);
  }

  @Public()
  @UseGuards(DroneAuthGuard)
  @Post('commands/:id/ack')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AckCommandResponseDto })
  async ack(@Param('id') id: string, @Body() dto: AckCommandDto) {
    return this.commands.ack(id, dto.droneId, dto.accepted ?? true, dto.note);
  }
}

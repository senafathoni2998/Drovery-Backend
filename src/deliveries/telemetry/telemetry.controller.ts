import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { DroneAuthGuard } from './drone-auth.guard';
import { TelemetryIngestResponseDto } from './dto/telemetry-response.dto';
import { TelemetryDto } from './dto/telemetry.dto';
import { TelemetryService } from './telemetry.service';

/**
 * Primary, hardware-free telemetry transport: a drone-gateway POSTs frames here.
 * No broker, trivially testable. @Public() opts out of the global JwtAuthGuard
 * (a drone is not a user); DroneAuthGuard is the actual gate (shared key + HMAC).
 */
@ApiTags('drone-ingest')
@ApiSecurity('ingest-key')
@Controller('ingest')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Public()
  @UseGuards(DroneAuthGuard)
  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TelemetryIngestResponseDto })
  async ingest(@Body() dto: TelemetryDto) {
    return this.telemetry.ingest(dto);
  }
}

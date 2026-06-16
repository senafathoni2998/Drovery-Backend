import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProofOfDeliveryDto } from '../dto/delivery-response.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { ProofService } from './proof.service';

@Controller('deliveries')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Post(':id/proof')
  @ApiCreatedResponse({ type: ProofOfDeliveryDto })
  submit(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.proofService.submitProof(userId, id, dto);
  }

  @Get(':id/proof')
  @ApiOkResponse({ type: ProofOfDeliveryDto })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.proofService.getProof(userId, id);
  }
}

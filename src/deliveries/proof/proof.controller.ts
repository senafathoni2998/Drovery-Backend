import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { ProofService } from './proof.service';

@Controller('deliveries')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Post(':id/proof')
  submit(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.proofService.submitProof(userId, id, dto);
  }

  @Get(':id/proof')
  get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.proofService.getProof(userId, id);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { WalletService } from './wallet.service';
import {
  ReferralsResponseDto,
  WalletResponseDto,
} from './dto/wallet-response.dto';

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet')
  @ApiOkResponse({ type: WalletResponseDto })
  getWallet(@CurrentUser('sub') userId: string, @Query() query: PaginationDto) {
    return this.wallet.getWallet(userId, query);
  }

  @Get('referrals')
  @ApiOkResponse({ type: ReferralsResponseDto })
  getReferrals(@CurrentUser('sub') userId: string) {
    return this.wallet.getReferrals(userId);
  }
}

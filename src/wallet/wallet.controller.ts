import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { WalletService } from './wallet.service';

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet')
  getWallet(
    @CurrentUser('sub') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.wallet.getWallet(userId, query);
  }

  @Get('referrals')
  getReferrals(@CurrentUser('sub') userId: string) {
    return this.wallet.getReferrals(userId);
  }
}

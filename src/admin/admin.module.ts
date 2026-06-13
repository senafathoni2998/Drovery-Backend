import { Module } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { SupportModule } from '../support/support.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminController } from './admin.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    DeliveriesModule, // DeliveriesService (force-cancel)
    SupportModule, // SupportChatPublisher (agent reply fanout)
    WalletModule, // WalletService (refund credit)
  ],
  controllers: [AdminController, AdminSupportController],
  providers: [AdminService],
})
export class AdminModule {}

import { Module } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/deliveries.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { SupportModule } from '../support/support.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminController } from './admin.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminService } from './admin.service';
import { AdminAuditService } from './audit/admin-audit.service';

@Module({
  imports: [
    DeliveriesModule, // DeliveriesService (force-cancel)
    SupportModule, // SupportChatPublisher (agent reply fanout)
    WalletModule, // WalletService (refund credit)
    // AirspaceService (drop the cached zone list after a zone write). No cycle:
    // ServiceabilityModule is a leaf and imports nothing.
    ServiceabilityModule,
  ],
  controllers: [AdminController, AdminSupportController],
  providers: [AdminService, AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminModule {}

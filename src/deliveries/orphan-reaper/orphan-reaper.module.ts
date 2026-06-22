import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { WalletModule } from '../../wallet/wallet.module';
import { PromoModule } from '../../promo/promo.module';
import { IS_WORKER_TIER } from '../../common/process-role';
import { OrphanReaperProcessor } from './orphan-reaper.processor';
import { OrphanReaperScheduler } from './orphan-reaper.scheduler';
import { OrphanReaperService } from './orphan-reaper.service';
import { ORPHAN_REAPER_QUEUE } from './orphan-reaper.constants';

/**
 * Orphaned-reservation janitor (SCALING-1M.md §2 Stage-A3) — the out-of-process safety net for
 * the debit-first saga. Providers run on the WORKER tier only (mirrors TrackingCheckpointModule):
 * the scheduler is instantiated on every worker so it can TEAR DOWN the repeatable sweep if
 * DELIVERY_DEBIT_FIRST is flipped off, and only UPSERTS it when RUN_ORPHAN_REAPER (saga on). The
 * sweep reuses WalletService.refundForDelivery + PromoService.releaseForDelivery as compensations.
 */
@Module({
  imports: [
    WalletModule, // exports WalletService (refundForDelivery)
    PromoModule, // exports PromoService (releaseForDelivery)
    BullModule.registerQueue({ name: ORPHAN_REAPER_QUEUE }),
  ],
  providers: [
    OrphanReaperService,
    ...(IS_WORKER_TIER ? [OrphanReaperProcessor, OrphanReaperScheduler] : []),
  ],
})
export class OrphanReaperModule {}

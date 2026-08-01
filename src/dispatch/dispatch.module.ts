import { Module } from '@nestjs/common';

import { DispatchService } from './dispatch.service';

// Leaf module: depends only on PrismaService (@Global), so it can be imported by
// DeliveriesModule without any risk of a cycle back through it.
@Module({
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';

import { OUTBOX_QUEUE } from '../outbox/outbox.constants';
import { SIM_QUEUE } from '../deliveries/simulation/simulation.constants';
import { CacheService } from '../cache/cache.service';
import { I18nService } from '../i18n/i18n.service';
import { MetricsService } from '../metrics/metrics.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminModule } from './admin.module';
import { AdminService } from './admin.service';

/**
 * A provider stub that answers any property with a jest.fn — EXCEPT `then`.
 *
 * That exception is load-bearing and cost an afternoon to find. Nest `await`s each
 * factory result, and `await x` on an object whose `then` is a function treats it as a
 * thenable and calls `then(resolve, reject)`. A blanket proxy hands back a bare
 * `jest.fn()`, which never calls either callback, so the await never settles: the
 * module graph appears to "hang", and the natural (wrong) conclusion is that it is too
 * heavy to construct. Return `undefined` for `then` and the same graph compiles in
 * milliseconds.
 */
const stub = () =>
  new Proxy(
    {},
    { get: (_t, prop) => (prop === 'then' ? undefined : jest.fn()) },
  );

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: stub },
    { provide: CacheService, useFactory: stub },
    { provide: I18nService, useFactory: stub },
    { provide: MetricsService, useFactory: stub },
    { provide: MqttService, useFactory: stub },
  ],
  exports: [
    PrismaService,
    CacheService,
    I18nService,
    MetricsService,
    MqttService,
  ],
})
class GlobalStubsModule {}

/**
 * Does AdminModule's dependency graph actually RESOLVE?
 *
 * Nothing else in the suite asks. Every other admin spec builds a hand-rolled
 * `Test.createTestingModule({ providers: [...] })` listing exactly the providers it
 * wants, which is precisely the arrangement that cannot see a missing module import:
 * `AdminService` gained an `AirspaceService` constructor parameter, and had
 * `admin.module.ts` not imported `ServiceabilityModule`, all 88 of those tests would
 * still pass while the application failed to boot.
 *
 * Deliberately scoped to AdminModule, not AppModule. What this does NOT cover:
 * `APP_FILTER`/`APP_GUARD`/`APP_INTERCEPTOR` bindings, `ScheduleModule`, and any
 * provider gated on a different `PROCESS_ROLE`. It needs no database, Redis or MQTT —
 * the five @Global services are stubbed and BullMQ connects lazily.
 */
describe('AdminModule wiring', () => {
  it('resolves AdminService, including the AirspaceService it injects', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        BullModule.forRoot({ connection: { host: '127.0.0.1', port: 6379 } }),
        GlobalStubsModule,
        AdminModule,
      ],
    })
      // The two queues AdminModule reaches transitively (DeliveriesModule → SIM_QUEUE,
      // OutboxModule → OUTBOX_QUEUE). Overridden so no real BullMQ Queue — and so no
      // ioredis socket — is ever constructed: this test is about DI resolution, and a
      // live Queue would make it need Redis AND emit an unhandled 'Connection is
      // closed' on teardown, which crashes the worker rather than failing the test.
      .overrideProvider(getQueueToken(SIM_QUEUE))
      .useValue(stub())
      .overrideProvider(getQueueToken(OUTBOX_QUEUE))
      .useValue(stub())
      .compile();

    const admin = moduleRef.get(AdminService);
    expect(typeof admin.createAirspaceZone).toBe('function');
    expect(typeof admin.deactivateAirspaceZone).toBe('function');

    await moduleRef.close();
  });
});

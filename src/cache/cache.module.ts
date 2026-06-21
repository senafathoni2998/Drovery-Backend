import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { buildRedisOptions } from '../config/redis';
import { CacheService, REDIS_CLIENT } from './cache.service';

const redisProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('CacheRedis');
    const client = new Redis({
      ...buildRedisOptions(config, 'cache'),
      // Cache ops must fail fast (and open) rather than hang/retry forever.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    // Without a listener, ioredis 'error' events would crash the process.
    client.on('error', (err) =>
      logger.warn(`cache redis error: ${err.message}`),
    );
    return client;
  },
};

@Global()
@Module({
  providers: [redisProvider, CacheService],
  exports: [CacheService],
})
export class CacheModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}

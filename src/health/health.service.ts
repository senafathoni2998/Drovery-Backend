import { Injectable } from '@nestjs/common';

import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthChecks {
  database: boolean;
  redis: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Checks the critical dependencies in parallel. */
  async check(): Promise<HealthChecks> {
    const [database, redis] = await Promise.all([
      this.pingDatabase(),
      this.cache.ping(),
    ]);
    return { database, redis };
  }

  private async pingDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

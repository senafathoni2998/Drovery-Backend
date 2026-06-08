import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Bound the per-instance connection pool. With N replicas, N × max must stay
    // under Postgres `max_connections` — or point DATABASE_URL at PgBouncer, which
    // multiplexes many clients onto a small server-side pool (see docker-compose).
    const max = parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max });
    super({ adapter: new PrismaPg(pool as any) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

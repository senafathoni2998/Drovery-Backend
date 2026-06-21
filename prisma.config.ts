import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL,
  },
  // Prisma 7 reads the seed command from here (not package.json's prisma.seed).
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});

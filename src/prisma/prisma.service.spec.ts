import { PrismaService } from './prisma.service';

// Mock pg Pool and PrismaPg adapter to avoid a real DB connection.
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: unknown;
    constructor(msg: string, opts: { code: string; meta?: unknown }) {
      super(msg);
      this.code = opts.code;
      this.meta = opts.meta;
    }
  }
  class PrismaClientInitializationError extends Error {}
  return {
    PrismaClient: class MockPrismaClient {
      $connect = jest.fn().mockResolvedValue(undefined);
      $disconnect = jest.fn().mockResolvedValue(undefined);
    },
    Prisma: { PrismaClientKnownRequestError, PrismaClientInitializationError },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Prisma } = require('@prisma/client');

describe('PrismaService', () => {
  const ORIGINAL_REPLICA = process.env.DATABASE_REPLICA_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });
  afterEach(() => {
    if (ORIGINAL_REPLICA === undefined) delete process.env.DATABASE_REPLICA_URL;
    else process.env.DATABASE_REPLICA_URL = ORIGINAL_REPLICA;
  });

  describe('lifecycle', () => {
    it('onModuleInit connects the primary', async () => {
      delete process.env.DATABASE_REPLICA_URL;
      const service = new PrismaService();
      await service.onModuleInit();
      expect(service.$connect).toHaveBeenCalled();
    });

    it('onModuleDestroy disconnects', async () => {
      delete process.env.DATABASE_REPLICA_URL;
      const service = new PrismaService();
      await service.onModuleDestroy();
      expect(service.$disconnect).toHaveBeenCalled();
    });
  });

  describe('read/write split — no replica configured', () => {
    beforeEach(() => delete process.env.DATABASE_REPLICA_URL);

    it('readWithFallback runs the callback once against the primary', async () => {
      const service = new PrismaService();
      const fn = jest.fn().mockResolvedValue('ok');
      await expect(service.readWithFallback(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(service); // the primary itself
    });
  });

  describe('read/write split — replica configured', () => {
    beforeEach(() => {
      // Dummy URL — we never $connect here, so no socket opens.
      process.env.DATABASE_REPLICA_URL = 'postgresql://localhost:5999/replica';
    });

    it('builds a distinct reader client (private field, not a proxied getter)', () => {
      const service = new PrismaService();
      expect((service as any).readerClient).toBeTruthy();
      expect((service as any).readerClient).not.toBe(service);
    });

    it('does NOT build a reader on the worker tier (PROCESS_ROLE=worker)', () => {
      process.env.PROCESS_ROLE = 'worker';
      try {
        const service = new PrismaService();
        expect((service as any).readerClient).toBeNull();
      } finally {
        delete process.env.PROCESS_ROLE;
      }
    });

    it('does NOT build a reader on the realtime tier (PROCESS_ROLE=realtime)', () => {
      // The realtime tier serves WS only — its ownership re-checks read the primary,
      // and /api/* reads route to the api tier, so it must not open an idle reader pool.
      process.env.PROCESS_ROLE = 'realtime';
      try {
        const service = new PrismaService();
        expect((service as any).readerClient).toBeNull();
      } finally {
        delete process.env.PROCESS_ROLE;
      }
    });

    it('routes a successful read to the replica, not the primary', async () => {
      const service = new PrismaService();
      const fn = jest.fn().mockResolvedValue('from-replica');
      await expect(service.readWithFallback(fn)).resolves.toBe('from-replica');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith((service as any).readerClient);
    });

    it('falls back to the primary ONCE on a connection-class error', async () => {
      const service = new PrismaService();
      const connErr = new Prisma.PrismaClientKnownRequestError('down', {
        code: 'P1001',
      });
      const fn = jest
        .fn()
        .mockRejectedValueOnce(connErr) // reader attempt fails
        .mockResolvedValueOnce('primary-ok'); // primary retry succeeds

      await expect(service.readWithFallback(fn)).resolves.toBe('primary-ok');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[1][0]).toBe(service); // retried on the primary
    });

    it('does NOT fall back on a non-connection error (P2002) — it propagates', async () => {
      const service = new PrismaService();
      const queryErr = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
      });
      const fn = jest.fn().mockRejectedValue(queryErr);

      await expect(service.readWithFallback(fn)).rejects.toBe(queryErr);
      expect(fn).toHaveBeenCalledTimes(1); // no primary retry
    });
  });
});

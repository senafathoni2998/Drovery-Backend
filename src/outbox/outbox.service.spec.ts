import { Prisma } from '@prisma/client';

import { OutboxService } from './outbox.service';
import { OUTBOX_EVENT_REFERRAL_REWARD } from './outbox.constants';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('OutboxService', () => {
  let prisma: any;
  let tx: any;
  let wallet: { maybeGrantReferralRewardWithinTx: jest.Mock };
  let metrics: any;
  let service: OutboxService;

  beforeEach(() => {
    tx = { outboxEvent: { update: jest.fn().mockResolvedValue({}) } };
    prisma = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      // Run the callback with the tx mock; propagate a thrown error like the real client.
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    };
    wallet = {
      maybeGrantReferralRewardWithinTx: jest.fn().mockResolvedValue(undefined),
    };
    metrics = {
      outboxProcessedTotal: { inc: jest.fn() },
      outboxPending: { set: jest.fn() },
      outboxFailed: { set: jest.fn() },
    };
    service = new OutboxService(prisma, wallet as any, metrics);
  });

  describe('enqueueWithinTx', () => {
    it('writes a PENDING event row in the caller tx', async () => {
      const txCreate = { outboxEvent: { create: jest.fn() } };
      await service.enqueueWithinTx(txCreate as any, {
        aggregateType: 'delivery',
        aggregateId: 'd-1',
        eventType: OUTBOX_EVENT_REFERRAL_REWARD,
        idempotencyKey: 'outbox-referral:d-1',
        payload: { refereeUserId: 'u-1' },
      });
      expect(txCreate.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          aggregateType: 'delivery',
          aggregateId: 'd-1',
          eventType: OUTBOX_EVENT_REFERRAL_REWARD,
          idempotencyKey: 'outbox-referral:d-1',
          payload: { refereeUserId: 'u-1' },
        },
      });
    });
  });

  describe('processOne', () => {
    const claimable = {
      id: 'e-1',
      eventType: OUTBOX_EVENT_REFERRAL_REWARD,
      payload: { refereeUserId: 'u-1' },
      attempts: 1,
    };

    it('claims (CAS), applies the handler verbatim, and co-commits PROCESSED', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue(claimable);

      await (service as any).processOne('e-1');

      // Atomic claim PENDING→PROCESSING + attempts++.
      expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
        where: { id: 'e-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'PROCESSING',
          attempts: { increment: 1 },
        }),
      });
      // Handler is the canonical helper, called with the payload's refereeUserId.
      expect(wallet.maybeGrantReferralRewardWithinTx).toHaveBeenCalledWith(
        tx,
        'u-1',
      );
      // PROCESSED is marked in the SAME tx as the grant.
      expect(tx.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      });
      expect(metrics.outboxProcessedTotal.inc).toHaveBeenCalledWith({
        event_type: OUTBOX_EVENT_REFERRAL_REWARD,
        result: 'processed',
      });
    });

    it('skips (no apply) when the claim is lost to another worker (count===0)', async () => {
      prisma.outboxEvent.updateMany.mockResolvedValue({ count: 0 });

      await (service as any).processOne('e-1');

      expect(prisma.outboxEvent.findUnique).not.toHaveBeenCalled();
      expect(wallet.maybeGrantReferralRewardWithinTx).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('treats an already-applied P2002 as success → PROCESSED (duplicate), not error', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue(claimable);
      wallet.maybeGrantReferralRewardWithinTx.mockRejectedValue(p2002());

      await (service as any).processOne('e-1');

      // Marked PROCESSED via the standalone update (the tx rolled back).
      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      });
      expect(metrics.outboxProcessedTotal.inc).toHaveBeenCalledWith({
        event_type: OUTBOX_EVENT_REFERRAL_REWARD,
        result: 'duplicate',
      });
    });

    it('on a genuine error leaves the row PROCESSING (reaper retries) and records lastError', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue(claimable);
      wallet.maybeGrantReferralRewardWithinTx.mockRejectedValue(
        new Error('deadlock detected'),
      );

      await (service as any).processOne('e-1');

      // Never marked PROCESSED; only lastError is written (status stays PROCESSING).
      const statusWrites = prisma.outboxEvent.update.mock.calls.filter(
        (c: any[]) => c[0]?.data?.status === 'PROCESSED',
      );
      expect(statusWrites).toHaveLength(0);
      expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: { lastError: 'deadlock detected' },
      });
      expect(metrics.outboxProcessedTotal.inc).toHaveBeenCalledWith({
        event_type: OUTBOX_EVENT_REFERRAL_REWARD,
        result: 'error',
      });
    });

    it('errors (no grant) on an unknown event type', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue({
        id: 'e-1',
        eventType: 'NOPE',
        payload: {},
        attempts: 1,
      });

      await (service as any).processOne('e-1');

      expect(wallet.maybeGrantReferralRewardWithinTx).not.toHaveBeenCalled();
      expect(metrics.outboxProcessedTotal.inc).toHaveBeenCalledWith({
        event_type: 'NOPE',
        result: 'error',
      });
    });

    it('errors on a REFERRAL_REWARD event missing refereeUserId', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue({
        id: 'e-1',
        eventType: OUTBOX_EVENT_REFERRAL_REWARD,
        payload: {},
        attempts: 1,
      });

      await (service as any).processOne('e-1');

      expect(wallet.maybeGrantReferralRewardWithinTx).not.toHaveBeenCalled();
      expect(metrics.outboxProcessedTotal.inc).toHaveBeenCalledWith({
        event_type: OUTBOX_EVENT_REFERRAL_REWARD,
        result: 'error',
      });
    });
  });

  describe('reapStaleClaims', () => {
    it('parks exhausted stale claims FAILED and re-PENDs the rest', async () => {
      await (service as any).reapStaleClaims();

      const calls = prisma.outboxEvent.updateMany.mock.calls;
      // Exhausted (attempts >= MAX) → FAILED.
      expect(calls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              where: expect.objectContaining({
                status: 'PROCESSING',
                attempts: expect.objectContaining({ gte: expect.any(Number) }),
              }),
              data: { status: 'FAILED' },
            }),
          ],
          [
            expect.objectContaining({
              where: expect.objectContaining({
                status: 'PROCESSING',
                attempts: expect.objectContaining({ lt: expect.any(Number) }),
              }),
              data: { status: 'PENDING', claimedAt: null },
            }),
          ],
        ]),
      );
    });
  });

  describe('dispatchDue', () => {
    it('reaps, claims+applies each PENDING event, and refreshes backlog gauges', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([{ id: 'e-1' }]);
      prisma.outboxEvent.findUnique.mockResolvedValue({
        id: 'e-1',
        eventType: OUTBOX_EVENT_REFERRAL_REWARD,
        payload: { refereeUserId: 'u-9' },
        attempts: 1,
      });
      prisma.outboxEvent.count
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(1); // failed

      await service.dispatchDue();

      expect(wallet.maybeGrantReferralRewardWithinTx).toHaveBeenCalledWith(
        tx,
        'u-9',
      );
      expect(metrics.outboxPending.set).toHaveBeenCalledWith(3);
      expect(metrics.outboxFailed.set).toHaveBeenCalledWith(1);
    });

    it('works without a MetricsService (it is optional)', async () => {
      const noMetrics = new OutboxService(prisma, wallet as any);
      prisma.outboxEvent.findMany.mockResolvedValue([]);
      await expect(noMetrics.dispatchDue()).resolves.toBeUndefined();
    });
  });
});

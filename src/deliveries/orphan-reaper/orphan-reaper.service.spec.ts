import { OrphanReaperService } from './orphan-reaper.service';

describe('OrphanReaperService.sweep', () => {
  let prisma: any;
  let wallet: { refundForDelivery: jest.Mock };
  let promo: { releaseForDelivery: jest.Mock };
  let metrics: any;
  let service: OrphanReaperService;
  // Candidate sets returned by the anti-join $queryRaw (debit vs promo), routed by SQL text.
  let debitCandidates: Array<{ deliveryId: string }>;
  let promoCandidates: Array<{ deliveryId: string }>;

  beforeEach(() => {
    debitCandidates = [];
    promoCandidates = [];
    prisma = {
      // The orphan candidate queries are raw SQL anti-joins (there is no FK relation to the
      // partitioned Delivery, so they can't be Prisma relation filters). Route by table name
      // so a test can seed debit vs promo candidates.
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = Array.from(strings).join(' ');
        return Promise.resolve(
          sql.includes('promo_redemptions') ? promoCandidates : debitCandidates,
        );
      }),
      walletTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      promoRedemption: { findFirst: jest.fn().mockResolvedValue(null) },
      delivery: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    wallet = { refundForDelivery: jest.fn().mockResolvedValue(undefined) };
    promo = { releaseForDelivery: jest.fn().mockResolvedValue(undefined) };
    metrics = {
      orphanReservationsReaped: { inc: jest.fn() },
      orphanReaperLastScan: { set: jest.fn() },
    };
    service = new OrphanReaperService(
      prisma,
      wallet as any,
      promo as any,
      metrics,
    );
  });

  // Route walletTransaction.findFirst by the queried reason (debit vs refund probe).
  const setWalletState = (opts: { debit?: any; refund?: any }) => {
    prisma.walletTransaction.findFirst.mockImplementation((args: any) => {
      if (args.where.reason === 'CHECKOUT_SPEND')
        return Promise.resolve(opts.debit ?? null);
      if (args.where.reason === 'CHECKOUT_REFUND')
        return Promise.resolve(opts.refund ?? null);
      return Promise.resolve(null);
    });
  };

  it('reverses a confirmed orphan (committed debit + promo, no delivery)', async () => {
    debitCandidates = [{ deliveryId: 'd-1' }];
    prisma.delivery.findFirst.mockResolvedValue(null); // no delivery → orphan
    setWalletState({ debit: { id: 'w-1' }, refund: null });
    prisma.promoRedemption.findFirst.mockResolvedValue({ id: 'p-1' });

    await service.sweep();

    expect(wallet.refundForDelivery).toHaveBeenCalledWith('d-1');
    expect(promo.releaseForDelivery).toHaveBeenCalledWith('d-1');
    expect(metrics.orphanReservationsReaped.inc).toHaveBeenCalledWith(1);
  });

  it('does NOT compensate when the delivery exists now (slow / mid-retry commit)', async () => {
    debitCandidates = [{ deliveryId: 'd-2' }];
    prisma.delivery.findFirst.mockResolvedValue({ id: 'd-2' }); // delivery committed

    await service.sweep();

    expect(wallet.refundForDelivery).not.toHaveBeenCalled();
    expect(promo.releaseForDelivery).not.toHaveBeenCalled();
    expect(metrics.orphanReservationsReaped.inc).not.toHaveBeenCalled();
  });

  it('skips an already-refunded debit (no re-compensation, no metric)', async () => {
    debitCandidates = [{ deliveryId: 'd-3' }];
    prisma.delivery.findFirst.mockResolvedValue(null);
    setWalletState({ debit: { id: 'w-3' }, refund: { id: 'r-3' } }); // already refunded
    prisma.promoRedemption.findFirst.mockResolvedValue(null);

    await service.sweep();

    expect(wallet.refundForDelivery).not.toHaveBeenCalled();
    expect(metrics.orphanReservationsReaped.inc).not.toHaveBeenCalled();
  });

  it('compensates a promo-only orphan without a spurious refund', async () => {
    promoCandidates = [{ deliveryId: 'd-4' }];
    prisma.delivery.findFirst.mockResolvedValue(null);
    setWalletState({ debit: null, refund: null }); // no debit at all
    prisma.promoRedemption.findFirst.mockResolvedValue({ id: 'p-4' });

    await service.sweep();

    expect(promo.releaseForDelivery).toHaveBeenCalledWith('d-4');
    expect(wallet.refundForDelivery).not.toHaveBeenCalled();
  });

  it('isolates a failing candidate so the rest of the sweep still runs', async () => {
    debitCandidates = [{ deliveryId: 'bad' }, { deliveryId: 'good' }];
    prisma.delivery.findFirst.mockResolvedValue(null);
    setWalletState({ debit: { id: 'w' }, refund: null });
    prisma.promoRedemption.findFirst.mockResolvedValue(null);
    wallet.refundForDelivery.mockImplementation((id: string) =>
      id === 'bad'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(undefined),
    );

    await expect(service.sweep()).resolves.toBeUndefined();
    expect(wallet.refundForDelivery).toHaveBeenCalledWith('good');
  });

  it('records the heartbeat even when there are no candidates', async () => {
    await service.sweep();
    expect(metrics.orphanReaperLastScan.set).toHaveBeenCalled();
    expect(metrics.orphanReservationsReaped.inc).not.toHaveBeenCalled();
  });

  it('selects candidates via an anti-join that excludes delivery-backed reservations', async () => {
    // §2-A3 fix: a bounded, unordered candidate scan must NOT be saturated by legitimate
    // (delivery-backed) reservations, or genuine orphans never make the batch. The debit query
    // excludes rows whose delivery exists AND already-refunded debits; the promo query excludes
    // delivery-backed redemptions. Guards against silently reverting to the saturated scan.
    await service.sweep();
    const sqls: string[] = prisma.$queryRaw.mock.calls.map((c: any[]) =>
      Array.from(c[0] as TemplateStringsArray).join(' '),
    );
    const debitSql = sqls.find((s) => s.includes('wallet_transactions'));
    const promoSql = sqls.find((s) => s.includes('promo_redemptions'));
    expect(debitSql).toMatch(/NOT EXISTS[\s\S]*FROM deliveries/);
    expect(debitSql).toMatch(/CHECKOUT_REFUND/);
    expect(promoSql).toMatch(/NOT EXISTS[\s\S]*FROM deliveries/);
  });
});

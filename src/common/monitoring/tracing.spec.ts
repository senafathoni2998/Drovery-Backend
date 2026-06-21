import {
  tracingEnabled,
  injectTraceCarrier,
  withJobSpan,
  activeTraceId,
  shutdownTracing,
} from './tracing';

/**
 * The critical guarantee: with no tracing env set (the default everywhere in
 * dev/test/CI), tracing is fully inert — the SDK never starts, nothing is patched,
 * and every export is a no-op, so the rest of the suite is byte-identical. The
 * enabled cross-tier path (one traceId across the create request + its worker jobs)
 * is proven by the live e2e verification with the console exporter.
 */
describe('tracing — disabled by default', () => {
  it('is disabled with no TRACING_ENABLED / OTLP endpoint', () => {
    expect(tracingEnabled).toBe(false);
  });

  it('injectTraceCarrier is a pure pass-through (same ref, no _carrier)', () => {
    const data = { deliveryId: 'd-1', userId: 'u-1', stageIndex: 0 };
    const out = injectTraceCarrier(data);
    expect(out).toBe(data); // same reference → job data byte-identical
    expect(out).not.toHaveProperty('_carrier');
  });

  it('withJobSpan runs the handler directly (no span wrapper)', async () => {
    const fn = jest.fn().mockResolvedValue('done');
    await expect(withJobSpan('stage', undefined, fn)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('withJobSpan propagates handler errors unchanged', async () => {
    const boom = new Error('boom');
    await expect(
      withJobSpan('stage', undefined, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it('activeTraceId is undefined and shutdownTracing is a no-op', async () => {
    expect(activeTraceId()).toBeUndefined();
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});

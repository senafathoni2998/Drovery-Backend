import { deliveryShard, fnv1a32, shardedTrackingChannel } from './shard-key';

describe('fnv1a32', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a32('delivery-abc')).toBe(fnv1a32('delivery-abc'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('some-delivery-id-1234');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('matches the known FNV-1a vector for the empty string (offset basis)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('produces different hashes for different inputs (no trivial collision)', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });
});

describe('deliveryShard', () => {
  it('always returns shard 0 when shardCount is 1 (default, inert)', () => {
    for (const id of ['a', 'b', 'c', 'delivery-xyz', 'd-9999']) {
      expect(deliveryShard(id, 1)).toBe(0);
    }
  });

  it('is stable across calls (worker-publish and api-subscribe must agree)', () => {
    const id = 'd-cross-process-42';
    expect(deliveryShard(id, 8)).toBe(deliveryShard(id, 8));
  });

  it('keeps every shard index inside [0, shardCount)', () => {
    const shardCount = 16;
    for (let i = 0; i < 1000; i++) {
      const s = deliveryShard(`d-${i}`, shardCount);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(shardCount);
    }
  });

  it('distributes roughly evenly across shards (no hot shard)', () => {
    const shardCount = 8;
    const counts = new Array(shardCount).fill(0);
    const N = 80_000;
    for (let i = 0; i < N; i++)
      counts[deliveryShard(`delivery-${i}`, shardCount)]++;
    const expected = N / shardCount;
    // Each shard within ±15% of the even split — generous but catches a broken hash.
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.85);
      expect(c).toBeLessThan(expected * 1.15);
    }
  });

  it('throws on a non-positive or non-integer shardCount (fail loud, never silent)', () => {
    expect(() => deliveryShard('d-1', 0)).toThrow();
    expect(() => deliveryShard('d-1', -1)).toThrow();
    expect(() => deliveryShard('d-1', 2.5)).toThrow();
  });
});

describe('shardedTrackingChannel', () => {
  it('returns the LEGACY unsharded channel when shardCount is 1 (contract preserved)', () => {
    expect(shardedTrackingChannel('d-1', 1)).toBe('delivery:d-1:update');
  });

  it('prefixes the shard when shardCount > 1', () => {
    const ch = shardedTrackingChannel('d-1', 8);
    expect(ch).toMatch(/^s[0-7]:delivery:d-1:update$/);
  });

  it('keeps the same id on the same shard channel across calls', () => {
    expect(shardedTrackingChannel('d-stable', 8)).toBe(
      shardedTrackingChannel('d-stable', 8),
    );
  });
});

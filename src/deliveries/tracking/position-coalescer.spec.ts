import { PositionCoalescer } from './position-coalescer';

const pos = (deliveryId: string, droneLat: number) => ({
  deliveryId,
  droneLat,
});
const status = (deliveryId: string, s: string) => ({ deliveryId, status: s });

describe('PositionCoalescer', () => {
  it('is pass-through when Hz <= 0 (default off): every frame publishes immediately', () => {
    const sink = jest.fn();
    const c = new PositionCoalescer(sink, 0);
    expect(c.active).toBe(false);
    c.submit(pos('d1', 1));
    c.submit(pos('d1', 2));
    expect(sink).toHaveBeenCalledTimes(2);
  });

  describe('coalescing on (fake timers)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('buffers position-only frames and publishes only the LATEST per delivery on flush', () => {
      const sink = jest.fn();
      const c = new PositionCoalescer(sink, 1); // 1 Hz → flush every 1000ms

      c.submit(pos('d1', 1));
      c.submit(pos('d1', 2));
      c.submit(pos('d1', 3));
      expect(sink).not.toHaveBeenCalled(); // buffered, not yet flushed

      jest.advanceTimersByTime(1000);
      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(pos('d1', 3)); // latest wins
    });

    it('keeps a separate buffer per delivery', () => {
      const sink = jest.fn();
      const c = new PositionCoalescer(sink, 1);
      c.submit(pos('d1', 1));
      c.submit(pos('d2', 9));
      jest.advanceTimersByTime(1000);
      expect(sink).toHaveBeenCalledTimes(2);
    });

    it('publishes a STATUS transition IMMEDIATELY and supersedes a buffered position', () => {
      const sink = jest.fn();
      const c = new PositionCoalescer(sink, 1);

      c.submit(pos('d1', 1)); // buffered
      c.submit(status('d1', 'DELIVERED')); // immediate, drops the buffered position

      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(status('d1', 'DELIVERED'));

      jest.advanceTimersByTime(1000);
      expect(sink).toHaveBeenCalledTimes(1); // the buffered position was dropped
    });

    it('stop() flushes the pending buffer and clears the timer', () => {
      const sink = jest.fn();
      const c = new PositionCoalescer(sink, 1);
      c.submit(pos('d1', 5));

      c.stop();
      expect(sink).toHaveBeenCalledWith(pos('d1', 5));

      jest.advanceTimersByTime(5000);
      expect(sink).toHaveBeenCalledTimes(1); // timer cleared → no further flush
    });
  });
});

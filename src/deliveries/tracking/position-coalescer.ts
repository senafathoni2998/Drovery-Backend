import type { TrackingUpdatePayload } from './tracking.publisher';
import { POSITION_PUSH_HZ } from './realtime.constants';

type Sink = (payload: TrackingUpdatePayload) => void;

/**
 * Caps the per-delivery position-publish rate to POSITION_PUSH_HZ, independent of how
 * fast frames arrive (a 10 Hz LIVE drone collapses to the configured rate). Pure +
 * Redis-free so it unit-tests with fake timers.
 *
 * - A POSITION-ONLY frame is buffered, latest-wins per delivery, flushed on the timer.
 * - A frame carrying a `status` TRANSITION publishes IMMEDIATELY (a discrete transition
 *   must never be delayed or dropped) and supersedes any buffered position for that
 *   delivery (so a stale buffered frame can't land AFTER the transition).
 * - POSITION_PUSH_HZ = 0 (default) → pass-through: every frame publishes immediately,
 *   no buffering, byte-identical to not having a coalescer at all.
 */
export class PositionCoalescer {
  private readonly buffer = new Map<string, TrackingUpdatePayload>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly intervalMs: number;

  constructor(
    private readonly sink: Sink,
    hz: number = POSITION_PUSH_HZ,
  ) {
    this.intervalMs = hz > 0 ? Math.max(1, Math.round(1000 / hz)) : 0;
  }

  /** Whether coalescing is on (Hz > 0). Off ⇒ pure pass-through. */
  get active(): boolean {
    return this.intervalMs > 0;
  }

  submit(payload: TrackingUpdatePayload): void {
    if (!this.active || payload.status !== undefined) {
      this.buffer.delete(payload.deliveryId);
      this.sink(payload);
      return;
    }
    this.buffer.set(payload.deliveryId, payload);
    this.ensureTimer();
  }

  /** Publishes the buffered latest position of every pending delivery, then clears. */
  flush(): void {
    if (this.buffer.size === 0) return;
    const pending = [...this.buffer.values()];
    this.buffer.clear();
    for (const p of pending) this.sink(p);
  }

  /** Flush + tear down the timer (call on shutdown). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.flush();
  }

  private ensureTimer(): void {
    if (this.timer || !this.active) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    // Never keep the process alive just for the flush timer.
    this.timer.unref?.();
  }
}

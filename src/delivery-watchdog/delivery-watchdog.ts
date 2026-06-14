import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryFailureReason,
  DroneCommandStatus,
  DroneCommandType,
  TrackingSource,
} from '@prisma/client';

import { DeliveriesService } from '../deliveries/deliveries.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { COMMAND_RECONCILE_GRACE_MS } from '../deliveries/commands/command.constants';
import {
  WATCHDOG_BATCH,
  WATCHDOG_MIN_AGE_MS,
  WATCHDOG_SILENCE_MS,
  WATCHDOG_STUCK_STATUSES,
} from './watchdog.constants';

/**
 * Self-heals LIVE deliveries stranded mid-flight when their telemetry goes silent:
 * a drone that lost comms (stuck in DRONE_ASSIGNED/PICKUP/IN_TRANSIT) or a return
 * flight that died without a RETURNED frame (stuck in RETURNING). Driven by the
 * repeatable reap scan; multi-replica safe because the actual transition reuses
 * DeliveriesService.failExceptional, whose conditional CAS is single-winner +
 * idempotent (refund + comms run exactly once for the one winner).
 *
 * Scoped to trackingSource=LIVE only: SIMULATED deliveries advance on fixed BullMQ
 * jobs (they legitimately sit in IN_TRANSIT with position ticks, and a queue outage
 * would stop the watchdog too), so reaping them would be pure false-positive.
 */
@Injectable()
export class DeliveryWatchdog {
  private readonly logger = new Logger(DeliveryWatchdog.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly metrics: MetricsService,
  ) {}

  async scanAndReap(): Promise<void> {
    const now = Date.now();
    const staleBefore = new Date(now - WATCHDOG_SILENCE_MS);
    const minAgeBefore = new Date(now - WATCHDOG_MIN_AGE_MS);

    // Candidate read driven by @@index([status]) (the in-motion subset is highly
    // selective — almost every row is terminal). Crucially, silence is gated on the
    // TRACKING row's updatedAt (bumped by every position frame), NOT the delivery's
    // updatedAt (which only moves on a PHASE change). A healthy long-haul flight
    // sits in one phase for many minutes while streaming positions, so gating on
    // delivery.updatedAt would make every such flight a permanent candidate and
    // could crowd a genuinely-silent delivery out of the bounded batch (and out of
    // the asc ordering), silently defeating the reaper. Gate AND order on the same
    // signal the per-row decision uses, with a fallback to the delivery row only
    // when no tracking row exists yet. The tracking row is reached per-candidate via
    // its deliveryId @unique index, so this stays an O(candidates) lookup.
    const candidates = await this.prisma.delivery.findMany({
      where: {
        status: { in: WATCHDOG_STUCK_STATUSES },
        trackingSource: TrackingSource.LIVE,
        createdAt: { lt: minAgeBefore },
        OR: [
          { tracking: { is: { updatedAt: { lt: staleBefore } } } },
          { tracking: { is: null }, updatedAt: { lt: staleBefore } },
        ],
      },
      select: {
        id: true,
        status: true,
        failureReason: true,
        updatedAt: true,
        tracking: { select: { updatedAt: true } },
      },
      orderBy: [{ tracking: { updatedAt: 'asc' } }, { updatedAt: 'asc' }],
      take: WATCHDOG_BATCH,
    });

    for (const d of candidates) {
      // Last telemetry of ANY kind (position or status); fall back to the delivery
      // row when no tracking row exists yet. The SQL gate already enforced this is
      // stale, but re-check defensively (a frame may have landed since the read).
      const lastTelemetry = d.tracking?.updatedAt ?? d.updatedAt;
      if (lastTelemetry.getTime() >= now - WATCHDOG_SILENCE_MS) continue; // fresh → healthy

      try {
        // The read is advisory; failExceptional's CAS is authoritative — a real
        // RETURNED/telemetry frame that landed first moves the row out of a FAILABLE
        // state, so this no-ops (count 0). Preserve a reason already stamped at the
        // abort (e.g. WEATHER_ABORT on a RETURNING row) rather than overwriting it;
        // default to MECHANICAL for a reasonless stuck row. Both are drone-fault
        // reasons → the customer is refunded (correct for lost-comms / stuck).
        const reason = d.failureReason ?? DeliveryFailureReason.MECHANICAL;
        const applied = await this.deliveries.failExceptional(d.id, reason);
        if (applied) {
          this.metrics.watchdogReapedTotal.inc({ status: d.status });
          this.logger.log(
            `watchdog: reaped stuck ${d.status} delivery ${d.id} as ${reason} (no telemetry for > ${WATCHDOG_SILENCE_MS}ms)`,
          );
        }
      } catch (e) {
        // One bad row must never fail the whole tick (BullMQ would retry the scan
        // and re-process everything).
        this.logger.warn(
          `watchdog ${d.id}: reap failed: ${(e as Error).message}`,
        );
      }
    }

    // Housekeeping: expire stale drone commands so the partial-unique "one open
    // command per delivery" slot frees up for a fresh issue. Correctness does NOT
    // depend on this sweep — poll/ack lazily reject an expired command (expiresAt
    // guard) — so this only clears the slot. Isolated so a failure never blocks the
    // heartbeat.
    await this.expireStaleCommands();

    // Self-heal a command that was ACKED (claim won) but whose delivery transition
    // never landed (a crash between the claim and the transition). Re-drives the
    // operator's chosen type+reason via the idempotent CAS, so the operator's intent
    // isn't silently lost or later misattributed as a MECHANICAL telemetry-reap.
    await this.reconcileStrandedAcks();

    // Heartbeat: stamp last-completed-scan AFTER the loop (not in a finally), so a
    // persistently-failing candidate read leaves the gauge stale and an alert
    // (`time() - drovery_watchdog_last_scan_timestamp_seconds > N`) fires. A partial
    // tick (isolated per-row failures) still completes the scan and advances it.
    this.metrics.watchdogLastScan.set(Date.now() / 1000);
  }

  /** Flip open (PENDING|FETCHED) drone commands past their TTL to EXPIRED. */
  private async expireStaleCommands(): Promise<void> {
    try {
      const now = new Date();
      const where = {
        status: {
          in: [DroneCommandStatus.PENDING, DroneCommandStatus.FETCHED],
        },
        expiresAt: { lt: now },
      };
      // Count per type BEFORE flipping so the metric keeps a real DroneCommandType
      // label (never a synthetic aggregate) — keeps `type` a clean partition.
      const groups = await this.prisma.droneCommand.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
      });
      if (groups.length === 0) return;
      await this.prisma.droneCommand.updateMany({
        where,
        data: { status: DroneCommandStatus.EXPIRED },
      });
      let total = 0;
      for (const g of groups) {
        this.metrics.droneCommandsTotal.inc(
          { type: g.type, result: 'expired' },
          g._count._all,
        );
        total += g._count._all;
      }
      this.logger.log(`watchdog: expired ${total} stale drone commands`);
    } catch (e) {
      this.logger.warn(
        `watchdog: command expiry sweep failed: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Re-drive commands stranded ACKED-but-untransitioned past the grace window (a
   * crash between the ack claim and the delivery transition). The mapped transition
   * is an idempotent single-winner CAS, so re-running is safe; on success the row is
   * marked appliedTransition, otherwise it's resolved to REJECTED (the delivery
   * already left the commandable set) so it leaves the reconcile set.
   */
  private async reconcileStrandedAcks(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - COMMAND_RECONCILE_GRACE_MS);
      const stranded = await this.prisma.droneCommand.findMany({
        where: {
          status: DroneCommandStatus.ACKED,
          appliedTransition: false,
          ackedAt: { lt: cutoff },
        },
        select: { id: true, deliveryId: true, type: true, reason: true },
        take: WATCHDOG_BATCH,
      });
      for (const c of stranded) {
        try {
          const applied =
            c.type === DroneCommandType.RETURN_TO_BASE
              ? await this.deliveries.beginReturnToBase(c.deliveryId, c.reason)
              : await this.deliveries.failExceptional(c.deliveryId, c.reason);
          await this.prisma.droneCommand.update({
            where: { id: c.id },
            data: applied
              ? { appliedTransition: true }
              : {
                  status: DroneCommandStatus.REJECTED,
                  resultNote: 'reconciled: delivery already settled',
                },
          });
          this.logger.log(
            `watchdog: reconciled stranded ${c.type} command ${c.id} for delivery ${c.deliveryId} (applied=${applied})`,
          );
        } catch (e) {
          this.logger.warn(
            `watchdog: reconcile of command ${c.id} failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `watchdog: stranded-ack reconcile failed: ${(e as Error).message}`,
      );
    }
  }
}

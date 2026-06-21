import { Injectable, Logger } from '@nestjs/common';
import { RecurringDelivery } from '@prisma/client';

import { serviceTz } from '../deliveries/delivery-schedule';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { CreateDeliveryDto } from '../deliveries/dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  LOOKAHEAD_MS,
  MAX_CURSOR_ADVANCES,
  MISSED_GRACE_MS,
  SCAN_BATCH,
} from './recurring.constants';
import { RecurrenceRule, computeNextOccurrence } from './recurrence';

/** The service-tz calendar date of `instant` as YYYY-MM-DD (en-CA renders ISO). */
function serviceDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Turns due recurring schedules into concrete deliveries. Runs in the worker tier
 * (driven by the repeatable scan job). Multi-replica safe: each occurrence is
 * claimed with an atomic compare-and-set on the `nextRunAt` cursor, so only one
 * worker materializes it.
 */
@Injectable()
export class RecurringMaterializer {
  private readonly logger = new Logger(RecurringMaterializer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
  ) {}

  async scanAndMaterialize(): Promise<void> {
    const now = new Date();
    const horizon = new Date(now.getTime() + LOOKAHEAD_MS);

    const due = await this.prisma.recurringDelivery.findMany({
      where: { active: true, nextRunAt: { not: null, lte: horizon } },
      orderBy: { nextRunAt: 'asc' },
      take: SCAN_BATCH,
    });

    for (const schedule of due) {
      try {
        await this.materializeSchedule(schedule, now, horizon);
      } catch (e) {
        // One bad schedule must never fail the whole tick (which would make
        // BullMQ retry the entire scan and re-process everything).
        this.logger.warn(
          `recurring ${schedule.id}: scan failed: ${(e as Error).message}`,
        );
      }
    }
  }

  private async materializeSchedule(
    schedule: RecurringDelivery,
    now: Date,
    horizon: Date,
  ): Promise<void> {
    const rule = this.toRule(schedule);
    const tz = serviceTz();
    let cursor: Date | null = schedule.nextRunAt;

    for (let i = 0; i < MAX_CURSOR_ADVANCES; i++) {
      if (!cursor || cursor.getTime() > horizon.getTime()) return;

      const missed = cursor.getTime() < now.getTime() - MISSED_GRACE_MS;
      // On a missed occurrence, jump the cursor straight to the next FUTURE
      // occurrence (collapses any downtime backlog to one hop — no flood).
      const advanceTo = missed
        ? computeNextOccurrence(rule, now, tz)
        : computeNextOccurrence(rule, cursor, tz);

      // Atomic claim: only the worker whose read still matches the cursor wins.
      const { count } = await this.prisma.recurringDelivery.updateMany({
        where: { id: schedule.id, active: true, nextRunAt: cursor },
        data: { nextRunAt: advanceTo },
      });
      if (count === 0) return; // lost the race, or paused mid-tick

      const occurrence = cursor;
      cursor = advanceTo;

      if (missed) {
        this.logger.log(
          `recurring ${schedule.id}: skipped missed occurrence ${occurrence.toISOString()}`,
        );
        continue;
      }

      // Materialize. The cursor is ALREADY advanced (at-most-once): create() is
      // non-idempotent (new trackingId + Stripe intent), so a failure/crash here
      // skips this one occurrence rather than risking a duplicate on a retry.
      await this.createInstance(schedule, occurrence, now);
    }
  }

  private async createInstance(
    schedule: RecurringDelivery,
    occurrence: Date,
    now: Date,
  ): Promise<void> {
    try {
      const delivery = await this.deliveries.create(
        schedule.userId,
        this.toCreateDto(schedule, occurrence),
      );
      await this.prisma.recurringDelivery.updateMany({
        where: { id: schedule.id },
        data: { lastMaterializedAt: now, lastDeliveryId: delivery.id },
      });
    } catch (e) {
      // Per-occurrence conditions (weather 503, out-of-area 422, etc.) are not
      // schedule faults — log and move on; the cursor already advanced.
      this.logger.warn(
        `recurring ${schedule.id}: occurrence ${occurrence.toISOString()} create failed: ${(e as Error).message}`,
      );
    }
  }

  private toRule(s: RecurringDelivery): RecurrenceRule {
    return {
      freq: s.freq,
      daysOfWeek: s.daysOfWeek,
      timeOfDay: s.timeOfDay,
      startDate: s.startDate,
      endDate: s.endDate,
    };
  }

  private toCreateDto(
    s: RecurringDelivery,
    occurrence: Date,
  ): CreateDeliveryDto {
    return {
      fromAddress: s.fromAddress,
      toAddress: s.toAddress,
      receiver: s.receiver,
      packages: s.packages,
      packageSize: s.packageSize,
      packageWeight: s.packageWeight,
      packageTypes: s.packageTypes,
      // pickupDate + pickupTime round-trip through create()'s computeScheduledFor
      // back to `occurrence` (so the kickoff fires at the exact instant).
      pickupDate: serviceDate(occurrence, serviceTz()),
      pickupTime: s.timeOfDay,
      fromLat: s.fromLat ?? undefined,
      fromLng: s.fromLng ?? undefined,
      toLat: s.toLat ?? undefined,
      toLng: s.toLng ?? undefined,
    };
  }
}

import { Injectable, Logger, Optional } from '@nestjs/common';

import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AIRSPACE_CACHE_TTL_MS,
  isZoneInForce,
  ZoneInForceInput,
} from './airspace.constants';
import { GeoCircle } from './serviceability.types';

/** A cached row: the geometry the checker needs, plus the columns "in force" is decided from. */
type ZoneRow = GeoCircle & ZoneInForceInput;

/**
 * Restricted airspace, read from the database.
 *
 * This service deliberately does NOT decide what a failure means — it throws, and
 * `ServiceabilityService` turns that into a hard block. Keeping the policy at the
 * caller is what makes the fail-closed decision visible next to the fail-OPEN weather
 * check it deliberately contradicts.
 */
@Injectable()
export class AirspaceService {
  private readonly logger = new Logger(AirspaceService.name);
  // ROWS, not the filtered answer. See the comment in `inForceZones` — this distinction
  // is the difference between the TTL bounding write visibility and the TTL blurring the
  // clock, and only one of those is acceptable on a fail-closed surface.
  private cache: { at: number; rows: ZoneRow[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // @Optional so the DB-backed spec can construct this service directly, and so a
    // context without MetricsModule still boots. Observability must never be the reason
    // an airspace read fails.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Zones in force at `now`: switched on AND inside their time window.
   *
   * The DATABASE READ is cached; the WINDOW IS NOT. The filter runs on every call,
   * against the caller's `now`, over whatever rows the cache holds. Caching the filtered
   * list instead — the shape this started as — evaluates the window once per fill, so a
   * zone entering force by the clock (a pre-staged TFR: the whole point of having a
   * window) stays unenforced for up to a full TTL on EVERY instance, including the one
   * that created it. That was the only fail-open window in a service written to fail
   * closed. Keep the filter here, after the cache, not inside the fill.
   *
   * Throws if the query fails. A caller that swallows this and proceeds has decided
   * there is no restricted airspace, which is never a safe default.
   */
  async inForceZones(now: Date = new Date()): Promise<GeoCircle[]> {
    const at = now.getTime();
    const cached =
      this.cache &&
      at >= this.cache.at &&
      at - this.cache.at < AIRSPACE_CACHE_TTL_MS
        ? this.cache
        : null;

    const rows = cached ? cached.rows : await this.fetchActiveRows();
    const inForce = rows.filter((z) => isZoneInForce(z, now));

    if (!cached) {
      // Only reached when the query RESOLVED — a throw above leaves the previous cache
      // (or none) untouched, so a failure can never masquerade as empty airspace.
      this.cache = { at, rows };
      // Same reason this sits inside the branch: a failed read must leave the gauge
      // where it was rather than publishing a zero. A stale reading is recoverable; a
      // confident "0 restricted zones" produced by a DB blip is the exact false
      // all-clear the throw above exists to prevent, and it would silence the alert
      // that should be firing.
      this.metrics?.airspaceZonesInForce.set(inForce.length);
    }

    return inForce.map(({ name, lat, lng, radiusKm }) => ({
      name,
      lat,
      lng,
      radiusKm,
    }));
  }

  /** Drop the cache so the next read is authoritative. Called on every zone write. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * `active` is the indexed kill-switch and stays in the WHERE — it is the cheap way to
   * keep every retired TFR out of the result set. The time window stays OUT of SQL: a
   * NOW() comparison evaluated by the database is pinned to the instant of the fill, and
   * the whole point of `inForceZones` is that the window is not.
   *
   * `active` is also SELECTED, despite the WHERE guaranteeing it. `isZoneInForce` is the
   * single definition of in-force and it names `active` as part of that definition; a row
   * that cannot be handed to it is a row that only looks like a zone.
   *
   * Logs and rethrows on failure rather than swallowing it — the caller relies on the
   * throw to fail closed, so this method must never turn a query failure into an
   * empty (and then cached) result.
   */
  private async fetchActiveRows(): Promise<ZoneRow[]> {
    try {
      return await this.prisma.airspaceZone.findMany({
        where: { active: true },
        select: {
          name: true,
          lat: true,
          lng: true,
          radiusKm: true,
          active: true,
          activeFrom: true,
          activeUntil: true,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Airspace zone query failed (${(e as Error).message}) — failing CLOSED, previous cache (if any) left untouched`,
      );
      throw e;
    }
  }
}

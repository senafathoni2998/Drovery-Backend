import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AIRSPACE_CACHE_TTL_MS } from './airspace.constants';
import { GeoCircle } from './serviceability.types';

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
  private cache: { at: number; zones: GeoCircle[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Zones in force at `now`: switched on AND inside their time window.
   *
   * Throws if the query fails. A caller that swallows this and proceeds has decided
   * there is no restricted airspace, which is never a safe default.
   */
  async inForceZones(now: Date = new Date()): Promise<GeoCircle[]> {
    const at = now.getTime();
    if (this.cache && at - this.cache.at < AIRSPACE_CACHE_TTL_MS) {
      return this.cache.zones;
    }

    const rows = await this.fetchActiveRows();

    const zones = rows
      .filter(
        (z) =>
          (z.activeFrom === null || z.activeFrom.getTime() <= at) &&
          (z.activeUntil === null || z.activeUntil.getTime() >= at),
      )
      .map(({ name, lat, lng, radiusKm }) => ({ name, lat, lng, radiusKm }));

    // Only reached when the query resolved — a throw below leaves the previous cache
    // (or none) untouched, so a failure can never masquerade as empty airspace.
    this.cache = { at, zones };
    return zones;
  }

  /** Drop the cache so the next read is authoritative. Called on every zone write. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * `active` is the indexed kill-switch; the window is applied on top, in memory, by
   * the caller. Filtering the window in SQL too would push a NOW() comparison into a
   * query whose result is then cached for 30s, so the precision would be false.
   *
   * Logs and rethrows on failure rather than swallowing it — the caller relies on the
   * throw to fail closed, so this method must never turn a query failure into an
   * empty (and then cached) result.
   */
  private async fetchActiveRows() {
    try {
      return await this.prisma.airspaceZone.findMany({
        where: { active: true },
        select: {
          name: true,
          lat: true,
          lng: true,
          radiusKm: true,
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

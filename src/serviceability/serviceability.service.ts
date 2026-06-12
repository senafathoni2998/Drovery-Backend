import { Injectable, Logger } from '@nestjs/common';

import { EARTH_RADIUS_KM, haversineKm } from '../common/geo-distance';
import { NO_FLY_ZONES, SERVICE_AREAS } from './serviceability.constants';
import {
  GeoCircle,
  RouteSegment,
  ServiceabilityCode,
  ServiceabilityResult,
} from './serviceability.types';
import { WeatherService } from './weather.service';

const TO_RAD = Math.PI / 180;

interface Pt {
  x: number;
  y: number;
}

/**
 * Decides whether a drone delivery can be flown. Two HARD, deterministic checks
 * (service area + no-fly zones — pure geometry, no I/O) and one SOFT check
 * (weather, via WeatherService). Weather is always fail-open and advisory: it
 * can only add a transient WEATHER_* hold, never a hard block, and a weather
 * outage never grounds a delivery.
 *
 * Callers pass already-resolved coordinates (this never geocodes) and only call
 * when all four are present.
 */
@Injectable()
export class ServiceabilityService {
  private readonly logger = new Logger(ServiceabilityService.name);

  constructor(private readonly weather: WeatherService) {}

  async checkServiceability(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ): Promise<ServiceabilityResult> {
    // --- HARD: service area. Short-circuit — if it's out of area there's no
    // point checking no-fly or making a weather call; it's rejected regardless.
    if (
      !this.isInAnyArea(fromLat, fromLng) ||
      !this.isInAnyArea(toLat, toLng)
    ) {
      return this.blocked(
        'OUT_OF_AREA',
        'Pickup or dropoff is outside our service area.',
      );
    }

    // --- HARD: no-fly zones (endpoints + route). Short-circuit. ---
    const zone =
      this.zoneContaining(fromLat, fromLng) ??
      this.zoneContaining(toLat, toLng) ??
      this.zoneOnRoute({ fromLat, fromLng, toLat, toLng });
    if (zone) {
      return this.blocked(
        'NO_FLY_ZONE',
        `Route is restricted near ${zone.name} (no-fly zone).`,
      );
    }

    // --- SOFT: weather (fail-open; never a hard block) ---
    try {
      const [a, b] = await Promise.all([
        this.weather.getConditions(fromLat, fromLng),
        this.weather.getConditions(toLat, toLng),
      ]);
      const grounded = !a.flyable ? a : !b.flyable ? b : null;
      if (grounded) {
        return grounded.condition === 'storm'
          ? this.blocked(
              'WEATHER_STORM',
              'A storm is grounding drones at this location right now.',
            )
          : this.blocked(
              'WEATHER_HOLD',
              `High wind is grounding drones right now (${grounded.windKph} kph).`,
            );
      }
    } catch (e) {
      // Weather is advisory — a failure here must never block a delivery.
      this.logger.warn(
        `Weather check failed (treating as flyable): ${(e as Error).message}`,
      );
    }

    return { serviceable: true, reasons: [], codes: [], weatherHold: false };
  }

  private blocked(
    code: ServiceabilityCode,
    reason: string,
  ): ServiceabilityResult {
    return {
      serviceable: false,
      reasons: [reason],
      codes: [code],
      weatherHold: code.startsWith('WEATHER'),
    };
  }

  // ── geometry ───────────────────────────────────────────────

  private isInAnyArea(lat: number, lng: number): boolean {
    return SERVICE_AREAS.some((a) => this.inCircle(lat, lng, a));
  }

  private zoneContaining(lat: number, lng: number): GeoCircle | undefined {
    return NO_FLY_ZONES.find((z) => this.inCircle(lat, lng, z));
  }

  private inCircle(lat: number, lng: number, c: GeoCircle): boolean {
    return haversineKm(lat, lng, c.lat, c.lng) <= c.radiusKm;
  }

  /** First no-fly zone the straight route passes within radiusKm of. */
  private zoneOnRoute(route: RouteSegment): GeoCircle | undefined {
    return NO_FLY_ZONES.find((z) => this.routeNearCircle(route, z));
  }

  private routeNearCircle(route: RouteSegment, c: GeoCircle): boolean {
    const { fromLat, fromLng, toLat, toLng } = route;
    // Degenerate route → a point.
    if (Math.abs(fromLat - toLat) < 1e-9 && Math.abs(fromLng - toLng) < 1e-9) {
      return haversineKm(fromLat, fromLng, c.lat, c.lng) <= c.radiusKm;
    }
    // Equirectangular projection around the route midpoint (<0.1% error for the
    // short urban routes here) → 2D point-to-segment distance in km.
    const midLat = (fromLat + toLat) / 2;
    const midLng = (fromLng + toLng) / 2;
    const a = this.project(fromLat, fromLng, midLat, midLng);
    const b = this.project(toLat, toLng, midLat, midLng);
    const p = this.project(c.lat, c.lng, midLat, midLng);
    return this.pointToSegmentKm(a, b, p) <= c.radiusKm;
  }

  private project(
    lat: number,
    lng: number,
    centerLat: number,
    centerLng: number,
  ): Pt {
    const cosLat = Math.cos(centerLat * TO_RAD);
    return {
      x: (lng - centerLng) * TO_RAD * EARTH_RADIUS_KM * cosLat,
      y: (lat - centerLat) * TO_RAD * EARTH_RADIUS_KM,
    };
  }

  private pointToSegmentKm(a: Pt, b: Pt, p: Pt): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + t * abx);
    const dy = p.y - (a.y + t * aby);
    return Math.sqrt(dx * dx + dy * dy);
  }
}

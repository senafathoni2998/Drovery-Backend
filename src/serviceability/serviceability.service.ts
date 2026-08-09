import { Injectable, Logger } from '@nestjs/common';

import { EARTH_RADIUS_KM, haversineKm } from '../common/geo-distance';
import { AirspaceService } from './airspace.service';
import { maxRouteKm, SERVICE_AREAS } from './serviceability.constants';
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
 * Decides whether a drone delivery can be flown. Two HARD checks (service area +
 * no-fly zones) and one SOFT check (weather, via WeatherService). Weather is
 * always fail-open and advisory: it can only add a transient WEATHER_* hold,
 * never a hard block, and a weather outage never grounds a delivery.
 *
 * The geometry is still pure, but the no-fly zones it runs against are now read
 * from the database via AirspaceService, so this method does I/O before the
 * weather call — and fails CLOSED on it, unlike weather. See the no-fly block.
 *
 * Callers pass already-resolved coordinates (this never geocodes) and only call
 * when all four are present.
 */
@Injectable()
export class ServiceabilityService {
  private readonly logger = new Logger(ServiceabilityService.name);

  constructor(
    private readonly weather: WeatherService,
    private readonly airspace: AirspaceService,
  ) {}

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

    // --- HARD: route length. A drone has a finite battery, and nothing else in
    // this method knows that: OUT_OF_AREA is satisfied by both endpoints being in
    // SOME area (or by SERVICE_AREA_GLOBAL, which makes it vacuous), so the pair
    // Jakarta → London passed every check above and was quoted and accepted.
    const routeKm = haversineKm(fromLat, fromLng, toLat, toLng);
    const limitKm = maxRouteKm();
    if (routeKm > limitKm) {
      return this.blocked(
        'ROUTE_TOO_LONG',
        `This route is ${routeKm.toFixed(0)} km — beyond our ${limitKm} km flight range.`,
        { routeKm: Math.round(routeKm), maxKm: limitKm },
      );
    }

    // --- HARD: no-fly zones (endpoints + route). Short-circuit. ---
    //
    // FAIL CLOSED, deliberately opposite to the weather check below. Weather is
    // advisory and fails open: an unreachable forecast must not ground the fleet.
    // Airspace is not advisory. If we cannot read the zone list we do not know
    // whether this route crosses restricted airspace, and the only safe answer to
    // "I don't know" is no. Do not "fix" this into consistency with weather.
    let zones: GeoCircle[];
    try {
      zones = await this.airspace.inForceZones();
    } catch (error) {
      this.logger.error(
        `Airspace lookup failed — blocking the route: ${(error as Error).message}`,
      );
      return this.blocked(
        'NO_FLY_ZONE',
        'Restricted airspace could not be verified for this route.',
        { zoneName: 'unverified airspace' },
      );
    }

    // The two endpoint checks are subsumed by the route check — if an endpoint is
    // inside a circle, the segment's distance to that centre is <= the endpoint's,
    // so zoneOnRoute alone would catch it. They are kept because they short-circuit
    // cheaply on the common case and state the intent more clearly, but a reader
    // should know they are not load-bearing on their own: no test can distinguish
    // dropping them, and the route check is what actually guarantees the block.
    const zone =
      this.zoneContaining(fromLat, fromLng, zones) ??
      this.zoneContaining(toLat, toLng, zones) ??
      this.zoneOnRoute({ fromLat, fromLng, toLat, toLng }, zones);
    if (zone) {
      return this.blocked(
        'NO_FLY_ZONE',
        `Route is restricted near ${zone.name} (no-fly zone).`,
        { zoneName: zone.name },
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
              { windKph: grounded.windKph },
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
    params?: Record<string, string | number>,
  ): ServiceabilityResult {
    return {
      serviceable: false,
      reasons: [reason],
      codes: [code],
      weatherHold: code.startsWith('WEATHER'),
      ...(params ? { params } : {}),
    };
  }

  // ── geometry ───────────────────────────────────────────────

  private isInAnyArea(lat: number, lng: number): boolean {
    // GLOBAL mode: SERVICE_AREA_GLOBAL=true treats everywhere as in-area, so any user
    // anywhere can place a delivery. Default (unset) keeps the Jakarta/Bandung hub geofence —
    // the realistic demo behavior. Read at call time so it's runtime-togglable + testable.
    if (process.env.SERVICE_AREA_GLOBAL === 'true') return true;
    return SERVICE_AREAS.some((a) => this.inCircle(lat, lng, a));
  }

  private zoneContaining(
    lat: number,
    lng: number,
    zones: GeoCircle[],
  ): GeoCircle | undefined {
    return zones.find((z) => this.inCircle(lat, lng, z));
  }

  private inCircle(lat: number, lng: number, c: GeoCircle): boolean {
    return haversineKm(lat, lng, c.lat, c.lng) <= c.radiusKm;
  }

  /** First no-fly zone the straight route passes within radiusKm of. */
  private zoneOnRoute(
    route: RouteSegment,
    zones: GeoCircle[],
  ): GeoCircle | undefined {
    return zones.find((z) => this.routeNearCircle(route, z));
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

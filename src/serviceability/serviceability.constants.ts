import { NoFlyZone, ServiceArea } from './serviceability.types';

// Serviceable areas (hub + radius). Covers BOTH Greater Jakarta and Greater
// Bandung — the seeded demo route (DEFAULT_COORDS in simulation.constants.ts) is
// in Bandung, so a Jakarta-only area would reject every demo delivery.
export const SERVICE_AREAS: ServiceArea[] = [
  { name: 'Greater Jakarta', lat: -6.2088, lng: 106.8456, radiusKm: 30 },
  { name: 'Greater Bandung', lat: -6.9125, lng: 107.611, radiusKm: 20 },
];

// Restricted airspace the drone must not fly through. The two Jakarta airports
// are ~110 km from the Bandung demo route, so the demo stays serviceable while
// no-fly is still demonstrable with Jakarta coordinates.
export const NO_FLY_ZONES: NoFlyZone[] = [
  {
    name: 'Soekarno-Hatta International Airport',
    lat: -6.1256,
    lng: 106.6558,
    radiusKm: 5,
  },
  {
    name: 'Halim Perdanakusuma Airport',
    lat: -6.2647,
    lng: 106.9308,
    radiusKm: 3,
  },
];

// Drones are grounded above this wind speed.
export const MAX_WIND_KPH = 40;

/**
 * Hard ceiling on the point-to-point distance of a single delivery, in km.
 *
 * The service-area check alone does not bound this. With SERVICE_AREA_GLOBAL=true
 * every point on earth is "in area", so a Jakarta → London route — roughly 11,000
 * km, several orders of magnitude beyond any battery-electric multirotor — passed
 * serviceability, was priced, and was accepted for dispatch. Even with the geofence
 * ON the two hubs are ~120 km apart, so a Jakarta pickup with a Bandung dropoff was
 * in-area at both ends and still unflyable.
 *
 * This is the physics bound, deliberately separate from per-aircraft feasibility
 * (src/dispatch/flight-feasibility.ts): this one says "no drone we would ever
 * operate can do this", and applies at QUOTE time, before a fleet is consulted.
 * The dispatch engine then applies the tighter, real limit for the specific
 * airframe. Override for a longer-range fleet via MAX_ROUTE_KM.
 */
export const DEFAULT_MAX_ROUTE_KM = 50;

/** Read at call time so it is runtime-togglable + testable, like SERVICE_AREA_GLOBAL. */
export function maxRouteKm(): number {
  const raw = Number(process.env.MAX_ROUTE_KM);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ROUTE_KM;
}

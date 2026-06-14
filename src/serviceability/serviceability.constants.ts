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

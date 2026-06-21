import http from 'k6/http';
import { check, fail } from 'k6';

export const CFG = {
  BASE_URL: __ENV.BASE_URL || 'http://localhost:3000/api/v1',
  EMAIL: __ENV.EMAIL || 'demo@drovery.com',
  PASSWORD: __ENV.PASSWORD || 'demo123',
};

// VU-scoped token cache: log in ONCE per VU, not per iteration. The /auth
// controller is throttled 10/min/IP (Redis-backed, shared across replicas), so
// per-iteration logins from one k6 IP would instantly 429 and starve the test.
let _token = null;

export function getToken() {
  if (_token) return _token;
  const res = http.post(
    `${CFG.BASE_URL}/auth/login`,
    JSON.stringify({ email: CFG.EMAIL, password: CFG.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  // TransformInterceptor envelope: { success, data: { accessToken, ... }, timestamp }
  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'has accessToken': (r) => !!r.json('data.accessToken'),
  });
  if (!ok) fail(`login failed status=${res.status} body=${res.body}`);
  _token = res.json('data.accessToken');
  return _token;
}

export function authHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

// Coords supplied on purpose so the create path SKIPS server-side Nominatim
// geocoding (cold ~840ms, 1 req/sec) — otherwise the test measures the geocoder,
// not the API. packageSize/weight respect MAX_WEIGHT_KG (Small <= 0.5).
export function newDeliveryPayload() {
  return JSON.stringify({
    fromAddress: 'Senayan, Jakarta',
    toAddress: 'Kemang, Jakarta',
    receiver: 'Load Test',
    packages: '1x box',
    packageSize: 'Small',
    packageWeight: 0.4,
    packageTypes: ['document'],
    pickupDate: '2026-06-10',
    pickupTime: '10:00',
    fromLat: -6.2251,
    fromLng: 106.7993,
    toLat: -6.2601,
    toLng: 106.8136,
  });
}

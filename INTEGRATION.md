# Drovery — Backend ↔ Mobile Integration Guide

Drovery is a **two-repo system**:

| Repo | Path | Stack | Role |
|------|------|-------|------|
| **drovery-backend** | `../drovery-backend` | NestJS 11 · Prisma 7 · PostgreSQL · Passport-JWT | REST API served at `http://<host>:3000/api/v1` |
| **drovery-mobile** | `../drovery-mobile` | Expo SDK 54 · React Native 0.81 · expo-router | The app users hold; consumes the API |

> **Product:** a consumer **drone-delivery** app — request a package flown from A → B, get a price estimate, pay with a saved card, and track the drone through its lifecycle. At pickup/dropoff an operator runs a QR-guided load/unload workflow.

This document is the **source of truth for how the two repos talk to each other**. Keep it updated when an endpoint or its shape changes.

---

## 1. The wire: base URL, prefix, ports

- Backend global prefix is **`api/v1`** (`src/main.ts` → `app.setGlobalPrefix`), listening on **port `3000`** (`PORT` in `.env`).
- Mobile base URL comes from `config/env.ts` → `ENV.API_URL`, which **must include the `/api/v1` suffix**. Every call is `` `${ENV.API_URL}${path}` ``.
- CORS on the backend is `origin: '*'` — irrelevant for the native app (no CORS), but note it is combined with `credentials: true`, which browsers reject (would break a web build).

### Pointing the app at the backend (the #1 setup gotcha)

> ⚠️ **Expo only inlines env vars prefixed with `EXPO_PUBLIC_`.** A plain `API_URL` in `.env` is **silently ignored** at runtime. The mobile config (`config/env.ts`) reads `process.env.EXPO_PUBLIC_API_URL`, falling back to a hardcoded `LAN_IP` default.

Set `EXPO_PUBLIC_API_URL` in `drovery-mobile/.env` to match where the app runs:

| App runs on | `EXPO_PUBLIC_API_URL` |
|---|---|
| **Physical device** (Expo Go) | `http://<your-dev-machine-LAN-IP>:3000/api/v1` |
| **Android emulator** | `http://10.0.2.2:3000/api/v1` |
| **iOS simulator / web** | `http://localhost:3000/api/v1` |

The device and your laptop must be on the **same Wi-Fi / subnet**.

---

## 2. Auth & token lifecycle

JWT, **binary** (no roles). A global `JwtAuthGuard` (`APP_GUARD`) protects every route unless decorated `@Public()`.

**Public routes:** `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `POST /pricing/estimate`, `GET /support/faq`.

End-to-end flow (mobile side in `contexts/AuthContext.tsx` + `services/api/apiClient.ts` + `services/api/tokenStorage.ts`):

1. **Login / Signup** → backend returns `{ user, accessToken (15m), refreshToken (7d) }`.
2. Mobile persists **both tokens in `expo-secure-store`** (keys `drovery_access_token` / `drovery_refresh_token`), then calls `GET /users/me` to hydrate the full profile into `AuthContext`.
3. Every authed request injects `Authorization: Bearer <accessToken>` (unless `skipAuth`).
4. On a **401**, `apiClient` single-flights `POST /auth/refresh` with the stored refresh token, saves the new pair, and **retries the original request once**.
5. If refresh fails → `clearTokens()` + `onLogout()` → app returns to the login screen.

> **Logout is local-only.** There is no backend revocation endpoint and refresh tokens are stateless, so an issued refresh token stays valid until its natural 7-day expiry. (See "Recommended next steps".)

---

## 3. Response envelope (the contract both sides depend on)

**Success** — every controller return value is wrapped by `TransformInterceptor`:

```json
{ "success": true, "data": <controller return value>, "timestamp": "<ISO>" }
```

The mobile `apiClient` transparently unwraps this: `json.data !== undefined ? json.data : json`. A `204` returns no body (`undefined`).

There is **no pagination `meta`** — a paginated handler returns `{ items, total, page, limit }` directly under `data`, and the mobile `PaginatedResponse<T>` type mirrors that exact shape.

**Error** — produced by `AllExceptionsFilter` (flat, **not** wrapped):

```json
{ "statusCode": 400, "timestamp": "<ISO>", "path": "/api/v1/...", "message": ["..."], "error": "Bad Request" }
```

`apiClient` throws `ApiError(status, body)`; network/timeout failures throw `ApiError(0, ...)`.

---

## 4. Endpoint ↔ mobile-action map

All paths are relative to `…/api/v1`. "Public" = mobile sends `skipAuth`.

| Mobile screen / call | Method + Path | Auth | Purpose |
|---|---|---|---|
| Login (AuthContext) | `POST /auth/login` | public | `{email,password}` → `{user,accessToken,refreshToken}` |
| Signup (AuthContext) | `POST /auth/signup` | public | `{name,email,password}` → AuthResponse |
| apiClient on 401 | `POST /auth/refresh` | public | `{refreshToken}` → new token pair |
| Hydrate / EditProfile read | `GET /users/me` | jwt | full user |
| EditProfile save | `PATCH /users/me` | jwt | `{name?,phone?,address?,bio?}` |
| Profile stats | `GET /users/me/stats` | jwt | `{total,active,completed}` |
| **Confirmation screen** | `POST /deliveries` | jwt | the real "create delivery" |
| Orders list | `GET /deliveries?status&q&sort&page&limit` | jwt | `PaginatedResponse<Delivery>` |
| Home — active | `GET /deliveries/active` | jwt | `Delivery[]` |
| Home — recent | `GET /deliveries/recent` | jwt | `Delivery[]` |
| Detail / Track-on-map | `GET /deliveries/{id}` | jwt | single Delivery (embeds tracking/workflowSteps/payment) |
| Track package | `GET /deliveries/track?trackingId=` | jwt | lookup by human tracking ID |
| Delivery detail (Cancel button) | `POST /deliveries/{id}/cancel` | jwt | cancel (PENDING/CONFIRMED only) |
| Recipient handoff (enter code) | `POST /deliveries/{id}/confirm-handoff` | jwt | confirm OTP → DELIVERED + proof (see §5) |
| Rate a delivery | `POST /deliveries/{id}/rating`, `GET /deliveries/{id}/rating` | jwt | 1–5 stars + comment (DELIVERED only, owner-scoped, upsert); embedded in `GET /deliveries/{id}` |
| Address book | `GET/POST /addresses`, `GET/PATCH/DELETE /addresses/{id}`, `POST /addresses/{id}/default`, `GET /addresses/recent` | jwt | saved addresses (default first, geocoded on save) + recent-from-history |
| Price estimation / Confirmation | `POST /pricing/estimate` | public | fee breakdown + `serviceability` block (see §5) |
| Workflow step | `POST /workflows/{deliveryId}/steps/complete` | jwt | record completed step |
| QR scanner | `POST /workflows/qr/validate` | jwt | `{payload}` → `{valid,deliveryId?,reason?}` (HMAC-signed, 5-min expiry) |
| Push registration (after login) | `POST /notifications/devices` | jwt | `{pushToken,platform}` → registers Expo token |
| Payment methods | `GET/POST /payment-methods`, `DELETE /payment-methods/{id}`, `PATCH /payment-methods/{id}/default` | jwt | saved-card CRUD |
| Add card (Stripe PaymentSheet) | `POST /payment-methods/setup-intent`, `POST /payment-methods/sync` | jwt | SetupIntent+ephemeral key for native card entry, then reconcile |
| (Stripe → server) | `POST /payments/webhook` | public (signed) | PaymentIntent events drive `Payment.status` |
| Delivery detail (proof card) | `GET /deliveries/{id}/proof`, `POST /deliveries/{id}/proof` | jwt | view / submit proof of delivery (also embedded in `GET /deliveries/{id}`) |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/{id}/read`, `PATCH /notifications/read-all` | jwt | in-app notifications |
| Help & support | `GET /support/faq` (public), `GET/POST /support/tickets` (jwt) | mixed | FAQ + persisted tickets |

**Still defined but not yet called by a screen:** all `GET /workflows*` (workflow content is read from local static data) and the backend `geo` endpoints (the app geocodes directly against Nominatim; the backend also geocodes on create).

---

## 5. Delivery lifecycle & real-time tracking

`DeliveryStatus`: `PENDING → CONFIRMED → DRONE_ASSIGNED → PICKUP_IN_PROGRESS → IN_TRANSIT → AWAITING_HANDOFF → DELIVERED` (or `CANCELED`).

On create, the backend geocodes the addresses (if coords weren't supplied), then enqueues the lifecycle as **durable BullMQ jobs in Redis** (no longer in-process `setTimeout`). A worker (`SimulationProcessor`) auto-advances status (`CONFIRMED@10s, DRONE_ASSIGNED@25s, PICKUP@45s, IN_TRANSIT@70s, AWAITING_HANDOFF@120s`), **interpolates the drone position every 5s** along the route, upserts `DeliveryTracking`, and writes + pushes a `Notification` on each transition. **The simulation never auto-delivers** — it stops at `AWAITING_HANDOFF` (the drone has arrived). **Survives restarts and scales across instances.** *(Redis is now required to run the backend — see ARCHITECTURE.md §1.)*

### Recipient handoff OTP

`create` returns a 6-digit **`handoffCode`** (once; only its SHA-256 hash is stored). The drone finalizes as `DELIVERED` — and proof of delivery is recorded — only when the recipient's code is confirmed:

`POST /deliveries/{id}/confirm-handoff` (jwt, owner-scoped), body `{ "code": "123456" }` →
- **200** + the updated (`DELIVERED`) delivery with `proofOfDelivery`.
- **401** wrong code (attempt counter increments), **423** after 5 wrong (locked), **409** if not `AWAITING_HANDOFF` / already done, **400** bad format, **404** not owner.

`handoffCodeHash` and `handoffAttempts` are never returned by any read. *(Real-world: the recipient gets the code out-of-band; in this single-user demo the sender receives it on create and relays it.)*

### Serviceability (no-fly / weather / service area)

Drone deliveries are gated on "can we actually fly this?" — checked at quote and enforced at create:

- **Quote** (`POST /pricing/estimate`, public, always 200): when all four coordinates resolve, the response `data.serviceability` = `{ serviceable, reasons[], codes[], weatherHold }` (advisory — show it before the user pays). `codes` ∈ `OUT_OF_AREA | NO_FLY_ZONE | WEATHER_HOLD | WEATHER_STORM`.
- **Create** (`POST /deliveries`) rejects an unflyable route **before** any charge/queue: **422** `OUT_OF_AREA` / `NO_FLY_ZONE` (non-retryable), **422** `UNRESOLVED_LOCATION` (couldn't locate pickup/dropoff), **503** + `retryAfter` for a weather hold (retryable). Service area covers Greater Jakarta + Bandung; no-fly zones are the Jakarta airports. Weather is real-or-mock (`OPENWEATHER_API_KEY`) and **fail-open** — an outage never grounds a delivery.

> **Tracking is live via polling.** `useDeliveryTracking` polls `GET /deliveries/{id}` every 4s while the delivery is active and **animates the drone marker** (`AnimatedRegion`) so it glides between positions; polling stops at a terminal status. On each detected status change the app fires a **local notification**, and the backend sends a **remote Expo push** to registered devices. The in-memory simulation still means a backend restart strands in-flight deliveries — see **[ARCHITECTURE.md](./ARCHITECTURE.md) §1** for the durable worker-tier fix (the #1 scaling blocker), and a true WebSocket upgrade path in §3.

---

## 6. Data model (core entities)

`User` 1─N `Delivery` 1─1 `DeliveryTracking` · `Delivery` 1─N `WorkflowStepCompletion` · `Delivery` 1─1 `Payment` · `User` 1─N `PaymentMethod` / `Device` / `Notification`. All FKs are `ON DELETE CASCADE`. (Full schema in `prisma/schema.prisma`.)

**Seeded demo account** (`prisma/seed.ts`, idempotent): **`demo@drovery.com` / `demo123`**, with 6 deliveries (incl. `DRV-11324572` IN_TRANSIT, `DRV-11324578` PICKUP_IN_PROGRESS) and 2 mock cards.

---

## 7. Run both locally

**Backend** (`drovery-backend`):
```bash
npm install
npm run prisma:generate
npm run prisma:migrate      # applies migrations
npm run prisma:seed         # creates demo@drovery.com / demo123
npm run start:dev           # http://localhost:3000/api/v1
```
Ensure `.env` has a reachable `DATABASE_URL` and non-default `JWT_SECRET` / `JWT_REFRESH_SECRET`.

**Mobile** (`drovery-mobile`):
```bash
npm install
# set EXPO_PUBLIC_API_URL in .env to your backend (see §1 table)
npm start                   # expo start
```
Log in with `demo@drovery.com` / `demo123`.

**Smoke test the contract** without the app:
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@drovery.com","password":"demo123"}'
```

---

## 8. Status of known gaps

**Fixed (this round):** live drone tracking (polling + animated marker), status-change notifications (local + remote Expo push + device registration), **geocode-on-create**, **Cancel delivery** UI, **persisted support tickets**, **HMAC-signed QR** with expiry, **distance-based pricing**, **password reset**, **real Stripe payments** (PaymentIntent on create + signature-verified `POST /payments/webhook`, real when `STRIPE_SECRET_KEY` is set, deterministic mock otherwise; mobile shows payment status), and **proof of delivery** (auto-recorded on `DELIVERED` with photo + final GPS; `StorageService` is real-or-mock; mobile shows a proof card).

**Also done since:** durable BullMQ/Redis simulation + standalone worker, Redis geocode cache, email verification, native Stripe PaymentSheet, real proof-photo capture, and a **security pass** — refresh-token rotation + revocation + real `POST /auth/logout`, rate limiting (`@nestjs/throttler`), owner-scoped `GET /deliveries/track`, prod weak-secret boot guard, and a CORS allowlist (`CORS_ORIGINS`).

**Still open:**
- **Provider go-live** — set the keys to flip mocks to real: `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` + `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (payments), `MAIL_PROVIDER` (email), `STORAGE_PROVIDER` (proof photos), `EXPO_ACCESS_TOKEN` (push).
- Observability (logs/metrics/Sentry/alerts); PgBouncer/read replicas; realtime tier to replace polling. (See ARCHITECTURE.md.)
- Dead mobile code (`features/auth/services/authService.ts`, `authApi.ts`).

➡️ **Feature priorities:** see **[ROADMAP.md](./ROADMAP.md)**. **Scaling to 100k+ users:** see **[ARCHITECTURE.md](./ARCHITECTURE.md)** (the in-memory simulation is the #1 blocker).

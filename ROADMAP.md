# Drovery — Feature Recommendations

Prioritized advice on **what to build next**, grounded in what exists today. Ordered by
impact-to-effort. ✅ = already added in the latest round of work.

## ✅ Just shipped (this round)
- **Live drone tracking** — backend simulates a moving drone; mobile polls every 4s and the marker **glides** between positions with a LIVE badge.
- **Status-change notifications** — in-app + local banner on each change, and **remote Expo push** to registered devices.
- **Cancel delivery** UI wired to the existing endpoint.
- **Geocode-on-create** — real pickup/dropoff coordinates → a real flight path.
- **Support tickets persisted** + signed (HMAC + expiry) QR codes.
- **✅ Distance-based pricing (P0)** — `PricingService` now adds a haversine `distanceFee` ($1.50/km) from coords or geocoded addresses; `DeliveriesService` delegates to it so the quote and the stored price always agree. Mobile sends the addresses and shows a distance line.
- **✅ Password reset (P0)** — `POST /auth/forgot-password` + `/auth/reset-password` with hashed, single-use, 1-hour tokens (no email enumeration). Email send is behind `MailService` (logs the link in dev; swap in SendGrid/SES). Mobile has Forgot/Reset Password screens + a wired "Forgot password?" link, with deep-link token prefill.
- **✅ Real Stripe payments (P0)** — `StripeService` uses the live Stripe SDK when `STRIPE_SECRET_KEY` is set and a deterministic **mock** otherwise. Creating a delivery creates a **PaymentIntent** + a `Payment` row (idempotent); `POST /payments/webhook` verifies the signature and drives `Payment.status`.
- **✅ Native Stripe card entry** — backend mints a Customer + **SetupIntent + ephemeral key** (`POST /payment-methods/setup-intent`) and reconciles saved cards (`POST /payment-methods/sync`), real-or-mock. Mobile uses **`@stripe/stripe-react-native`'s PaymentSheet** (gated behind `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`; falls back to the manual form). *Requires a dev build + Stripe keys to exercise the native sheet.*
- **✅ Proof of delivery (P0)** — on `DELIVERED` the simulation auto-records a `ProofOfDelivery` (photo + final GPS + recipient + timestamp); `POST/GET /deliveries/:id/proof` lets the owner submit/view one. Image storage is behind `StorageService` (inline data URL / placeholder in dev; S3/Cloudinary when configured). Mobile shows a proof card on the delivery detail **and can capture a real photo** (expo-camera + current GPS → upload, replacing the placeholder).
- **✅ Security hardening** — refresh-token rotation + revocation (hashed store, `jti`, reuse → 401, logout endpoint), per-IP rate limiting (`@nestjs/throttler`, tighter on `/auth`), weak-JWT-secret boot guard in production, owner-scoped tracking lookups, and a CORS allowlist (`CORS_ORIGINS`). All verified live.
- **✅ Observability** — structured JSON logging (`nestjs-pino`) with per-request correlation ids (`X-Request-Id`, echoed back + propagated to logs) and auth-header redaction; **health probes**: `GET /health` (liveness) + `GET /health/ready` (checks DB + Redis, returns **503** when a dependency is down). Public, un-throttled, k8s-ready. **Sentry error tracking** (`@sentry/node`, DSN-gated no-op) reports unhandled 5xx from the global exception filter in both the API and worker. **Prometheus `GET /api/v1/metrics`** (`prom-client`): default Node metrics, an HTTP histogram labelled by route *template* (cardinality-safe), and a `drovery_queue_jobs{queue,state}` gauge from BullMQ — the worker also serves it at `:9091/metrics`.
- **✅ Horizontal scaling + containers** — multi-instance-safe (Redis-backed rate limiting shared across replicas, bounded pg pool + PgBouncer pooling tier, role-split + cloud-ready Redis clients); multi-stage **Dockerfile** (one image runs api/worker/migrate) + **docker-compose** full stack (`--scale api=2 --scale worker=3`) + **GitHub Actions CI**.
- **✅ Autoscaling milestone** — **Kubernetes/Kustomize** manifests (`k8s/`, base + local/prod/loadtest overlays): api **HPA** on CPU + worker **KEDA** `ScaledObject` on BullMQ queue depth (Prometheus `max(waiting)+max(delayed)`), PDB, direct-to-Postgres migrate Job. **k6** load tests (`load/`, create→track→deliver) + a `LOADTEST_BYPASS_THROTTLE` flag (non-prod) so a single-IP run measures real throughput. Validated with `kustomize build` + `kubeconform`; CI dry-runs on `kind`. *(Next: a real cluster run for actual scale-up numbers + Grafana dashboards.)*
- **✅ Real-time tracking (push, horizontally scalable)** — WebSocket tracking over raw `ws` (`WsAdapter`) backed by **Redis pub/sub**: the worker publishes each position/status change to `delivery:<id>:update`, and every API replica's subscriber fans it out to its local clients — so a worker-computed update reaches a client on **any** instance (the in-memory gateway was dead in the worker-split topology). **Auth + ownership** on every subscription (JWT in the `?token=` handshake, `findOne` ownership re-check; tokenless → `1008`). Polling (`GET /deliveries/:id`) is kept as an additive backstop — **mobile still polls; WS migration is a separate mobile-repo task.** `drovery_ws_connections` gauge added. Verified cross-process. *(Next: dedicated realtime tier so sockets scale apart from the API.)*
- **✅ Recipient handoff OTP (P1 #5)** — the drone now stops at a new **`AWAITING_HANDOFF`** state on arrival (the sim never auto-delivers); finalizing as `DELIVERED` + recording proof requires the recipient's **6-digit code** via `POST /deliveries/:id/confirm-handoff`. Code is SHA-256-hashed (plaintext returned once on create, never re-exposed — `handoffCodeHash`/`handoffAttempts` omitted from all reads), constant-time compared, single-use (atomic CAS), with an atomic **5-attempt lockout** (`423`). Owner-scoped; `401/409/400/404` on the error paths. Verified live + adversarially reviewed.
- **✅ Serviceability gate (P1 #8)** — "can we fly this?" checks: **service area** (point-in-circle, Greater Jakarta + Bandung), **no-fly zones** (route-vs-circle geometry, Jakarta airports), and **weather** (real-or-mock `WeatherService`, OpenWeather when keyed, **fail-open**). `POST /pricing/estimate` returns an advisory `serviceability` block; `POST /deliveries` rejects unflyable routes (**422** out-of-area / no-fly / unresolved-location, **503** weather hold) before any charge/queue. Reused `haversineKm` (moved to `common/geo-distance` to break a Pricing↔Serviceability cycle). Verified live + adversarially reviewed.

---

## P0 — Close the "real product" gaps (high impact, the app feels broken without these)

1. ~~**Password reset & email verification.**~~ ✅ **Done.** Email verification: signup sends a hashed, single-use, 24h verification token (`MailService`); `POST /auth/verify-email` + `/auth/resend-verification`; `emailVerified` on the user; mobile has a Verify Email screen (deep-link auto-verify) + a home banner with resend.
2. ~~**Real payments (Stripe).**~~ ✅ **Done (backend)** — see "Just shipped". PaymentIntent on create + signature-verified webhook + `Payment` lifecycle, real-or-mock. **Still open:** native on-device card entry (`@stripe/stripe-react-native`), saved cards as real Stripe PaymentMethods, and receipts; fix the FAQ's Stripe-encryption claim.
3. ~~**Distance-based pricing.**~~ ✅ **Done** — see "Just shipped". (Next: zone/surge multipliers + a per-km rate that varies by region.)
4. ~~**Proof of delivery.**~~ ✅ **Done** — see "Just shipped". (Next: real on-device photo capture/upload from the operator/unload workflow, and a configured storage provider.)

## P1 — Trust, safety & retention

5. ~~**Recipient handoff OTP.**~~ ✅ **Done.** The sim now stops at a new `AWAITING_HANDOFF` state on arrival; the drone finalizes as `DELIVERED` (+ proof) only when the recipient's 6-digit code is confirmed via `POST /deliveries/:id/confirm-handoff` (SHA-256-hashed, single-use, 5-attempt lockout, owner-scoped). Prevents wrong-handoffs.
6. **Ratings & feedback** after delivery (drone experience, accuracy) → feeds ops quality.
7. **Saved addresses / address book** + recent locations, so users aren't re-typing/re-geocoding (also cuts geocoding load — see ARCHITECTURE §2).
8. ~~**No-fly / weather / serviceable-area checks**~~ ✅ **Done.** A `ServiceabilityService` gates delivery on service-area (point-in-circle) + no-fly-zone (route-vs-circle geometry) + weather (real-or-mock `WeatherService`, fail-open). `POST /pricing/estimate` returns an advisory `serviceability` block; `POST /deliveries` rejects unflyable routes (422 area/no-fly/unresolved, 503 weather hold) before any charge.
9. **Notification preferences** (which events, quiet hours) + a real **support chat** (the "Live Chat" button is currently a no-op; ticket persistence is now in place to back it).

## P2 — Growth & engagement

10. **Scheduled / recurring deliveries** (pick a future window; the schema already has `pickupDate/pickupTime`).
11. **Promo codes & wallet/credits** at checkout.
12. **Referral program** ("invite a friend, both get credit") — cheap growth loop.
13. **Reorder / "send again"** from history; **favorites**.

## P3 — Ops & platform maturity

14. **Operator/admin app or dashboard** — today everything is the consumer side. Ops needs fleet status, exceptions, manual reassignment, refunds.
15. **Live drone telemetry ingestion** to replace the simulation (MQTT/drone gateway → worker tier → same tracking contract).
16. **Delivery exceptions** (failed drop, weather abort, return-to-base) as first-class statuses with user comms.
17. **i18n / localization** (the app/data lean Indonesia/Jakarta) and accessibility pass.

---

### How to choose
If the goal is **launch-readiness**: do P0 (auth recovery, payments, distance pricing, proof of delivery) — without these the app isn't shippable to paying users.
If the goal is **scale to 100k**: pair P0 with **ARCHITECTURE.md Phase 1** (worker tier + caching + pooling) — features and scale must advance together, since real payments and live tracking are exactly what fall over under load.

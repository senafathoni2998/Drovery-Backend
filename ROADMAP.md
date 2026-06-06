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
- **✅ Real Stripe payments (P0)** — `StripeService` uses the live Stripe SDK when `STRIPE_SECRET_KEY` is set and a deterministic **mock** otherwise. Creating a delivery now creates a **PaymentIntent** + a `Payment` row (idempotent per delivery); `POST /payments/webhook` verifies the signature and drives `Payment.status`. Mobile shows the payment status on the delivery. *(Last mile for production: native `@stripe/stripe-react-native` card entry — backend is ready for it.)*
- **✅ Proof of delivery (P0)** — on `DELIVERED` the simulation auto-records a `ProofOfDelivery` (photo + final GPS + recipient + timestamp); `POST/GET /deliveries/:id/proof` lets the owner submit/view one. Image storage is behind `StorageService` (inline data URL / placeholder in dev; S3/Cloudinary when configured). Mobile shows a proof card on the delivery detail.

---

## P0 — Close the "real product" gaps (high impact, the app feels broken without these)

1. ~~**Password reset.**~~ ✅ **Done** — see "Just shipped". (Still open: **email verification** on signup, which reuses the same token pattern.)
2. ~~**Real payments (Stripe).**~~ ✅ **Done (backend)** — see "Just shipped". PaymentIntent on create + signature-verified webhook + `Payment` lifecycle, real-or-mock. **Still open:** native on-device card entry (`@stripe/stripe-react-native`), saved cards as real Stripe PaymentMethods, and receipts; fix the FAQ's Stripe-encryption claim.
3. ~~**Distance-based pricing.**~~ ✅ **Done** — see "Just shipped". (Next: zone/surge multipliers + a per-km rate that varies by region.)
4. ~~**Proof of delivery.**~~ ✅ **Done** — see "Just shipped". (Next: real on-device photo capture/upload from the operator/unload workflow, and a configured storage provider.)

## P1 — Trust, safety & retention

5. **Recipient handoff OTP.** Generate a one-time code the recipient gives the drone/operator to confirm release (the signed-QR work is a foundation). Prevents wrong-handoffs.
6. **Ratings & feedback** after delivery (drone experience, accuracy) → feeds ops quality.
7. **Saved addresses / address book** + recent locations, so users aren't re-typing/re-geocoding (also cuts geocoding load — see ARCHITECTURE §2).
8. **No-fly / weather / serviceable-area checks** at quote & create time. Safety + sets expectations ("not available in your area / weather hold").
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

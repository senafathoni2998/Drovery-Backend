# Drovery — Feature Recommendations

Prioritized advice on **what to build next**, grounded in what exists today. Ordered by
impact-to-effort. ✅ = already added in the latest round of work.

## ✅ Just shipped (this round)
- **Live drone tracking** — backend simulates a moving drone; mobile polls every 4s and the marker **glides** between positions with a LIVE badge.
- **Status-change notifications** — in-app + local banner on each change, and **remote Expo push** to registered devices.
- **Cancel delivery** UI wired to the existing endpoint.
- **Geocode-on-create** — real pickup/dropoff coordinates → a real flight path.
- **Support tickets persisted** + signed (HMAC + expiry) QR codes.

---

## P0 — Close the "real product" gaps (high impact, the app feels broken without these)

1. **Password reset & email verification.** There is currently **no way to recover an account** (no forgot-password, no email verify). Add `POST /auth/forgot-password` + `reset-password` (emailed token) and email verification. Table stakes for real users.
2. **Real payments (Stripe).** Today cards are fake metadata (`manual_<ts>`) and no charge happens; the `Payment` model is unused and the FAQ falsely claims Stripe encryption. Implement: tokenize card on device → PaymentIntent on create → webhook (signature-verified) → write `Payment`. Add receipts.
3. **Distance-based pricing.** `pricing/estimate` accepts `fromAddress/toAddress` but **ignores them** — price is size+weight+type only. Now that we geocode, price by **distance** (haversine over the resolved coords) + zone surcharges. Directly affects revenue correctness.
4. **Proof of delivery.** On `DELIVERED`, capture a **drop photo** + timestamp + final GPS, shown in the app. The biggest trust driver for autonomous delivery.

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

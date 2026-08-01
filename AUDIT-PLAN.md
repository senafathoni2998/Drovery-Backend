# Drovery — Audit Remediation Plan

> **If you are a new session starting here: read §0 and §1 in full before touching code.**
> They contain everything you need that is not derivable from the repos themselves.
> Then read `AUDIT-LOG.md` to find out where the previous session stopped.

**Created:** 2026-07-26
**Source:** full tri-repo audit (31 verified bugs, 32 UI/UX flaws, 32 feature gaps)
**Full audit report:** https://claude.ai/code/artifact/862b5828-c24f-479d-8a52-c5a4b7e29fff
**Progress log:** `AUDIT-LOG.md` (in this directory) — **you must append to it at the end of every phase**

---

## §0. Orientation — what this project is

Drovery is an **autonomous drone package-delivery platform**. Not couriers, not drivers —
uncrewed aircraft dispatched by the backend, reporting position over MQTT telemetry.
If you find yourself reasoning about "the driver", you have the wrong mental model.

### The three repositories

| Repo | Absolute path | Stack |
|---|---|---|
| Backend | `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Backend` | NestJS + Prisma + Postgres + Redis + BullMQ + MQTT. ~31k LOC, 30 modules, 835-line schema |
| Mobile | `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Mobile` | Expo Router + React Native (customer app). 265 files |
| Admin | `/home/darth-zelantus/Documents/Project_Pribadi/Drovery_Admin` | React 19 + Vite + MUI 7 + Redux Toolkit (operator console). 56 files |

This plan lives in the backend repo because that is the primary working directory, but
**most phases touch two or three repos**. Each task below names its repo explicitly.

### The delivery lifecycle (memorize this)

```
SCHEDULED → PENDING → CONFIRMED → DRONE_ASSIGNED → PICKUP_IN_PROGRESS
          → IN_TRANSIT → AWAITING_HANDOFF → DELIVERED
```

Exception branches, deliberately **outside** the monotonic forward CAS order so a terminal
state can never be resurrected: `RETURNING` (transient) → `RETURNED_TO_BASE`, and `DELIVERY_FAILED`.
Failure reasons live in `DeliveryFailureReason` (`RECIPIENT_UNAVAILABLE`, `WEATHER_ABORT`,
`UNSAFE_DROP_ZONE`, `MECHANICAL`, …). Drone-fault reasons refund the customer;
`RECIPIENT_UNAVAILABLE` deliberately does not.

`AWAITING_HANDOFF` is the defining moment of the product: an aircraft is hovering, burning
battery, waiting for a human to come outside. Many decisions below hinge on it.

### Audit verdict, in one paragraph

The **platform layer is genuinely well built** — month-range-partitioned tables with composite
PKs, a `TrackingIdRegistry` working around partitioned tables being unable to enforce
single-column uniqueness, single-winner CAS transitions, a leased transactional outbox, a
telemetry watchdog, Kustomize/KEDA overlays, a complete en/id i18n catalog with a completeness
test. **The product on top of it cannot take money, cannot schedule a delivery, and does not
model the aircraft.** Almost every bug lives at a seam between two repos, or in a feature built
on one side and never finished on the other. Treat the backend's existing patterns as good and
worth following — do not rewrite them.

---

## §1. Ground rules — read before writing any code

### 1.1 The test suite will not catch your mistakes

Baseline at audit time: **1,073 tests passing, all three repos typecheck clean, lint clean**
(backend has 98 warnings, 0 errors) — while an entire user-facing feature (support tickets) was
unreachable and no payment had ever been captured. The tests are uniformly **unit tests against
mocked Prisma/fetch**. `supportApi.createTicket` has its own passing test and zero call sites.

**Consequence:** "tests pass" is necessary but nowhere near sufficient. For every task below,
the acceptance criteria say what to actually verify. Where a task fixes a wiring bug, add a test
that would have failed before the fix.

### 1.2 Mock mode hides the money bugs

`ALLOW_MOCK_PAYMENTS` / `stripe.isMock` makes `createPaymentIntent` return
`status: 'succeeded'` immediately (`src/stripe/stripe.service.ts:59-67`). Every demo and every
test therefore passes through a payment path that does nothing. When working on Phase 9, you
must reason about the **real-keys** path, not the mock path.

Similarly `SERVICE_AREA_GLOBAL=true` makes every coordinate on Earth serviceable, and
`WeatherService` is fail-open and mock-by-default without `OPENWEATHER_API_KEY`.

### 1.3 Verification commands (all confirmed working)

```bash
# Backend  (cd /home/darth-zelantus/Documents/Project_Pribadi/Drovery_Backend)
npx prisma generate                        # needed once after clone/install
npx tsc -p tsconfig.build.json --noEmit    # typecheck
npm run lint                               # 0 errors / 98 warnings is the baseline
npm test                                   # 80 suites / 729 tests

# Mobile   (cd /home/darth-zelantus/Documents/Project_Pribadi/Drovery_Mobile)
npx tsc --noEmit
npm run lint
npm test                                   # 39 suites / 279 tests

# Admin    (cd /home/darth-zelantus/Documents/Project_Pribadi/Drovery_Admin)
npx tsc -b
npm run lint
npm test                                   # 16 suites / 65 tests
```

`node_modules` may be absent on a fresh machine — `npm ci` in each repo first.

### 1.4 Do not chase this ghost

Two audit agents claimed `Drovery_Mobile/features/delivery/screens/DeliveryDetailScreen/DeliveryDetailScreen.tsx:205`
passes a **trackingId** where the API wants the delivery UUID. On inspection that line passes
`delivery.id`. The 404 behaviour on workflow steps is real and worth fixing (Phase 4.4), but
**the cited line reference is unconfirmed** — trace the actual value at runtime rather than
trusting the citation.

### 1.5 Working style

- Branch per phase: `fix/phase-N-short-name`. Do not commit to `main`.
- Do not commit unless the user asks.
- Keep each phase's diff scoped to that phase. Resist drive-by refactors — the backend's
  patterns are deliberate and heavily commented; read the comment before "fixing" something.
- When a backend comment explains *why* something is the way it is (there are many, and they
  are good), take it seriously. Several audit findings were refuted by exactly those comments.

---

## §2. Phase list — status at a glance

Keep this table current. It is the first thing a new session reads after §0/§1.

| # | Phase | Size | Repos | Status |
|---|---|---|---|---|
| 0 | Baseline capture | S | all | ☑ Done (2026-07-26) |
| 1 | Pricing trust boundary | S | backend | ☑ Done (2026-07-26) |
| 2 | Credentials hygiene | S | backend | ☑ Done (2026-07-26) |
| 3 | Scheduled-delivery contract | S | backend + mobile | ☑ Done (2026-07-26) |
| 4 | Mobile stop-the-bleeding | S | mobile | ◐ Done except the Maps key (2026-07-26) |
| 5 | Price honesty at checkout | S | mobile | ☑ Done (2026-07-26) |
| 6 | Terminal-path atomicity | M | backend | ◐ Done except partial-refund accounting → Phase 10 (2026-07-26) |
| 7 | Admin console unblock | S | admin + backend | ◐ Done except toasts + customer ticket entry (2026-07-26) |
| 8 | Alerting & backups | S | backend/ops | ☑ Done (2026-07-26) |
| 9 | Realtime durability | M | backend + admin | ◐ Backend done; admin socket + hot-store drain deferred (2026-07-26) |
| 10 | Charge money for real | M | backend + mobile | ☐ Not started |
| 11 | Drone entity + dispatch engine | L | backend + admin | ◐ Entity, claim, fleet surface + dispatch engine done; per-aircraft credentials + saturation queue remain (2026-08-01) |
| 12 | Flight-ops layer | M | backend + admin | ◐ Flight log + energy management done; re-gate at dispatch, airspace-as-data, ops console, incidents, audit log remain (2026-08-01) |

Status values: `☐ Not started` · `◐ In progress` · `☑ Done` · `⊘ Skipped (reason)`

**Ordering rationale:** stop the bleeding where money, credentials and physical dispatch are
involved (1–5); then make terminal paths atomic and unblock the operator console (6–7); then
buy cheap operational safety (8–9); then charge money (10); then build the Drone entity,
because every flight-ops capability is blocked on it (11–12).

Phases 1–5 are independent of each other and can be done in any order or in parallel.
Phase 8 is independent of everything and can be pulled forward at any time.
Phase 12 hard-depends on Phase 11.

---

## §3. The phases

Each task gives: **what**, **where**, **why it matters**, and **acceptance criteria**.
Line numbers are from the audit and may drift — grep for the described code, don't trust the number blindly.

---

### Phase 0 — Baseline capture · S · all repos

Before changing anything, record the starting state so later sessions can tell what moved.

1. Run all nine verification commands in §1.3 and record actual counts.
2. Note current branch and HEAD SHA for each repo.
3. Append the Phase 0 entry to `AUDIT-LOG.md`.

**Acceptance:** `AUDIT-LOG.md` contains a Phase 0 entry with real test counts and three SHAs.

---

### Phase 1 — Pricing trust boundary · S · backend

**Why:** the distance fee is the largest price component and it is computed from coordinates
the client supplies, with no reconciliation against the addresses. A user can zero the fee and
simultaneously spoof the serviceability geofence. Separately, the payload cap that makes a
drone delivery physically possible is defined and never enforced.

1. **Geocode server-side for pricing.**
   `src/deliveries/deliveries.service.ts:485-505` (`resolveCoords`) documents *"Client-supplied
   coords win"*. Change pricing to always use the server geocode of `fromAddress`/`toAddress`.
   Client coords may still seed the simulation route, but must not price.
2. **Reject implausible client coords.** If client coords are supplied and deviate >1 km from
   the geocode, reject with a 400 rather than silently preferring one.
3. **Bound the inputs.** Add `@Min/@Max` on `fromLat/fromLng/toLat/toLng` in
   `src/deliveries/dto/create-delivery.dto.ts` (lat −90..90, lng −180..180).
4. **Enforce the payload cap.** `MAX_WEIGHT_KG` (`src/common/constants/index.ts:15-20`) has
   **zero call sites**. Wire it into `CreateDeliveryDto`, `EstimatePriceDto` and
   `CreateRecurringDeliveryDto`. The recurring materializer
   (`src/recurring-deliveries/recurring.materializer.ts:150`) replays a stored weight on a
   schedule without passing through the mobile form validator — that is the real hole.

**Acceptance:**
- A request with `fromLat==toLat && fromLng==toLng` but distinct real addresses is priced on
  the geocoded distance, not zero.
- A `packageSize: "Small"` with `packageWeight: 500` is rejected with 400 on all three routes.
- New tests cover both. Backend suite still green.

---

### Phase 2 — Credentials hygiene · S · backend

**Why:** password-reset and email-verification tokens are written to application logs in
cleartext on the **default deploy path** (no mail provider is integrated, so production falls
into the dev branch), and a password reset does not end existing sessions.

1. **Stop logging token material.** `src/mail/mail.service.ts:87-89, 98` logs the rendered
   body in both branches. Log recipient, subject and template name only, at debug level.
   Extend the pino `redact` list in `src/app.module.ts:97` (it currently covers auth headers only).
2. **Revoke refresh tokens on password reset.** `src/auth/auth.service.ts:244-256`. Add
   `refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })`
   **inside the same transaction** as the password write.
3. **Close the access-token window.** Add a `passwordChangedAt` check so the 15-minute access
   token issued before the reset stops working too.
   **DEFERRED in the Phase 2 pass — do not treat as a small task.** `JwtStrategy.validate`
   (`src/auth/strategies/jwt.strategy.ts`) does NO I/O today: it returns the payload
   synchronously. Any such check adds a DB or Redis round trip to *every authenticated
   request*, which is an auth-hot-path architectural change, not an S-sized fix. Residual
   exposure is one 15-minute access-token lifetime; the durable hole (a 7-day refresh token
   surviving a reset) is closed. If picked up: decide fail-open vs fail-closed on a Redis
   blip first — fail-open is almost certainly right, per the Phase 1 lesson about transient
   Redis failures cascading into hard outages.
4. *(Optional, same area)* refresh-token reuse detection — revoke the whole rotation family
   when a already-rotated token is presented. **DONE in the Phase 2 pass**, and it forced a
   design change: `revokedAt` now means *"superseded by rotation"* and nothing else, because
   `logout()` and `resetPassword()` DELETE their rows instead of stamping `revokedAt`. Do not
   reintroduce a soft-revoke on either of those paths without also adding a `revokedReason`
   column — otherwise a device replaying a benignly-revoked token trips the family-kill and
   logs the user out of the session they just created.

**Acceptance:**
- Grep for token values in logs across a reset + verify flow returns nothing.
- A refresh token captured before a password reset is rejected after it.
- Backend suite green; new tests for both behaviours.

---

### Phase 3 — Scheduled-delivery contract · S · backend + mobile

**Why:** the highest-severity bug in the audit. Every "scheduled" delivery dispatches a
physical drone immediately, with a 201 and no error.

**The chain, fully traced:**
- Mobile emits `"Jul 26, 2026"` — `DateTimePickerField.tsx:55-64`, `toLocaleDateString("en-US")`
- Mobile emits `"03:30 PM"` — `CustomTimePicker.tsx:84`
- Backend wants `ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/` on `pickupDate.slice(0,10)` → gets `"Jul 26, 2"`, no match
- Backend wants `HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/` → `$` anchor fails on `" PM"`
- `computeScheduledFor` returns `null` (`src/deliveries/delivery-schedule.ts:98-100`)
- → `leadMs = 0` → `isScheduled = false` → status `PENDING` → immediate dispatch
- `new Date("Jul 26, 2026")` **parses fine**, so the stored date looks correct everywhere.
  The data looks right; the aircraft is already gone.

1. **Mobile:** emit `YYYY-MM-DD` from the date picker and 24-hour `HH:MM` from the time picker.
   Keep the 12-hour presentation in the UI if desired — change the emitted value only.
2. **Backend:** add `@Matches(/^\d{4}-\d{2}-\d{2}$/)` and `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)`
   to `pickupDate`/`pickupTime` on **all three** DTOs: `create-delivery.dto.ts:47-53`,
   `reorder.dto.ts:5-7`, `favorites/dto/favorite.dto.ts:17-19`.
3. **Decide the fail-open question.** `deliveries.service.ts:197` deliberately treats
   unparseable input as immediate PENDING. With (2) in place that path is unreachable from a
   well-behaved client — but confirm you want a 400 rather than a silent immediate dispatch,
   and leave a comment recording the decision.

**Acceptance:**
- Booking for tomorrow 09:30 from the mobile app produces a row with status `SCHEDULED` and a
  correct `scheduledFor`.
- Posting `pickupDate: "Jul 30, 2026"` to any of the three routes returns 400, not 201.
- The `MAX_SCHEDULE_DAYS` guard is now reachable — add a test that trips it.

---

### Phase 4 — Mobile stop-the-bleeding · S · mobile

Five independent fixes, each small.

1. **Auth gate.** `app/index.tsx` is literally `export { default } from './login'` — the entry
   route is unconditionally the login form, so a cold start discards a valid session. Add a
   gate in `app/_layout.tsx`: splash while `isLoading`, `<Redirect href="/(tabs)" />` when
   authenticated, `<Redirect href="/login" />` otherwise.
2. **Session-expiry navigation.** `services/api/apiClient.ts:110-113` clears auth state on
   refresh failure but never navigates, dead-ending the user on an authenticated screen with a
   4s poll still running. Navigate to login and `stopPoll()` in `useDeliveryTracking`.
3. **Android back handler.** `BackHandler.exitApp()` is registered in mount-scoped `useEffect`
   on four screens — `HomeScreen.tsx:67-76`, `ProfileScreen.tsx:58-64`, `SignupScreen.tsx:79-88`,
   `LoginScreen.tsx:73-79`. Tab screens never unmount in Expo Router, so Back quits the app from
   anywhere. Move to `useFocusEffect`; remove entirely from Signup and Profile; keep
   double-press-to-exit on Home only.
4. **Track Package keyboard.** `TrackPackageScreen.tsx:96,102` sets `keyboardType="number-pad"`
   but tracking IDs are `uuidv4().slice(0,8).toUpperCase()` (`deliveries.service.ts:162`) — 8 hex
   chars. ~98% contain letters and cannot be typed at all. Set `keyboardType="default"`,
   `autoCapitalize="characters"`, `autoCorrect={false}`, and a real hex example in the placeholder.
5. **Workflow route identifier.** Workflow step completion and QR generation 404 because
   `assertOwnedDelivery` (`workflows.service.ts:46-58`) keys on the delivery UUID. Trace what the
   route actually receives (see §1.4 — the cited line is unconfirmed), pass the UUID, and **stop
   swallowing the error** — `WorkflowScreen.tsx:73-75` currently renders green checkmarks for
   failed steps.
6. **Maps key.** `app.json:26` holds a placeholder Google Maps key, so the Android map is a grey
   rectangle. Wire a real key through EAS secrets.

**Acceptance:**
- Cold start with a stored session lands on tabs, not login.
- Back on a pushed screen navigates back; Back on Signup returns to the previous screen.
- A tracking ID containing letters can be typed and submitted.
- A workflow step failure surfaces an error instead of a green checkmark.

---

### Phase 5 — Price honesty at checkout · S · mobile

**Why:** the last screen before commitment quotes a price that omits the distance fee the
backend actually charges. The promo discount is computed off the same wrong base.

1. `ConfirmationDeliveryScreen.tsx:77-83` calls `pricingApi.estimate` with only
   `{packageSize, packageWeight, packageTypes}` — no addresses, no coords. `PricingService.estimate`
   adds `distanceKm * 1.5` when coords are present. Send addresses/coords, and re-run the
   estimate when geocoding resolves.
2. Delete the client-side `calcPrice` helper and render only the server value.
3. Surface the swallowed `.catch` — a failed estimate must show an error, not a stale number.
4. **One currency formatter.** Currency is formatted four ways, two of them on this screen: the
   price bar shows `$37` while `PromoCodeInput.tsx:23` renders the same total as `Rp37.000`.
   Elsewhere `$45.00`, `45.00 USD`, `USD 45.00`. Add one `formatCurrency(amount, currency)`
   driven by the server's currency code and use it everywhere.

**Acceptance:** the number on the confirmation screen equals the number the backend charges,
for a delivery with a non-trivial distance. Currency renders identically across screens.

---

### Phase 6 — Terminal-path atomicity · M · backend

**Why:** `cancel()` is the only status transition in the file without a CAS guard, two terminal
paths skip the card refund leg, and the watchdog's CAS is wider than its own candidate query.

1. **CAS in `cancel()`.** `deliveries.service.ts:754-780` is a non-atomic read-then-write:
   validates a stale snapshot, three network round-trips, then an **unconditional** status
   write — so a race can overwrite `DELIVERED` with `CANCELED`. Add a conditional update
   matching the pattern already used at `:798-808`, `:858-861`, `:1123`.
2. **Missing refund leg.** `cancel()` and `adminForceCancel` release the promo and refund wallet
   credits but never call `refundChargeToWallet`, unlike `cleanupAfterException` (`:957-970`)
   which deliberately refunds both. Extract one shared `cleanupAfterTermination`.
3. **Narrow the watchdog CAS.** `WATCHDOG_STUCK_STATUSES` (`watchdog.constants.ts:42-47`)
   deliberately **excludes** `AWAITING_HANDOFF`, but `failExceptional` gates on
   `FAILABLE_STATUSES` (`delivery-exceptions.ts:17-23`) which **includes** it. A delivery
   selected as `IN_TRANSIT` that reaches handoff mid-scan is failed and auto-refunded while the
   drone hovers at the door. Pass the allowed statuses into the CAS instead of using the broad set.
   The "defensive" recheck at `delivery-watchdog.ts:83` is a tautology on in-memory values.
4. **Gate `submitProof`.** `proof/proof.service.ts:53,68` has no status guard: it mints proof
   for `CANCELED`/`PENDING` deliveries and lets the owner overwrite the handoff-recorded
   `lat/lng/recipientName`. The sibling `RatingService.rate:21-23` gates correctly — copy it.
5. **Partial-refund accounting.** `admin.service.ts:195-220` flips the whole Payment to
   `REFUNDED` on a partial refund, permanently consuming the at-most-once refund budget and
   killing the automatic drone-fault refund for the remainder. Track a cumulative refunded amount.

**Acceptance:** concurrent cancel-vs-deliver cannot produce a resurrected terminal; a
watchdog scan cannot fail a delivery that has reached `AWAITING_HANDOFF`; proof cannot be
submitted on a canceled delivery. Add concurrency tests for (1) and (3).

---

### Phase 7 — Admin console unblock · S · admin + backend

**Why:** an agent cannot use this console. They land on a 403, they cannot search, and live
chat never connects.

1. **Role-aware landing.** `router.tsx:37` sends every authenticated user to the ADMIN-only
   Dashboard. Redirect non-admins to `/support`; add role guards to `/`, `/deliveries`,
   `/promos`, `/users`.
2. **Staff bypass in the chat gateway.** `support-chat.gateway.ts:139` calls `assertOwnedTicket`
   (`support-chat.service.ts:14-22`), which is `findFirst({ where: { id: ticketId, userId } })` —
   strictly owner-scoped, so an agent is never the owner. Resolve the connecting user's role at
   `handleConnection` (the JWT carries only `{sub, email, jti}` today) and give AGENT/ADMIN an
   existence-only check. Mirror in `handleSend`.
3. **Handle the real frame.** `Drovery_Admin/src/api/supportSocket.ts:156-176` handles only
   `message:sent`; the backend always broadcasts `{event:'message:new', data}`
   (`support-chat.publisher.ts:96`). Its bare-payload branch is unreachable dead code and its
   unit test asserts the wrong frame — fix the test too.
4. **Search and URL-backed filters.** There is no search anywhere in the console — every list is
   page + limit + one enum, and `useSearchParams` appears nowhere in `src/`. Add a debounced `q`
   param and `createdFrom/createdTo` server-side, put page/filter state in the URL, add a sticky
   header and server-side sort. *This is the single largest blocker to using the console for
   phone support.*
5. **Refresh the command history.** `DeliveryDetailPage.tsx:200` wires the header button to the
   delivery refetch only, while the internal `refresh()` at `:140-144` correctly calls both. The
   dispatcher watching for an ABORT ack sees PENDING forever and re-issues to a live aircraft.
6. **Success feedback.** `Snackbar`/`toast` appear nowhere in `src/`. Add a provider and echo the
   refunded amount that `adminApi.refund` already returns and `onRefund` currently discards.
7. **Keyboard-reachable rows.** List rows are click handlers with no `tabIndex`/`onKeyDown`/anchor.
   Render the first cell as a react-router `<Link>`.

Also worth doing here: the customer side of support is dead too — `supportApi.createTicket`
(mobile) has **zero call sites** and `HelpSupportScreen.tsx:52` is `action: () => {}`. Without a
create path the admin inbox has no source. Either add the entry point (a "Report a problem"
button on delivery detail, prefilled with trackingId + status + failureReason) or explicitly
defer it and note that in the log.

**Acceptance:** an AGENT can log in, land somewhere usable, search a ticket by tracking ID,
open it, and see a customer message arrive live.

---

### Phase 8 — Alerting & backups · S · backend/ops · *independent, pull forward any time*

**Why:** cheapest real risk reduction in the repo.

1. Nine SLO rules including three `severity: critical` pages are authored in
   `observability/alerts.yml` and loaded into a Prometheus with **no `alerting:` block and no
   Alertmanager anywhere** (`observability/prometheus.yml`, `docker-compose.observability.yml`).
   They fire into a UI nobody watches. Add Alertmanager and a real route.
2. Backup is a single manual `pg_dump` line in `DEPLOY.md:146` with no restore procedure, no
   PITR, no retention. Add automated backup + a **tested** restore runbook.
3. Health readiness lies: `health.service.ts:20` pings only the cache Redis, so a replica reports
   Ready while the queue or pub/sub Redis is down. *(Note: one verifier argued this is
   unreachable in shipped configs — confirm before spending time.)*

**Acceptance:** a deliberately triggered critical alert reaches a human. A restore from backup
into a scratch database is performed and documented.

---

### Phase 9 — Realtime durability · M · backend + admin

1. **Re-arm subscriptions.** `tracking.subscriber.ts:50-54,84` and
   `support-chat.subscriber.ts:57-61`: with `enableOfflineQueue:false`, a failed Redis SUBSCRIBE
   is logged and never retried, and the client is told `subscribed` while no channel was
   registered — permanently, because the local Set is now non-empty. Keep a desired-channel set
   and re-arm on ioredis `ready` (`mqtt.service.ts:83-89` already does this correctly — copy it).
   Await the subscribe and roll back the map entry on failure.
2. **Recoverable admin socket.** `Drovery_Admin/src/api/supportSocket.ts:191-201` treats close
   1008 as permanently fatal and opens with whatever 15-minute token is in localStorage. Make it
   recoverable once via a token refresh; surface the six distinct `UnavailableReason` values
   instead of collapsing them all into "Offline".
3. **Fair checkpoint drain.** `tracking-hot-store.ts:158` claims a random `SPOP` batch with no
   aging, so at scale an individual delivery can starve past `WATCHDOG_SILENCE_MS` and be
   false-reaped. Replace with an aging ZSET and add a backlog gauge.
4. **Shutdown ordering.** `prisma.service.ts:132` tears down Prisma/Redis in `onModuleDestroy`,
   which runs *before* BullMQ drains in `onApplicationShutdown` — every in-flight job dies on
   each deploy. Reorder.
5. **WS session revalidation.** `tracking.gateway.ts:81` authenticates once at connect and never
   re-validates, so logout and token expiry never terminate a live stream.

**Acceptance:** bouncing Redis does not permanently deafen a connected client. A deploy does not
lose in-flight jobs.

---

### Phase 10 — Charge money for real · M · backend + mobile

**Why:** no delivery has ever been charged. `paymentIntents.create` is the only PaymentIntent
call in the repo, nothing confirms it, the `client_secret` is discarded
(`payments.service.ts:175-184` stores only `intent.id`), no controller exposes it, mobile has no
checkout step, and **nothing in the delivery lifecycle checks payment status before fulfilling**.

1. Attach `customer` + default `payment_method`; call with `confirm: true` / `off_session: true`
   and a `deliveryId`-scoped idempotency key (`stripe.service.ts:71-76`).
2. Add a `requires_action` (SCA/3DS) branch and surface it to a real mobile checkout screen.
   Today the only Stripe payment-sheet usage is `StripeAddCard.tsx`, for adding a card.
3. Gate fulfilment on a successful confirm — currently the lifecycle never reads `PaymentStatus`.
4. Stripe-side refunds. The only refund channel today is a wallet credit
   (`admin.service.ts:208-214`), which mints spendable credit against a payment that may never
   have been captured.
5. Add a client idempotency key on `POST /deliveries` — `ConfirmationDeliveryScreen.tsx:121` has
   no in-flight guard and the client aborts at 10s against unbounded server-side I/O, so a
   retried timeout creates a second delivery, a second dispatch and a second PaymentIntent.
6. **Then let customers spend their wallet.** The backend fully implements `useCredits` (DTO
   field, balance read, clamp, idempotent CAS debit, refund on cancel). Mobile types
   `useCredits?: boolean` in one line and never sends it, so credits accumulate from every
   weather abort and referral and can never be spent — while the failure notification says
   "refunded to your wallet".

**Acceptance:** with real test keys, a delivery is created, charged, and visible as captured in
Stripe; a canceled delivery refunds to the card; a delivery cannot reach `DRONE_ASSIGNED`
without a captured payment.

---

### Phase 11 — Drone entity + dispatch engine · L · backend + admin

**This is the structural gap. Everything in Phase 12 is blocked on it.**

**Why:** there is no `Drone` table. `Delivery.assignedDroneId` (`schema.prisma:223`) and
`DroneCommand.droneId` (`:308`) are bare `String`s, populated with `drone-${uuidv4()}` per
delivery (`deliveries.service.ts:270`), referencing nothing, with **no unique index** — so
nothing prevents two concurrent LIVE deliveries binding the same aircraft, and the platform
believes one drone is carrying two payloads to two addresses. There is no serial, model,
firmware, flight-hours, cycles, maintenance-due, grounded/airworthy flag, home base or current
location. Drone identity is self-asserted in a query param against one shared `INGEST_API_KEY`
(`drone-auth.guard.ts:47-59`) — no per-aircraft credential to rotate or revoke on loss. The
customer-facing DTO even lets the caller supply `droneId` (`create-delivery.dto.ts:93-96`),
which then routes operator commands to that topic.

1. **`Drone` model** — serial, model, firmware, airworthy/grounded, home base, current location,
   battery state, flight-hours, cycles, maintenance-due. FK from `Delivery.assignedDroneId` with
   a partial unique index enforcing one active delivery per aircraft.
2. **Per-aircraft credentials** replacing the shared ingest key; revocable on loss.
3. **Remove `droneId` and `trackingSource` from the customer-facing DTO** — these are
   operator-only fields currently settable by any authenticated user.
4. **Dispatch engine:** atomic availability claim, payload-class match, out-and-back range and
   energy feasibility, saturation queue when the fleet is full, reassignment when a drone goes
   unresponsive.
5. **Bound the haversine.** With `SERVICE_AREA_GLOBAL=true` a Jakarta→London delivery is
   accepted and "assigned" (`serviceability.service.ts:116`).
6. **Admin fleet surface** — registry list, per-aircraft detail, ground/unground.

**Acceptance:** two concurrent LIVE deliveries cannot bind the same drone (enforced by the
database, not application code). A delivery whose payload exceeds every available aircraft's
capacity is queued or rejected, not assigned.

---

### Phase 12 — Flight-ops layer · M · backend + admin · *depends on Phase 11*

1. **Append-only flight log.** `DeliveryTracking` is one last-known-position row that every
   frame overwrites, and `routeJson` (`schema.prisma:452`) is declared and never written. After
   a crash or a watchdog reap there is nothing to reconstruct — the last frame before loss of
   comms has already been overwritten. Add append-only frames with altitude, battery, airspeed.
2. **Energy management.** Battery does not exist in this system in any form — not a telemetry
   field, not a column, not a gate, not a metric. Add state-of-charge as a dispatch precondition,
   a reserve margin, and an auto-RTB threshold. The mechanism to act on it is already built and
   tested (`RETURN_TO_BASE` with full issue/poll/ack/CAS and a stranded-ack reconciler) — nothing
   ever computes when to fire it except a human clicking in the console.
3. **Re-gate weather and airspace at dispatch.** Serviceability is evaluated in the quote and in
   `create()`, and never again — a delivery booked 60 days out is weather-checked at booking and
   then launched by a kickoff job with zero re-check (`simulation.processor.ts:89-117`). The check
   that matters is the one immediately before rotor spin-up.
4. **Airspace as data.** Today it is two hardcoded circles around Soekarno-Hatta and Halim
   (`serviceability.constants.ts:6-27`), with no altitude dimension — restricted airspace is a 2D
   disc. Move to DB-backed zones with time windows and altitude ceilings.
5. **Flight-ops console** — live airborne map, cross-status exception queue (the admin query
   accepts one status enum, so RETURNING + DELIVERY_FAILED + long-silent IN_TRANSIT cannot be
   listed together), sort by telemetry staleness. The tracking WS fanout the mobile app already
   consumes is unused by admin.
6. **Incident management** — crash/loss workflow, fleet-wide grounding after a defect,
   post-incident report. Today total loss of comms is indistinguishable from a crash in the data
   model.
7. **Operator audit log.** Force-cancel, fail-with-reason, goodwill refund, role changes and
   promo edits leave only a pino line that rotates away. `forceCancel(deliveryId)` and
   `fail(deliveryId, reason)` do not even receive an admin id — the actor is dropped at the
   controller boundary. The pattern exists in 2 of 8 mutations already.

---

## §4. Backlog — not scheduled into a phase

Real findings that did not make the critical path. Pull into a phase when relevant.

**Product / growth**
- Recipient channel — recipient has no contact record, no tracking link, and the handoff code is
  stored only on the *sender's* device. The UI admits it: *"Ask the sender to read it to you."*
- Handoff arrival window: countdown, "I'm outside now", grace-timer expiry auto-RTB.
- Drop-zone selection — the app makes the user drop an exact pin then discards the coordinates.
- Real arrival window — `estimatedDelivery` is declared and never written; the app adds a flat
  two hours regardless of distance.
- Customer-initiated mid-flight recall.
- Serviceability/weather preflight in the booking form.
- In-app claim/dispute flow.
- Promo budget caps (capped by count, not dollars) and referral fraud limits (one guard, no
  email-verification precondition — N throwaway addresses self-mint credit).
- GDPR: no delete, no export, no consent record, retention disabled by default.
- Localization is unreachable — a complete id catalog exists; mobile never sends `Accept-Language`.
- B2B/merchant platform (blocked on an Organization primitive above User).

**Correctness / quality**
- Delivery list pagination has no unique tiebreaker for `sort=title|status` on a partitioned table.
- Signup is an account-existence oracle; `login()` returns before `bcrypt.compare` on a missing user.
- Admin rewrites every 401 as "Your session has expired", so a wrong password reports a session expiry.
- `pickupDate` rendered with `toLocaleString` in admin — wrong day west of UTC.
- Orders search: unsequenced request per keystroke, no debounce, no abort.
- `outbox_events` rows are never purged or partitioned.
- MQTT ingest bypasses app-layer auth and discards the topic, so the `<droneId>` segment is never
  checked against the frame.
- Mobile add-card form collects full PAN + CVV and discards them — nothing is tokenized.
- Edit-profile email field is validated then never sent.
- Home/Orders screens render nothing on error; several permission dead-ends with no
  `canAskAgain` branch.

**Accessibility** *(full list in the artifact)*
- Primary CTA contrast ≈2.49:1 vs 4.5:1 required — every major button, in an outdoor app.
- Icon-only controls unlabeled almost everywhere (2 components set a11y props in the whole app).
- Admin table rows keyboard-unreachable.
- Touch targets 18×18 / 32×32 / 36×36 with no `hitSlop`.
- Selection state conveyed by background colour alone.

**Testing**
- The one e2e spec is dead code: `rootDir: "src"` excludes `test/app.e2e-spec.ts`, and it is
  still the Nest scaffold asserting `GET '/' → 'Hello World!'`. Nothing validates the
  create→promo→wallet-debit co-commit, the status CAS under concurrency, partition routing, or
  webhook idempotency.
- Mobile has no test job in CI; backend lint is `continue-on-error`.

---

## §5. Log protocol — **required at the end of every phase**

Append an entry to `AUDIT-LOG.md` when a phase reaches a terminal state
(done, partially done and paused, or skipped). Also update the §2 status table in this file.

Use exactly this shape so entries stay diffable and scannable:

```markdown
## Phase N — <name> — <STATUS>
**Date:** YYYY-MM-DD
**Session:** <how to identify this session, e.g. branch name or a one-line note>
**Branch / commits:** <branch>, <sha> … (or "not committed")

### What changed
- <repo> `path/to/file.ts:LINE` — one line on what and why

### Verification
- backend: tsc ✔ / lint ✔ (N warnings) / tests N passed
- mobile:  tsc ✔ / lint ✔ / tests N passed
- admin:   tsc ✔ / lint ✔ / tests N passed
- Manual: <what you actually exercised, beyond the suites — see §1.1>

### Decisions made
- <any judgment call a future session must not silently reverse, and why>

### Deviations from the plan
- <anything you did differently, or deliberately skipped, and why>

### Left undone / follow-ups
- <specific, actionable — this is what the next session picks up>

### Next
- <the phase you'd do next and any new information that changes the ordering>
```

**Rules**
- Never rewrite a past entry. Append a correcting entry instead.
- If a phase is abandoned mid-way, still log it with `PAUSED` and be precise in *Left undone* —
  that section is the handoff.
- If you discover the plan is wrong, fix this file **and** record the change under
  *Deviations* so the disagreement is visible.
- Keep the §2 status table in sync — it is the fastest orientation for a new session.

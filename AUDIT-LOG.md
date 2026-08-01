# Drovery — Audit Remediation Log

Append-only progress log for `AUDIT-PLAN.md`. **Newest entry at the bottom.**

**New session? Read this file bottom-up to find where the last one stopped, then read
`AUDIT-PLAN.md` §0–§2.** The format for entries is defined in `AUDIT-PLAN.md` §5 — follow it
exactly, and never rewrite a past entry (append a correction instead).

---

## Phase — Audit & plan authored — DONE
**Date:** 2026-07-26
**Session:** initial audit session (no code changes)
**Branch / commits:** not committed — `AUDIT-PLAN.md` and `AUDIT-LOG.md` are new untracked files
in `Drovery_Backend/`

### What changed
- No source code was modified. This session audited all three repos and produced the plan.
- `Drovery_Backend/AUDIT-PLAN.md` — new, the remediation plan
- `Drovery_Backend/AUDIT-LOG.md` — new, this file

### Verification
Baseline captured on three clean checkouts (`npm ci` in each; `npx prisma generate` in backend):

| Repo | Branch @ SHA | Typecheck | Lint | Tests |
|---|---|---|---|---|
| Backend | `docs/rewrite-readme` @ `fb41364` | ✔ clean | ✔ 0 errors / 98 warnings | ✔ 80 suites, **729** passed |
| Mobile | `docs/readme-and-app-fixes` @ `a87fb26` | ✔ clean | ✔ clean | ✔ 39 suites, **279** passed |
| Admin | `docs/rewrite-readme` @ `0701675` | ✔ clean | ✔ clean | ✔ 16 suites, **65** passed |

**Total: 1,073 tests passing.** Treat these numbers as the regression baseline — a phase that
lowers any of them without an explicit, logged reason has broken something.

Backend test run emits a Jest teardown warning (*"A worker process has failed to exit
gracefully"*). Pre-existing, not introduced by this work; likely related to the shutdown-ordering
issue in Plan Phase 9.4.

### Method
Multi-agent pass over all three repos: independent finders per dimension (backend domain, money,
authz, async/realtime; mobile; admin; cross-repo contract), then an adversarial verification
stage that attempted to refute each claim against real code. **31 bugs survived verification;
10 were refuted and excluded.** Plus 32 UI/UX findings and 32 feature-gap candidates.

Findings marked *verified* in the artifact were additionally confirmed by hand in this session:
the scheduled-delivery format chain, the uncaptured-payment chain, the watchdog
`AWAITING_HANDOFF` race, both halves of the dead support pipeline, the missing mobile auth gate,
the four `BackHandler.exitApp()` sites, the Track Package keyboard/hex-ID mismatch, unenforced
`MAX_WEIGHT_KG`, the absent Alertmanager, the e2e spec excluded by `rootDir`, and the absence of
any `Drone` model.

Full report: https://claude.ai/code/artifact/862b5828-c24f-479d-8a52-c5a4b7e29fff

### Decisions made
- **Ordering:** stop-the-bleeding (money, credentials, physical dispatch) before structural work.
  The Drone entity is the largest gap but is deliberately Phase 11, because shipping it does not
  stop a user being charged nothing or a scheduled drone launching immediately.
- **Phase 8 (alerting/backups) is marked independent** and can be pulled forward at any point —
  it is the cheapest real risk reduction in the repo and blocks nothing.
- **Plan anchored in `Drovery_Backend/`** because that is the primary working directory a session
  starts in, even though most phases touch two or three repos.
- Nothing was committed. Branches are still the pre-existing `docs/*` ones.

### Deviations from the plan
- None — this is the plan's origin entry.

### Left undone / follow-ups
- Everything. No remediation work has started; all 13 phases are `☐ Not started`.
- **Not yet decided by the user:** whether to add a `CLAUDE.md` in `Drovery_Backend/` pointing at
  `AUDIT-PLAN.md`. Without it, a new session only finds the plan if told to look, or if it lists
  the directory. Recommended, but it changes every future session's context, so it was left as
  an explicit choice.
- One audit claim remains **unconfirmed** and is flagged in Plan §1.4: that
  `DeliveryDetailScreen.tsx:205` passes a trackingId rather than the delivery UUID. The 404
  behaviour on workflow steps is real; the line reference is not. Trace the runtime value rather
  than trusting the citation.

### Next
- **Phase 0 — Baseline capture.** Mostly already done above; a session picking this up can
  confirm the numbers still hold and move straight to Phase 1.
- Then **Phases 1–5**, which are independent of each other and can be done in any order.
  Phases 3 and 4 between them remove three of the five critical findings.

---

## Phase 1 — Pricing trust boundary — DONE
**Date:** 2026-07-26
**Session:** same session as the audit; work done on the pre-existing `docs/rewrite-readme` branch
**Branch / commits:** not committed — all changes are working-tree only in `Drovery_Backend/`

### What changed

**The fix itself**
- backend `src/deliveries/deliveries.service.ts:513` — `resolveCoords()` rewritten. The
  server-side geocode of `fromAddress`/`toAddress` is now AUTHORITATIVE for pricing,
  serviceability and the stored flight route. Caller coords are never used. Both addresses
  are geocoded in parallel on every create.
- backend `src/deliveries/deliveries.service.ts:552` — new `assertCoordAgreesWithAddress()`:
  a caller coord more than `MAX_COORD_DEVIATION_KM` (1 km, new const at :109) from its
  address's geocode is a 400. Input-sanity only; the geocode still wins regardless.
- backend `src/common/package-limits.ts` — **new file**, `assertWeightWithinCap()`. Wires
  `MAX_WEIGHT_KG`, which had existed since the beginning with **zero call sites**.
- backend `src/deliveries/deliveries.service.ts:176` — cap enforced at the top of `create()`,
  before any geocode/pricing/DB/queue work.
- backend `src/pricing/pricing.service.ts:69` — cap enforced in `estimate()` so the quote
  refuses to price an unliftable package instead of failing later at create.
- backend `src/recurring-deliveries/recurring-deliveries.service.ts:22` — cap enforced when
  the schedule is DEFINED (see *Deviations* — this came out of review).
- backend — lat/lng `@Min/@Max` bounds on `create-delivery.dto.ts`, `estimate-price.dto.ts`,
  `create-recurring-delivery.dto.ts`.
- backend `src/i18n/catalog/{en,id,keys}.ts` — two new error keys
  (`error.delivery.package.weight_exceeds_cap`, `error.delivery.coords.address_mismatch`),
  added to both locales and `ERROR_KEYS` so the completeness spec passes.

**Regression repairs found by the review pass (see *Deviations*)**
- backend `src/deliveries/deliveries.service.ts:1098` (reorder),
  `src/favorites/favorites.service.ts:70` (favorite-order),
  `src/recurring-deliveries/recurring.materializer.ts:156` (materializer) — these three
  in-process replay paths no longer forward stored coords into `create()`.
- backend `src/geo/geo.service.ts:55,91` — `fetchGeocode` now distinguishes `not_found`
  (provider answered, no such address → safe to negative-cache) from `failed`
  (429/5xx/network/malformed → **never cached**). Previously both returned `null` and were
  negative-cached for an hour.

### Verification
- backend: tsc ✔ / lint ✔ (0 errors, **98 warnings — unchanged from baseline**) /
  **80 suites, 741 tests passed** (baseline 729; +12 new)
- mobile:  tsc ✔ / tests ✔ 39 suites, 279 passed (untouched, re-run to confirm no contract break)
- admin:   untouched, not re-run (no shared surface with this change)

**Manual / beyond-the-suite checks** (see Plan §1.1 — green tests are not sufficient here):
- **Mutation test.** Temporarily reverted `resolveCoords` to "caller coords win" and re-ran.
  Exactly the two authority tests failed, with pricing receiving the caller's `-6.9025`
  instead of the geocoded `-6.903`. The other five trust-boundary tests kept passing, which
  is correct — they cover the deviation check and the weight cap, not coord authority.
  File restored and re-verified green. **The new tests genuinely fail if the fix is reverted.**
- Enumerated every `create()` call path: HTTP controller, `favorites.service.ts:62`,
  `recurring.materializer.ts:113`, `deliveries.service.ts:1090` (reorder). All four are
  covered by the service-level cap; three of them never see `ValidationPipe`, which is why
  a DTO decorator alone would not have closed the hole.
- Compared mobile's `MAX_WEIGHT_KG` (`features/delivery/screens/CreateDeliveryScreen/validators.ts:3`)
  against the backend's: byte-identical (Small 0.5 / Medium 1.5 / Large 3 / XL 5). No
  legitimate mobile user hits a new 400 — the server now enforces what the client already did.
- Confirmed mobile sends no `fromLat`/`toLat` on create, so making the geocode mandatory
  breaks no first-party client.

### Decisions made
- **Geocode is authoritative for pricing, serviceability AND storage** — caller coords are
  validated and then discarded, not merged. Simplest thing that fully closes the hole. When
  the drop-zone feature lands (Plan §4), precise coords get a properly trusted path; until
  then a "precise pin" has nowhere safe to live.
- **The deviation check is for CALLER input only.** Server-stored coords replayed by
  reorder/favorites/materializer are not caller input and must not be run through it. This is
  why those three paths now send no coords at all.
- **Fail-closed on geocode failure retained.** An unresolvable address still 422s rather than
  falling back to caller coords — that fallback is precisely the trust boundary being closed.
  Mitigated by no longer caching provider failures.
- `MAX_COORD_DEVIATION_KM = 1` km. At `PER_KM_RATE` ($1.5/km) the residual manipulation a
  caller can induce is bounded at a few dollars, and only by lying about their own pin while
  the geocode still prices the route.

### Deviations from the plan
- **Plan step 1 said client coords "may still seed the simulation route".** They do not — they
  are discarded entirely. Keeping them would have meant a second, unvalidated coordinate
  source on the flight path, which defeats the point.
- **Scope grew by two items, both from the adversarial review of my own diff** (17 agents,
  4 lenses, 10 findings confirmed / 3 refuted). Both were real regressions I introduced:
  1. *Internal replay paths.* reorder / favorite-order / the recurring materializer all
     forwarded server-stored coords, which my new deviation check then judged as if they were
     untrusted caller input. In the materializer the resulting 400 lands in a catch that logs
     a warning **after the cursor has advanced**, so a single imprecise stored coord would have
     silently dropped *every future occurrence* of a recurring schedule. Fixed by not
     forwarding coords.
  2. *Negative-cached provider failures.* `GeoService` could not tell "no such address" from
     "Nominatim returned 429", and cached both for an hour. Harmless while coords could
     bypass the geocoder; once I made geocoding mandatory it meant one transient blip = an
     hour of hard 422s. Fixed by only caching a real not-found.
- **Added `assertWeightWithinCap` to `RecurringDeliveriesService.create`** (not in the plan).
  Without it an over-cap schedule saved as active and then failed once per occurrence inside
  the materializer, where the error is swallowed — an "active" schedule silently producing
  nothing forever.
- **One of my own tests was initially worthless and I rewrote it.** The first version of the
  "can't zero the distance fee" test set `toLat/toLng` equal to the pickup, which trips the
  deviation check *before* pricing is reached — proving nothing about coord authority. It now
  uses coords nudged ~55 m (inside tolerance), where being ignored is the only thing that can
  make it pass. The review independently flagged this class of problem as its top question.
- **Test fixtures changed:** the shared `createDto` (`Medium`/2 kg) and the recurring
  `template` (`Medium`/2 kg) were both over the cap and had to become 1.5 kg. These were
  physically impossible packages, so the fixtures were wrong, not the cap.

### Left undone / follow-ups
- **Duplicated `MAX_WEIGHT_KG` across repos.** Backend `src/common/constants/index.ts:15` and
  mobile `features/delivery/screens/CreateDeliveryScreen/validators.ts:3` are byte-identical
  today and will silently drift. Added to Plan §4 backlog territory; worth a shared source.
- **No dimension field.** The cap is weight-only, so a bulky-but-light package is still
  undetectable. Already noted in the audit; not in Phase 1 scope.
- **`GEO_MISS_TTL_S` still 1 hour for genuine not-founds.** Correct, but it means a typo'd
  address stays rejected for an hour even after the user fixes their listing upstream.
  Acceptable; noting it because it surprised a reviewer.
- **No integration test** covers create→geocode→price end-to-end against a real stack — the
  e2e spec is still dead code excluded by `rootDir: "src"` (Plan §4, Testing).
- Not committed. `AUDIT-PLAN.md`, `AUDIT-LOG.md` and `src/common/package-limits.ts` are
  untracked; everything else is a working-tree modification on `docs/rewrite-readme`.
- Pre-existing dirty files **not** touched by this phase, present since before the audit:
  `src/common/monitoring/tracing.ts`, `src/common/swagger.ts`, `src/mqtt/mqtt.service.spec.ts`,
  `src/prisma/prisma.service.spec.ts`.

### Next
- **Phase 2 — Credentials hygiene** (S, backend): stop logging rendered mail bodies, revoke
  refresh tokens inside the password-reset transaction. Independent of everything done here.
- Phases 3, 4, 5 remain independent of each other; 3 and 4 together clear three of the five
  critical findings.
- **New information for whoever does Phase 6:** `recurring.materializer.ts:113-128` swallows
  every `create()` failure into a `logger.warn` *after* advancing the cursor, so any
  permanent per-schedule error silently drops occurrences forever with no user-visible signal.
  That is pre-existing behaviour and out of Phase 1 scope, but it makes the materializer a
  bad place for any new validation to surface — validate at schedule-definition time instead.

---

## Phase 2 — Credentials hygiene — DONE
**Date:** 2026-07-26
**Session:** same session as the audit and Phase 1; working on `docs/rewrite-readme`
**Branch / commits:** not committed — working-tree only in `Drovery_Backend/`

### What changed

**Stop leaking token material into logs**
- `src/mail/mail.service.ts:76-120` — `send()` logged the rendered body, which carries the
  password-reset and email-verification tokens in cleartext, at info level in BOTH branches.
  The no-provider branch is the DEFAULT deploy path (nothing is integrated), so production
  was writing live credentials to its logs. Now: metadata only (`text Nb, html Nb`), plus a
  new `logBodyInDevOnly()` that emits the body **only when `NODE_ENV !== 'production'`**.
- `src/app.module.ts:97` — pino `redact` widened from 2 entries to 10: adds `x-ingest-key`,
  `set-cookie`, and body fields `password` / `newPassword` / `currentPassword` / `token` /
  `refreshToken` / `code`.

**End sessions on a password reset**
- `src/auth/auth.service.ts` `resetPassword()` — a third operation co-committed in the
  existing `$transaction`: every refresh token for the user is removed. Previously a token
  stolen before the reset stayed valid for its full 7-day life and could mint access tokens
  indefinitely by rotation, so the one action a user takes *because* they think they are
  compromised did not actually evict the attacker.

**Refresh-token reuse detection** (the plan's optional item 4)
- `src/auth/auth.service.ts` `refreshTokens()` — a token that exists, belongs to the caller,
  and is already revoked is a REPLAY (rotation makes each valid exactly once). All the user's
  active tokens are revoked, a warning is logged, 401. Guarded on `record.userId === userId`
  so a stranger presenting a guessed hash cannot use it as a logout oracle.

**Design change that reuse detection forced** (see *Deviations*)
- `logout()` and `resetPassword()` now **DELETE** their rows instead of stamping `revokedAt`.
  `revokedAt` therefore means exactly one thing — *superseded by rotation* — which is what
  makes reuse detection safe. Verified first that `revokedAt` is read nowhere outside
  `auth.service.ts`: no admin query, analytics, or audit surface touches `refresh_tokens`.
- `src/auth/auth.service.ts` — rotation is now **atomic**. Extracted `signTokens()` (sign, no
  persist), `rotateTokens()` (sign + `$transaction([revoke old, create new])`) and left
  `generateTokens()` (sign + create) for fresh logins. Previously the revoke and the insert
  were two separate writes.

**Test infrastructure**
- `src/test/prisma-mock.ts` — `createMany`/`updateMany`/`deleteMany` now default to
  `{ count: 0 }` instead of `undefined`, matching Prisma's real BatchPayload contract. Every
  CAS in this codebase destructures `{ count }`, so the old default made any such service
  blow up with a TypeError in a spec that simply didn't stub the return.

### Verification
- backend: tsc ✔ / lint ✔ (0 errors, **98 warnings — unchanged from baseline**) /
  **80 suites, 746 tests passed** (Phase 1 left it at 741; +5 new)
- mobile / admin: untouched, not re-run (no shared surface — this is server-internal)

**Mutation tests** (see Plan §1.1 — green tests are not sufficient):
each mutation was applied, the targeted spec run, and the file restored.

| Mutation | Intended test | Result |
|---|---|---|
| `logout()` back to soft-revoke | "deletes the presented refresh token" | ✔ failed |
| `resetPassword` back to soft-revoke | "ends every session" | ✔ failed |
| reuse detection removed | "…treats replay…as a breach" | ✔ failed |
| `NODE_ENV` gate removed | "NEVER logs the rendered body in production" | ✔ failed |

Also verified by hand that the `NODE_ENV` gate is not a no-op in this project's deployments:
`Dockerfile:36` bakes `ENV NODE_ENV=production` into the image and `k8s/base/kustomization.yaml:25`
sets it. Only `k8s/overlays/loadtest` deliberately uses `development` — synthetic traffic with
placeholder secrets, so bodies logged there are acceptable.

### Decisions made
- **DELETE rather than soft-revoke on logout/reset.** The alternative was a `revokedReason`
  enum, which needs a migration. Deleting is no weaker (an absent row fails the lookup
  outright), needs no schema change, and gives `revokedAt` a single unambiguous meaning.
  The cost is losing a logout audit trail, which nothing consumed.
- **The mail body is emitted at INFO, not debug.** Review caught that the pino level defaults
  to `info` (`app.module.ts:82`) and `LOG_LEVEL` is set nowhere in the repo, so a debug line
  is dropped by the running app — the dev escape hatch would have been silently dead while
  its own unit test passed (Jest uses the Console logger, which has no level filter). The
  `NODE_ENV` guard, not the log level, carries the security property.
- **`passwordChangedAt` / access-token revocation deliberately NOT done.** Recorded in Plan
  §Phase 2 step 3 with the reasoning. Short version: `JwtStrategy.validate` does no I/O, so
  the check would add a round trip to every authenticated request. Residual exposure is one
  15-minute access-token lifetime.

### Deviations from the plan
- **Scope grew, again from the adversarial review of my own diff** (9 agents, 3 lenses, **6
  findings confirmed, 0 refuted**). Two were regressions I introduced:
  1. *Reuse detection could not tell rotation-replay from benign revocation.* `revokedAt` was
     overloaded across rotation, `logout()`, and the bulk revoke I had just added to
     `resetPassword()`. Confirmed reachable with an ordinary multi-device scenario: user
     resets on their phone → all tokens revoked → they log back in → the tablet wakes, replays
     its pre-reset token → family-kill destroys the session they *just* created, and a
     breach warning is logged for something that never happened. Fixed by making the benign
     paths delete.
  2. *Rotation was not atomic.* Pre-existing, but reuse detection made its consequences worse:
     a failed insert after a successful revoke left the user holding a revoked-and-unreplaced
     token, whose next retry would then look like a replay. Fixed with `rotateTokens()`.
- **`src/test/prisma-mock.ts` touched**, which is outside the phase's nominal surface. It was
  the correct fix — the mock contradicted Prisma's real contract — rather than making
  production code defensive against a bad mock.
- **I told the user reuse detection had "landed" before the review came back.** It had, but
  with the false-positive above. Corrected in the same session; noting it because the log is
  the record and the intermediate claim was optimistic.

### Left undone / follow-ups
- **`passwordChangedAt` / access-token revocation** — see Plan §Phase 2 step 3.
- **No `revokedReason` column.** The delete-based design is correct today *because* nothing
  outside `auth.service.ts` reads `refresh_tokens`. If an admin "active sessions" view or a
  logout audit trail is ever added, that assumption breaks and the column becomes necessary.
  Flagged in Plan §Phase 2 step 4 so it is not silently reintroduced.
- **No rotation grace window.** A client that loses the *response* to a successful refresh
  (network drop after commit) still holds the old token; retrying now trips reuse detection
  and logs them out everywhere. Real but narrow, and the standard mitigation
  (`replacedById` + a few seconds' grace) needs the same migration as above.
- **`LOG_LEVEL` is undocumented.** Not in `.env.example` or any deploy manifest. Worth adding
  with a note, independent of this phase.
- Not committed. Same working-tree state as Phase 1.

### Next
- **Phase 3 — Scheduled-delivery contract** (S, backend + mobile). The highest-severity bug
  in the audit: every "scheduled" delivery dispatches a drone immediately. First phase that
  touches the mobile repo, so expect to re-run the mobile suite.
- Phases 4 and 5 remain independent. 3 and 4 together clear three of the five criticals.
- **New information for later phases:** `revokedAt` now has exactly one meaning. Any future
  code that soft-revokes a refresh token for a new reason MUST add `revokedReason` first, or
  it will silently turn benign flows into mass logouts.

---

## Phases 3 + 4 + 5 — Scheduled-delivery contract · Mobile stop-the-bleeding · Price honesty — DONE
**Date:** 2026-07-26
**Session:** same session as the audit and phases 1–2; user was away, so all judgment calls were made autonomously per their instruction
**Branches (both pushed, neither merged):**
- backend `fix/audit-phase-3-schedule-contract` — 11 commits, branched off `fix/audit-remediation-phases-1-2` (NOT `main`: it edits `create-delivery.dto.ts`, which that branch already changed)
- mobile `fix/audit-phases-3-4-5` — 26 commits, branched off `docs/readme-and-app-fixes` (NOT `main`: it edits `CongratulatoryScreen.tsx`, which commit `a87fb26` on that branch already changed — branching off main would have folded someone else's commit into this diff)

### What changed

**Phase 3 — the scheduled-delivery contract (the audit's highest-severity bug)**
- mobile **NEW** `features/delivery/utils/pickupDateTime.ts` — the single source of truth for
  the wire format. Form state now HOLDS `YYYY-MM-DD` / 24h `HH:MM`; only what a human reads is
  localized. `toWireDate` uses LOCAL calendar fields, not `toISOString`, which would report the
  previous day for every user east of UTC.
- mobile `DateTimePickerField` (displays formatted, emits wire, seeds the calendar),
  `CustomTimePicker` (12-hour wheel kept — only the boundary value changed), `validators.ts`
  (now REJECTS an unparseable pickup where it used to return `true`), `helpers.estimateDelivery`,
  and the display sites on Confirmation / Congratulatory / DeliveryDetail / Orders / Home.
- backend `delivery-schedule.ts` now EXPORTS `PICKUP_DATE_RE` + `PICKUP_TIME_RE` so a DTO
  validator cannot drift from the parser, plus `isValidPickupDate()` (see *Deviations*).
- backend `@Matches` on all three pickup DTOs; a service-level calendar check in `create()`;
  dedicated i18n keys so the 400 says what shape is wanted.

**Phase 4 — mobile stop-the-bleeding**
- **NEW `AuthGate`** in `app/_layout.tsx`. One mechanism for two bugs: a cold start used to
  discard a valid session (`app/index.tsx` was `export { default } from './login'`), and on
  refresh-token expiry the app cleared auth state but never navigated. `index.tsx` is now a
  neutral spinner the gate redirects away from.
- The four `BackHandler.exitApp()` sites: Home is `useFocusEffect` + double-press-to-exit, Login
  is `useFocusEffect` + exit (it is the root of the signed-out stack), Profile and Signup are
  removed. Tab screens never unmount in Expo Router, so a mount-scoped handler stayed registered
  for the whole session and quit the app from anywhere.
- `TrackPackageScreen`: `number-pad` → `default` + `autoCapitalize="characters"`. Tracking IDs
  are `uuidv4().slice(0,8).toUpperCase()`, so ~98% contain a letter and could not be typed.
- `DeliveryDetailScreen.handleAction` passes `apiDelivery.id`, and `WorkflowScreen` alerts
  instead of swallowing a failed step (see *Deviations* — the audit's line reference was wrong).

**Phase 5 — price honesty at checkout**
- mobile **NEW** `utils/currency.ts` — one `formatCurrency`. The app had four formatters, two on
  the same screen: the price bar read `$37` while the promo card directly above rendered the
  SAME total as `Rp37.000`.
- `ConfirmationDeliveryScreen`: no client-side seed; the estimate now sends the route and re-runs
  when geocoding resolves; a distance-less quote is treated as INCOMPLETE rather than cheap; the
  swallowed `.catch` is surfaced; a promo previewed against a superseded total is dropped;
  confirm is blocked until a real server price is on screen.
- `helpers.calcPrice` and `PriceEstimationScreen`'s `calcBreakdownLocal` both DELETED.

### Verification
- backend: tsc ✔ / lint ✔ (0 errors, **98 warnings — unchanged baseline**) / **80 suites, 755 tests** (phase 2 left 746)
- mobile: tsc ✔ / lint ✔ / **41 suites, 286 tests** (baseline 279)
- admin: untouched.

**On the mobile count.** It is 286, not 279 + everything added: 7 `calcPrice` tests and 6
`calcBreakdownLocal` tests were deleted *with the functions they tested*, and 20 new ones added.
Per Plan §1.1 a drop needs an explicit reason — this is it. Both suites asserted a client-side
total with no distance term, i.e. exactly the number the screens must never show.

**Mutation tests** — each applied, the targeted spec run, the file restored:

| Mutation | Intended test | Result |
|---|---|---|
| calendar guard back to shape-only | "calendar guard the regex cannot express" | ✔ failed |
| calendar guard back to shape-only | "not a real calendar date" (service) | ✔ failed |

**Manual checks beyond the suites:**
- Enumerated all 33 route files under `app/` against the gate's segment sets. The 7 public ones
  match exactly; everything else is protected; `(tabs)` correctly falls through as protected.
  `reset-password` and `verify-email` are public, so email deep links still work signed out.
- Grepped the whole mobile repo for surviving 12-hour parsing/emitting. The only AM/PM left is
  the time-picker WHEEL and `formatWireTime` — both display-only. No other screen produces a
  pickup value; `favoriteApi` merely declares the fields, and recurring only displays `timeOfDay`.
- Confirmed Phase 1 did not break this: mobile's `geocodeAddress` goes through the backend's own
  `/geo`, the same `GeoService` used for pricing, so client coords match the server geocode
  exactly and the >1km deviation check never fires on a first-party request.

### Decisions made
- **Wire format stored, display format derived.** The alternative — carrying two values through
  form state and route params — doubles the number of places that can disagree. `formatWire*`
  passes unrecognized input through, which also makes old rows (stored as `"09:30 AM"`) render
  correctly with no migration.
- **The 12-hour wheel stays.** Only the value crossing the component boundary changed. Picking a
  time is a UX question; the wire shape is a correctness one.
- **Calendar validation in the service, not a custom class-validator constraint.** Same reasoning
  as the Phase 1 weight cap: reorder, favorite-order and the materializer never see the
  ValidationPipe. `@Matches` still guards the shape at the boundary for a fast, well-localized 400.
- **One gate rather than per-screen redirects.** Cold-start and session-expiry are the same
  question ("does auth state agree with the current route"), so they get one answer. Manual
  `router.replace` calls that duplicated it were removed.
- **Android Back differs per screen deliberately:** exit from Home (double-press) and Login (root
  of the signed-out stack); plain back from Profile and Signup, where quitting mid-form is never
  what the user meant.

### Deviations from the plan
- **Scope grew from the adversarial review of my own diff** (20 agents, 4 lenses, **13 findings
  confirmed, 3 refuted**). One was a **critical bug I introduced**:
  1. *AuthGate stranded every signed-out cold start.* I had `""` (the index route) in
     `PUBLIC_SEGMENTS`, so a signed-out user at `/` was "public, nothing to do" — and `index`
     renders only a spinner. Permanent spinner, `/login` unreachable. Fixed by removing `""` from
     the public set, leaving it only in `AUTH_ONLY_SEGMENTS`.
  2. *A quote whose route never resolved was rendered as the final Total* with the distance fee
     missing and confirm still enabled. Now `!res.distanceKm` is treated as an incomplete quote.
  3. *An applied promo went stale* when the price re-fetched after geocoding, so the bar showed a
     discount computed against a total that no longer existed. The promo is now cleared.
  4. *`CustomTimePicker` mapped 12 o'clock to the wheel's "01" slot* — pre-existing, but I
     rewrote that function so I fixed it. Minute 58 also wrapped to "00" instead of "55".
  5. *`PriceEstimationScreen` still had `calcBreakdownLocal`* — the surviving twin of the
     `calcPrice` I deleted, on the screen whose entire purpose is showing a price.
  6. *`PICKUP_DATE_RE` was shape-only.* `2026-02-31` matched and `Date.UTC` silently rolled it to
     Mar 3; `2026-00-10` reached Prisma as an Invalid Date and 500'd instead of 400-ing. Added
     `isValidPickupDate` — the same round-trip guard the mobile `parseWireDate` already had. The
     two sides of the contract were not equivalent in both directions.
- **Plan §1.4's "ghost" is resolved.** The audit claimed `DeliveryDetailScreen.tsx:205` passes a
  trackingId. That line passes `delivery.id` — but the view-model at `:120` sets
  `id: apiDelivery.trackingId`, *overwriting* the UUID. The bug was real and the line reference
  was wrong, exactly as §1.4 warned. Fixed at the call site by passing `apiDelivery.id`.
- **One commit is mislabelled.** Mobile `473ee70` ("fix(nav): scope the exit-on-back handler…")
  also contains the `formatWireTime` change to the Home ETA, because I edited that file twice
  before committing. The code is correct; the message under-describes it. Not rewritten — 26
  commits of history churn is disproportionate to a message.

### Left undone / follow-ups
- **The Google Maps API key is still `YOUR_GOOGLE_MAPS_API_KEY`** (`app.json:26`), so the Android
  map remains a grey rectangle. Blocked on a credential I do not have; I deliberately did not
  invent one or convert `app.json` to `app.config.js` (a build-format change I could not verify
  without running prebuild). **This is the only Phase 4 item not done** — hence the ◐ in §2.
- **`MAX_WEIGHT_KG` is still duplicated** between backend `src/common/constants/index.ts` and
  mobile `features/delivery/screens/CreateDeliveryScreen/validators.ts`. Byte-identical today; a
  comment now says so on the mobile side. Carried over from Phase 1.
- **`estimateDelivery` is still pickup + 2 hours, flat.** Kept only so the screen shows
  something. The real fix is the backend populating `estimatedDelivery`, which is declared on the
  model and never written (audit backlog).
- **No test covers `AuthGate` itself.** It needs expo-router navigation mocking; I verified it by
  enumerating all 33 routes by hand instead. Worth a real test when someone next touches routing.
- Neither branch is merged. Backend stacks on the phases 1–2 branch, so merge that first.

### Next
- **Phase 6 — Terminal-path atomicity** (M, backend): CAS in `cancel()`, the missing card-refund
  leg, narrowing the watchdog reap CAS, gating `submitProof`. Independent of everything above.
- **New information for later phases:** the mobile app now has two shared utility modules worth
  reusing rather than re-inventing — `features/delivery/utils/pickupDateTime.ts` and
  `utils/currency.ts`. Any new screen showing money or a pickup time should use them.

---

## Phase 6 — Terminal-path atomicity — DONE (one item deferred)
**Date:** 2026-07-26
**Session:** same session; user away, decisions made autonomously per their instruction
**Branch:** `fix/audit-phase-6-terminal-atomicity` — 10 commits, pushed, branched off
`fix/audit-phase-3-schedule-contract` (stacks: it edits `deliveries.service.ts`, which that
branch already changed)

### What changed
- `deliveries.service.ts` `cancel()` — **now single-winner**. It was the only status transition
  in the file without a CAS: read, three network round-trips of cleanup, then an
  *unconditional* write. The read is advisory, so a lost race both refunded a completed
  delivery and overwrote its terminal status with CANCELED. The CAS now runs BEFORE any
  cleanup, so only the winner cleans up.
- `cancel()` and `adminForceCancel` — **now refund both legs**. Both released the promo and
  returned the wallet-credit portion but never `refundChargeToWallet`, so a customer who paid
  partly by card was silently short-refunded while every exception path returned both.
- `cleanupAfterException` → **`cleanupAfterTermination`**, now shared by all four terminal
  paths (failExceptional, beginReturnToBase, cancel, adminForceCancel) so a new terminal
  cannot refund one leg and forget the other.
- `failExceptional` takes an optional `allowedStatuses`; `delivery-watchdog.ts` passes
  `WATCHDOG_STUCK_STATUSES`. The reap CAS was **wider than the query that selected the row**:
  `FAILABLE_STATUSES` includes `AWAITING_HANDOFF`, which the candidate query deliberately
  excludes. A delivery picked up as IN_TRANSIT that reached handoff mid-scan was failed and
  auto-refunded while the customer was walking outside. The stranded-ack path keeps the wider
  default on purpose — it replays an admin ABORT, legitimately allowed from AWAITING_HANDOFF.
- `proof.service.ts` `submitProof` — **gated on DELIVERED**. Ungated it minted proof for
  CANCELED/PENDING deliveries and, because it upserts, let the owner overwrite the lat/lng and
  recipientName recorded at the real handoff. Sibling `RatingService.rate` already gated this way.
- New i18n key `error.delivery.proof.not_delivered` in both locales + `ERROR_KEYS`.

### Verification
- backend: tsc ✔ / lint ✔ (0 errors, **98 warnings — unchanged baseline**) /
  **80 suites, 758 tests** (phase 3 left 755)
- mobile / admin: untouched.

**Mutation tests** — each applied, targeted spec run, file restored:

| Mutation | Intended test | Result |
|---|---|---|
| cancel back to an unconditional write | "does NOT clean up…when it loses the race" | ✔ failed |
| delete the `refundChargeToWallet` call | "refunds BOTH legs" | ✔ failed |
| watchdog reap back to the default CAS | "reaps a stuck LIVE IN_TRANSIT" | ✔ failed |
| remove the submitProof gate | "refuses to mint proof…never completed" | ✔ failed |

**The second mutation initially PASSED**, which would have meant a worthless test. The cause was
my mutation, not the test: I string-replaced the first occurrence of `refundChargeToWallet`
after the function start, which landed on a *comment* two lines above the call. Deleting the
actual call block fails the test correctly. Worth recording because it is the same failure mode
as a vacuous assertion, and only re-running it a second way surfaced it.

### Decisions made
- **CAS before cleanup, not after.** Ordering is the whole fix. Cleaning up first and writing
  second is what let a loser refund a delivery that had already completed.
- **One shared `cleanupAfterTermination`.** The two cancel paths had drifted from the exception
  paths by exactly one refund leg. Sharing the helper makes that drift impossible rather than
  merely fixed.
- **The watchdog narrows its own CAS; the stranded-ack path does not.** They look identical but
  mean different things: one is "this looks stuck", the other is "an operator explicitly ordered
  an abort". Only the first must exclude AWAITING_HANDOFF.
- **Partial-refund accounting DEFERRED to Phase 10** (see below) rather than half-fixed.

### Deviations from the plan
- **Plan item 5 (cumulative refunded amount on Payment) is NOT done.** Doing it properly needs
  either a schema column or a sum over the WalletTransaction ledger, AND a per-refund
  idempotency key instead of today's per-delivery `admin-refund:<id>` — a money-safety change
  that wants a real payments integration to test against, and Phase 10 rewrites this path
  anyway. I verified the admin console *does* expose a partial-amount field
  (`DeliveryDetailPage.tsx:169-172`), so simply rejecting partials would have removed a used
  capability. Documented in a block comment at the `refund()` site instead, with the precise
  reason and a pointer to Phase 10.
  **Not a double-refund**: the CAS still guarantees at most one credit per delivery across both
  channels. The failure mode is under-refunding, which is why leaving it is tolerable.
- No adversarial review workflow was run for this phase — the four changes are small, each is
  mutation-tested, and three of them are narrowing guards rather than new behaviour. Phases 1–5
  each got one; this is a deliberate step down in ceremony, not an oversight.

### Left undone / follow-ups
- **Partial-refund accounting** — see above. Phase 10.
- `cancel()` still does its cleanup outside a transaction (best-effort, idempotent, matching
  every other terminal path). Making terminal cleanup transactional is a larger change and was
  not in scope.

### Next
- **Phase 7 — Admin console unblock** (S, admin + backend), or **Phase 8 — Alerting & backups**
  (S, independent). Phase 8 is the cheapest real risk reduction left and blocks nothing.

---

## Phase 8 — Alerting & backups — DONE
**Date:** 2026-07-26
**Session:** same session; user away, decisions autonomous
**Branch:** `fix/audit-phase-8-alerting-backups` — 6 commits, pushed, stacked on
`fix/audit-phase-6-terminal-atomicity`

### What changed
- **`observability/alertmanager.yml` (new)** — routing for the nine SLO rules that had been
  firing into nothing. `severity: critical` pages (10s group wait, hourly repeat); the rest is
  ticketed. Inhibition so a DOWN tier pages once about the cause instead of three times about
  its latency and error-rate symptoms.
- **`observability/prometheus.yml`** — added the `alerting:` block. `rule_files` was set;
  there was no `alerting:` block and no Alertmanager, so every rule evaluated and went nowhere
  but the Prometheus UI.
- **`docker-compose.observability.yml`** — Alertmanager service in the same profile.
- **`scripts/backup.sh` (new)** — compressed custom-format dump, **verified** with
  `pg_restore --list`, fails if the archive is unreadable or has no table data; retention runs
  last and only after a verified success, so a run of failures cannot age out the last good
  backup; non-zero exit so a timer surfaces it.
- **`scripts/restore.sh` (new)** — the half that did not exist. Default mode restores into a
  scratch database and asserts the result is *usable* (table count, `users`/`deliveries`
  queryable, and **`deliveries` still has partition children**), prints elapsed time — the real
  RTO — then drops the scratch DB. A real restore needs an explicit `CONFIRM`.
- **`DEPLOY.md`** — backup/restore and alerting runbooks, plus removal of a **duplicated Notes
  block** (secrets/backups/scaling/observability appeared twice, verbatim).

### Verification
- backend: tsc ✔ / lint ✔ (98 warnings, unchanged) / 80 suites, **758 tests** — unchanged by
  this phase, which touches ops config and scripts only.
- All four YAML files parse (`yaml.safe_load`), and every receiver referenced by a route in
  `alertmanager.yml` is defined (checked programmatically, not by eye).
- `bash -n` on both scripts; guard behaviour exercised by hand: missing `DATABASE_URL` → 2,
  no args → 2, bad path → 2, unconfirmed overwrite → 3.
- **Not verified:** the stack was not actually brought up. Docker was unavailable here, so
  `docker compose config` could not run and no alert was fired end to end. The next person with
  a Docker host should do exactly that — see *Left undone*.

### Decisions made
- **Empty receivers, not placeholder URLs.** My first draft used `${ALERTMANAGER_CRITICAL_WEBHOOK}`
  in the config. **Alertmanager does not expand environment variables in its YAML** — that would
  have been taken as a literal URL and stopped it from starting. Caught before committing.
  Empty receivers are valid and give working grouping/inhibition/silences; enabling delivery is
  a few uncommented lines, with Slack/PagerDuty/webhook blocks written out ready to fill in.
- **The destructive guard is checked before the archive is read.** First version verified the
  archive first, so an unconfirmed overwrite exited 1 (bad archive) instead of 3 (refused) —
  the refusal should be immediate and not depend on anything else succeeding.
- **Verify inside `backup.sh`, not as a separate step.** An unverified backup and no backup are
  the same thing on the day you need it, and the check is one `pg_restore --list`.
- **The rehearsal asserts partition children survive.** `deliveries` is RANGE-partitioned with
  child DDL owned by the `partition_*` routines rather than Prisma, so "the restore exited 0"
  is not evidence the schema came back intact.
- **Health-readiness item SKIPPED, confirmed unreachable.** Plan Phase 8 item 3 said to confirm
  first. All Redis roles fall back to the shared `REDIS_HOST` and no shipped config
  (`.env.example`, compose, k8s) overrides them, so the cache ping does cover them. It only
  becomes real if someone uses the per-role split `configuration.ts` supports — documented as a
  caveat in DEPLOY.md rather than building client plumbing for a case nobody is in.

### Deviations from the plan
- Nothing beyond the two items above (empty receivers; readiness skipped as confirmed
  unreachable). No adversarial review workflow — this phase adds ops config and shell scripts
  with no application code path, and the checks that matter (YAML validity, receiver
  resolution, guard exit codes) were run directly.

### Left undone / follow-ups
- **Nobody has fired a real alert.** Bring the profile up on a Docker host, stop the API
  container, and confirm `DroveryTargetDown` reaches Alertmanager at :9093. Until that is done,
  the alerting path is *configured*, not *proven*.
- **Nobody has run a real restore.** `restore.sh` has never been executed against a real
  archive. The rehearsal exists precisely so this is a scheduled, boring exercise — run it once
  by hand first.
- **No PITR.** Nightly snapshots only; worst case is losing a day. Needs WAL archiving.
- **Backups are local by default.** `BACKUP_DIR` should point at off-host storage — a backup on
  the same disk as the database does not survive the failure it exists for.
- **No alert on a stale backup.** A silent backup failure is the same as no backup; the cron log
  is the only signal. A `DroveryBackupStale` rule needs a freshness metric to alert on.

### Next
- **Phase 7 — Admin console unblock** (S, admin + backend) is the only remaining S-sized phase.
- Then 9 (realtime durability), 10 (charge money — also picks up Phase 6's deferred partial-refund
  accounting), 11–12 (Drone entity and flight ops).

---

## Phase 7 — Admin console unblock — DONE (two items deferred)
**Date:** 2026-07-26
**Session:** same session; user away, decisions autonomous
**Branches (both pushed, neither merged):**
- backend `fix/audit-phase-7-admin-unblock` — 6 commits, stacked on `fix/audit-phase-8-alerting-backups`
- admin `fix/audit-phase-7-admin-unblock` — 13 commits, branched off `main` (the admin repo was
  untouched by phases 1–6, so no stacking needed)

### What changed

**The three things that made the console unusable**
- **Role-aware routing.** `/` rendered the ADMIN-only Dashboard for every authenticated user, so
  an AGENT signing in hit a permanent 403 with no Dashboard entry in their sidebar to explain
  it. New `navItems.tsx` is now the single source of the nav AND the guards (`rolesForPath`,
  `homePathForRole`); `RequireRole` redirects a role to the first page it can actually open
  instead of showing an error. `AppLayout` consumes the same list, so nav and guards cannot drift.
- **Staff can subscribe to a ticket socket.** `assertOwnedTicket` is ownership-only and an agent
  is never the owner, so live chat read "Offline" on every ticket, permanently. New
  `assertTicketAccess(userId, role, ticketId)` gives AGENT/ADMIN an existence check; the role is
  resolved once at `handleConnection` because the JWT carries only `{sub, email, jti}`.
- **The admin client now handles `message:new`.** Every frame from this gateway is enveloped as
  `{event, data}`; the client handled only `subscribed | error | message:sent`, so the broadcast
  matched `'event' in obj`, fell through and returned — every inbound customer message was
  dropped while the chip read "Live".

**Search and URL state**
- `q` on all three admin list DTOs + server-side filters. Deliveries match `trackingId` first —
  it is what a customer reads out over the phone — then addresses, receiver, customer email;
  tickets match the opening message and the customer; users match name and email.
- `useListParams` holds page/filter/search in the URL (`useSearchParams` appeared nowhere in the
  console before), plus a debounced `SearchField`. Wired into all three list pages.

**Smaller fixes**
- `DeliveryDetailPage` header Refresh now reloads the drone command history too — it reloaded
  the delivery only, so a dispatcher watching for an ABORT ack saw PENDING forever and issued a
  second command to an aircraft that had already obeyed the first.
- Delivery rows are keyboard-reachable: the id cell is a real `<Link>`, so a keyboard or
  screen-reader operator can open a record and middle-click opens a new tab.

### Verification
- backend: tsc ✔ / lint ✔ (98 warnings, unchanged) / **80 suites, 762 tests** (phase 8 left 758)
- admin:   tsc ✔ / lint ✔ **clean** / **17 files, 74 tests** (baseline 65)
- mobile:  untouched.

**One real lint error caught and fixed before commit:** `SearchField` resynced its draft with
`useEffect(() => setDraft(value), [value])`, which trips `react-hooks/set-state-in-effect` —
setState in an effect forces a second render pass. Replaced with the render-time adjustment
pattern (compare against a `lastValue` state and adjust during render). The admin lint baseline
was clean, so this would have been a regression.

### Decisions made
- **Guards derived from the nav list, not written twice.** The sidebar already had the correct
  role map; the routes had none. One list means a page cannot be advertised under one rule and
  guarded under another.
- **Redirect, don't 403.** An AGENT sent to a page they cannot open should land somewhere they
  can work, not read an error. `homePathForRole` returns the first nav entry the role can see.
- **Staff bypass is READ-only.** `assertTicketAccess` is used by `subscribe`, not by `send`.
  `createUserMessage` hardcodes `senderRole: 'USER'`, and an agent's reply goes through the admin
  REST endpoint which writes `senderRole: 'AGENT'`. Letting staff write through the socket path
  would have recorded their replies as customer messages.
- **Longest-prefix matching in `rolesForPath`.** `/` is itself a nav path, so a naive
  `startsWith` would give `/support/t-1` the Dashboard's ADMIN-only rule and lock agents out of
  ticket detail. There is a test for exactly this.
- **Search on all three lists, not just deliveries.** Structurally identical and cheap; doing one
  and leaving two would be worse than doing none.

### Deviations from the plan
- **Toasts / success feedback NOT done.** `Snackbar` still appears nowhere, so a refund still
  gives no confirmation of the amount (`adminApi.refund` returns it and `onRefund` discards it).
  It needs a provider plus a call site in every mutation across four pages — a coherent piece of
  work in its own right, and the phase was already spanning two repos and seven items. This is
  the single most user-visible thing still missing from the console.
- **The customer-side ticket entry point NOT done.** `supportApi.createTicket` in the mobile app
  still has zero call sites and `HelpSupportScreen`'s "Live Chat" row is still `() => {}`, so
  customers cannot open a ticket and the admin inbox has no source. The plan explicitly allowed
  deferring this; it belongs with the mobile work, not here. **Note the consequence: the agent
  side of support is now fully working against an inbox nothing can fill.**
- **No adversarial review workflow.** Consistent with phases 6 and 8: the changes are guards,
  a frame-name fix, and query params, each covered by a test, and the highest-risk one (the lint
  regression) was caught by tooling.

### Left undone / follow-ups
- **Toasts** — see above. Highest-value remaining console item.
- **Customer ticket entry point** — mobile; the inbox has no source without it.
- **Sticky headers and server-side column sort** were in the plan's item 4 and are not done;
  search + URL state were the parts that blocked phone support.
- **Support and Users rows are still not keyboard-reachable** — only the deliveries list was
  converted. Same one-line `<Link>` change.
- **No test covers `RequireRole` rendering** — the guard logic is tested through `navItems`
  (`rolesForPath`/`homePathForRole`), but the component itself would need a router harness.

### Next
- **Phase 9 — Realtime durability** (M, backend + admin), or **Phase 10 — Charge money** (M,
  needs Stripe keys and also picks up Phase 6's deferred partial-refund accounting).
- Phases 11–12 (Drone entity, flight ops) are the structural work and want deliberate planning.
- **Seven of thirteen phases are now done.** Five branches are stacked and unmerged; merging is
  becoming the bottleneck.

---

## Phase 9 — Realtime durability — PARTIAL (backend done; two items deferred)
**Date:** 2026-07-26
**Session:** same session; user away, decisions autonomous
**Branch:** `fix/audit-phase-9-realtime-durability` — 5 commits, pushed, stacked on
`fix/audit-phase-7-admin-unblock`

### What changed
- **`tracking.subscriber.ts` + `support-chat.subscriber.ts` — subscriptions survive a Redis
  blip.** With `enableOfflineQueue:false` a SUBSCRIBE issued while Redis is unreachable rejects
  immediately, and that was logged and dropped. The gateway had already added the socket to its
  local map and answered `subscribed`, so the client was told it was live while no channel had
  been registered — and nothing ever retried, because the non-empty map entry made a later
  subscriber reuse it instead of re-subscribing. One blink deafened those clients for the life
  of their socket. Both now record the desired channel *before* the SUBSCRIBE and re-arm on
  ioredis `'ready'`, which is what `MqttService` already did on `'connect'`.
- **`prisma.service.ts` — disconnect moved from `onModuleDestroy` to `onApplicationShutdown`.**
  Verified against `node_modules/@nestjs/bullmq/dist/bull.explorer.js:32`, which closes workers
  in `onApplicationShutdown`. Nest runs `onModuleDestroy` a full phase earlier, so every deploy
  pulled the database out from under jobs that were still draining — killing exactly the
  in-flight work `enableShutdownHooks` exists to protect.

### Verification
- backend: tsc ✔ / lint ✔ (98 warnings, unchanged) / **80 suites, 765 tests** (phase 7 left 762)
- admin / mobile: untouched by this phase.

**Mutation tests** — applied, targeted spec run, file restored:

| Mutation | Intended test | Result |
|---|---|---|
| subscribe stops recording intent | "keeps the channel in the desired set" | ✔ failed |
| subscribe stops recording intent | "re-subscribes every desired channel" | ✔ failed |
| prisma back to `onModuleDestroy` | "onApplicationShutdown disconnects" | ✔ failed |

**A test I wrote was initially worthless and I rewrote it.** The first version of
"re-subscribes every desired channel" re-implemented the re-arm loop inline in the spec, so it
asserted its own copy of the logic rather than the code. Fixed by extracting `rearmAll()` from
the `'ready'` handler and having the spec call the real method — which is also why the mutation
above can fail it.

### Decisions made
- **Record intent before subscribing, not after.** The ordering is the fix: a subscribe that
  fails must still leave behind the fact that we wanted it, or there is nothing to re-arm.
- **Re-arm on `'ready'` rather than awaiting the subscribe and rolling back the gateway's map**
  (the plan's suggested alternative). Rolling back turns a transient outage into a hard client
  error; re-arming turns it into a delay. The client is told `subscribed` and — once Redis is
  back — that becomes true, which is the honest behaviour for a reconnecting transport.
- **Prisma moved to the same phase as the worker close, not ordered before it.** Within a phase
  Nest tears down in reverse initialisation order and PrismaModule is global and early, so it
  goes last in practice. A guaranteed ordering would need the workers closed explicitly in
  `beforeApplicationShutdown`; noted in the code comment rather than done, because it means
  taking over lifecycle management from `@nestjs/bullmq`.

### Deviations from the plan
- **Item 2 (recoverable admin socket) NOT done.** `Drovery_Admin/src/api/supportSocket.ts` still
  treats close 1008 as permanently fatal and still opens with whatever 15-minute access token is
  in localStorage, so live chat dies for good once that token expires. It needs a token-refresh-
  then-retry path plus surfacing the six distinct `UnavailableReason` values instead of
  collapsing them into "Offline" — that is admin-side work of similar size to the backend half,
  and Phase 7 already reworked this file.
- **Item 3 (fair hot-store checkpoint drain) NOT done.** `tracking-hot-store.ts:158` still claims
  a random `SPOP` batch with no aging, so above roughly 5k live deliveries an individual delivery
  can starve past `WATCHDOG_SILENCE_MS` and be false-reaped. Replacing it with an aging ZSET plus
  a backlog gauge is a self-contained change but a real data-structure swap on a hot path, and it
  wants a load test to prove rather than a unit test — which is not available here.
- **Item 5 (WS session revalidation) NOT done.** `tracking.gateway.ts:81` still authenticates
  once at connect, so logout and token expiry never terminate a live stream. Same shape as the
  `passwordChangedAt` decision in Phase 2: any revalidation adds per-frame or periodic I/O to a
  hot path, and it should be designed alongside that one rather than twice.
- No adversarial review workflow, consistent with phases 6–8: two focused changes, both
  mutation-tested.

### Left undone / follow-ups
- The three items above. **Item 2 is the most user-visible** — an agent's chat still dies
  permanently 15 minutes into a shift.
- The re-arm is unit-tested but has never been exercised against a real Redis restart. Worth
  doing once by hand: bounce Redis with a client subscribed and confirm frames resume.

### Next
- **Phase 10 — Charge money for real** (M, backend + mobile) — needs Stripe test keys from the
  user, and also picks up Phase 6's deferred partial-refund accounting.
- **Phases 11–12** — the Drone entity and flight ops. L-sized and structural.
- **Eight of thirteen phases now touched.** Six branches stacked and unmerged; merging is well
  past the point of being the bottleneck.

---

## Phase 11 — Drone entity — INCREMENT 1 DONE (dispatch engine + admin surface remain)
**Date:** 2026-08-01
**Session:** same session; user away, decisions autonomous
**Branch:** `fix/audit-phase-11-drone-entity` — 8 commits, pushed, stacked on
`fix/audit-phase-9-realtime-durability`

**Phase 10 was skipped, not forgotten:** it needs real Stripe test keys, and mock mode is
precisely what hides the bug (`stripe.service.ts` returns a fake `succeeded` when
`STRIPE_SECRET_KEY` is unset). Writing the confirm/SCA/refund path against mock mode would be
writing it blind. Blocked on the user.

### What changed
- **`Drone` model (new).** Serial, model, firmware, `DroneStatus`, `airworthy`, `maxPayloadKg`,
  `batteryPercent`, home base + current position, flight hours/cycles, `maintenanceDueAt`, a
  per-aircraft `ingestKeyHash`, `lastSeenAt`.
- **`Delivery.assignedDroneId` is now a real foreign key.** It was a bare nullable String
  holding `drone-${uuidv4()}` and referencing nothing.
- **`Drone.activeDeliveryId` is UNIQUE — the claim AND the lock.** The database now refuses to
  let one aircraft hold two deliveries. It lives on `drones` rather than `deliveries` because
  `deliveries` is RANGE-partitioned and **cannot carry a unique index that omits its partition
  key** — the plan's suggested "partial unique index on deliveries" is not achievable.
- **`claimDrone()`** — a LIVE delivery now requires a registered airframe. The claim is a
  conditional update carrying every precondition (airworthy, AVAILABLE, unclaimed,
  payload-capable), so two creates racing for the last aircraft cannot both win.
- **`releaseDrone()`** in `cleanupAfterTermination`, scoped to the delivery's own claim so a
  late release cannot free a drone another delivery has since taken.

### Verification
- backend: tsc ✔ / lint ✔ (98 warnings, unchanged) / **80 suites, 770 tests** (phase 9 left 765)
- `prisma migrate status`: 33 migrations, **database schema up to date** — no drift.

**The migration was verified against real data, not just generated.** A live Postgres turned out
to be reachable at `localhost:5432`, so rather than hand-writing SQL blind:
1. Seeded three legacy-shaped deliveries (two live, one delivered) with `drone-aaa/bbb/ccc`.
2. Applied the migration.
3. Confirmed: three aircraft materialised; the two live ones `IN_FLIGHT` with their
   `activeDeliveryId` set; the delivered one `GROUNDED` and unclaimed; all `airworthy=false`.
4. Confirmed the constraints actually bite — a dangling `assignedDroneId` is rejected by the FK,
   and a second delivery on one drone is rejected by the unique index. **That is the audit's
   "two deliveries, one aircraft" bug, now structurally impossible.**
5. Cleaned the seed data; database back to empty.

**Mutation tests** — applied, targeted spec run, restored:

| Mutation | Intended test | Result |
|---|---|---|
| claim drops its preconditions | "claims a real aircraft atomically" | ✔ failed |
| LIVE falls back to a phantom id | "rejects a LIVE delivery that names no aircraft" | ✔ failed |
| release removed from cleanup | "releases the aircraft when the delivery terminates" | ✔ failed |

### Decisions made
- **Prisma's generated migration would have broken any populated database.** It adds the FK
  directly, and every pre-existing `assignedDroneId` references nothing. I inserted a backfill
  that materialises an aircraft per distinct legacy id *before* the constraint. The dev database
  was empty, so I seeded rows specifically to make that path execute rather than shipping an
  untested branch.
- **Backfilled airframes are GROUNDED and not airworthy.** We know their id and nothing else —
  no payload class, battery or home base. `maxPayloadKg = 0` is chosen to be obviously unusable
  (it matches no package) rather than plausibly wrong.
- **The claim lives on `drones`, not `deliveries`.** Forced by the partitioning, and it turns out
  to be the better design anyway: the drone row is the natural lock for "is this aircraft free".
- **A LIVE delivery without a registered drone is now a 400.** The alternative — auto-creating a
  drone row — would reintroduce exactly the phantom aircraft this phase deletes.
- **One error message for every claim failure.** Which aircraft is airworthy, charged or already
  flying is fleet information, and `POST /deliveries` is reachable by any authenticated customer.

### Deviations from the plan
- **Scoped to increment 1.** The plan's Phase 11 is L-sized: entity, per-aircraft credentials,
  DTO hardening, dispatch engine, haversine bound, admin fleet surface. The entity plus a real
  atomic claim is the part everything else depends on, and it is coherent on its own.
- **The `ingestKeyHash` column exists but nothing uses it yet.** `DroneAuthGuard` still checks the
  single shared `INGEST_API_KEY`. The column is there so the credential migration is a code
  change rather than another schema change.

### Left undone / follow-ups
- **Dispatch engine** — nothing *selects* an aircraft yet; the caller still names one. Nearest
  available, out-and-back energy feasibility, saturation queue and reassignment on unresponsive
  are all still absent.
- **`droneId` / `trackingSource` are still on the customer-facing DTO.** Any authenticated user
  can still ask for a LIVE delivery on a specific aircraft — though it now must be a real,
  free, payload-capable one, and the claim is atomic, so the blast radius is much smaller than
  the audit found. Proper fix is an operator-only create path.
- **Per-aircraft ingest credentials** — column added, guard unchanged.
- **Admin fleet surface** — no registry list, no ground/unground, no way to create a Drone. **In
  practice this means LIVE deliveries cannot be created at all until someone inserts a drone
  row**, since there is no UI or endpoint to register one. SIMULATED (the default) is unaffected.
- **Haversine still unbounded** with `SERVICE_AREA_GLOBAL=true`.

### Next
- **Finish Phase 11**: the admin fleet surface is the most urgent gap (LIVE is unusable without
  it), then the dispatch engine.
- **Phase 12** (flight ops) depends on all of the above.
- **Phase 10** remains blocked on Stripe test keys.
- **Seven branches stacked and unmerged.** This is now a real risk, not a nag.

---

## Phase 11 — INCREMENT 2: admin fleet surface — DONE
**Date:** 2026-08-01
**Session:** same session, at the user's request ("add the admin fleet surface so LIVE
deliveries work")
**Branches (both pushed, neither merged):**
- backend `fix/audit-phase-11-admin-fleet` — 7 commits, stacked on `fix/audit-phase-11-drone-entity`
- admin `fix/audit-phase-11-admin-fleet` — 7 commits, stacked on the admin `fix/audit-phase-7-admin-unblock`

### Why this was urgent
Increment 1 made `assignedDroneId` a foreign key and required a real, claimable aircraft for a
LIVE delivery — but there was no endpoint or UI to register one. The registry was empty and
unfillable, so **LIVE deliveries could not be created by anyone**. SIMULATED (the default, and
what everything actually uses) was unaffected, but that was a sharp edge I left behind and it is
now closed.

### What changed
**Backend**
- `AdminDroneQueryDto` / `CreateDroneDto` / `UpdateDroneDto`. Payload class and home base are
  REQUIRED at registration, because dispatch reasons about both — an aircraft with unknown
  capability can never be safely claimed, which is exactly the state the backfilled legacy rows
  are parked in.
- `AdminService.listDrones` (paginated, status filter, search over serial/model),
  `getDrone` (404s rather than returning null), `createDrone` (P2002 → a 409 naming the serial,
  not a raw Prisma error), `updateDrone`.
- Routes under the existing `@Roles(Role.ADMIN)` controller.

**Admin console**
- `FleetListPage` — registry table (serial, model, status, airworthy, payload, battery, active
  delivery), a register dialog, search + status filter in the URL, and a ground / return-to-
  service action.
- Nav entry in `navItems.tsx`, which — because Phase 7 made the nav and the route guards derive
  from one list — created the ADMIN route guard at the same time.

### Verification
- backend: tsc ✔ / lint ✔ (98 warnings, unchanged) / **80 suites, 775 tests** (increment 1 left 770)
- admin:   tsc ✔ / lint ✔ clean / **17 files, 75 tests** (phase 7 left 74)

**Proved end to end against the real database**, not just unit-tested. A throwaway script using
the real `PrismaService`:
1. registered an aircraft → `AVAILABLE`, `airworthy=true`
2. claimed it with the exact `claimDrone` predicate (1.5 kg) → **CLAIMED**
3. attempted a second claim → **REFUSED** (already flying)
4. attempted a 5 kg payload against a 2 kg airframe → **REFUSED** (over capacity)
5. released, grounded it, attempted another claim → **REFUSED**
6. cleaned up.

That is the whole point of the phase: an aircraft can be registered, claimed exactly once, and
every safety precondition actually bites.

### Decisions made
- **Grounding stops the NEXT claim; it does not recall an aircraft already in the air.**
  `airworthy` and `status` are dispatch preconditions. Recalling a flying drone is a
  RETURN_TO_BASE command with different safety semantics, and conflating the two in one button
  would be dangerous. The button label and the service docblock both say so.
- **Payload and home base required, not optional-with-defaults.** A default would produce
  plausible-looking aircraft that dispatch would happily claim. The legacy backfill deliberately
  uses `maxPayloadKg = 0` for the opposite reason — obviously unusable rather than plausibly wrong.
- **The empty state explains the consequence.** "No aircraft registered" alone would leave an
  operator guessing why LIVE creates fail; it now says so and notes simulated deliveries are
  unaffected.
- **No `serial` edit.** It is the physical marking on the airframe; changing it in software would
  desynchronise the registry from reality.

### Left undone / follow-ups
- **Dispatch engine** — nothing SELECTS an aircraft. The caller still names one, so a customer
  must know a drone id. Nearest-available, out-and-back energy feasibility, saturation queue and
  reassignment-on-unresponsive all remain.
- **No fleet detail page** — the list has no drill-down to flight history, command log or
  position. Phase 12 territory.
- **Per-aircraft ingest credentials** — `ingestKeyHash` exists and is unique, but `DroneAuthGuard`
  still checks the single shared `INGEST_API_KEY`, and nothing issues a per-aircraft key yet.
- **`droneId`/`trackingSource` still on the customer DTO.** Blast radius is now small (it must be
  a real, free, payload-capable aircraft, claimed atomically), but the proper fix is an
  operator-only create path.
- **The console page has never been opened in a browser.** It typechecks, lints and its guard is
  tested, but no one has clicked Register.

### Next
- **Phase 12** (flight ops) now has a real fleet to build on.
- **Phase 10** still blocked on Stripe test keys.
- **Nine branches stacked and unmerged across two repos.**

---

## Phase 11 (increment 3) — Dispatch engine — DONE

**Date:** 2026-08-01
**Branches:** `fix/audit-phase-11-dispatch-engine` (backend),
`fix/audit-phase-11-dispatch-fleet-range` (admin)
**Covers plan items:** 11.3 (drop the operator fields from the customer DTO), 11.4 (dispatch
engine), 11.5 (bound the haversine)

### What changed

**The engine — `src/dispatch/` (new).**
- `flight-feasibility.ts` — pure arithmetic, no I/O. A mission is THREE legs: position to the
  pickup, fly the delivery, get home. The range budget is `rangeKm × charge × payload-derate ×
  (1 − reserve)`, so a bench figure is never spent in full. Ranking is by **smallest sufficient
  capacity**, distance as tie-break, id as final tie-break for determinism.
- `dispatch.service.ts` — candidate query (airworthy, available, unclaimed, big enough, charged,
  inspection not lapsed), in-process feasibility ranking, then a conditional `updateMany` per
  candidate until one sticks. A lost race walks to the next candidate rather than retrying from
  the top; that is the normal outcome of two customers booking at once, not an error.
- Refusal is split in two: `no_capacity` (no airframe in the fleet could EVER lift this) vs
  `unavailable` (everything else). The first is the only fleet fact worth telling a customer,
  because "try again later" is a lie when the answer will never change.
  > **Correction (increment 3):** the count behind `no_capacity` is
  > `{ airworthy: true, maxPayloadKg: { gte: payloadKg } }`, so a temporarily **grounded**
  > capable airframe reads as absent and the customer is told to split a package the fleet
  > can in fact carry. "could EVER lift this" overstates it; the in-code log line is accurate.
  > Left as-is deliberately — dropping `airworthy` from the count would give a written-off
  > fleet a permanent "try again shortly", and the `Drone` model has no retired/decommissioned
  > concept to distinguish them. Logged in the backlog rather than fixed blind.

**`Drone.rangeKm`** (new column, migration `20260801042637_add_drone_range_km`). Without it
selection degrades to a payload comparison and "can it get home" is unanswerable.

**`trackingSource` + `droneId` removed from `CreateDeliveryDto`.** Both were operator concerns in
a public request body. The server decides via `LIVE_DISPATCH` (default OFF → everything is
SIMULATED, byte-identical to before).

**Route length bound** — `MAX_ROUTE_KM`, default 50, new `ROUTE_TOO_LONG` code.

**Three claim-lifecycle defects fixed** (found while building on the merged Phase 11 work):
| Defect | Consequence |
|---|---|
| A **successful** delivery never released | The fleet leaked one airframe per completed delivery until dispatch had nothing to assign |
| `RETURNING` released while still airborne | The engine could hand a flying drone to the next booking |
| A failed `create()` never released its claim | The claim commits on a separate non-partitioned row, so the delivery rollback did not undo it and every later release keyed on a delivery that would never exist |

> **Correction (Phase 12 increment 3, 2026-08-01).** Rows 2 and 3 of that table claim more than
> was delivered, and the overstatement is the reason both survived another two increments:
> - *"`RETURNING` released while still airborne"* was fixed **at one call site**, not as a class.
>   `beginReturnToBase` got `STILL_AIRBORNE`; `adminForceCancel` walked straight past it into the
>   `RETURN_TO_FLEET` default while its own CAS deliberately permits force-cancelling an in-flight
>   delivery, and `failExceptional`'s `RECIPIENT_UNAVAILABLE` branch re-pooled an airborne aircraft
>   by design. Both fixed in increment 3.
> - *"A failed `create()` never released its claim"* was fixed for the tracking-id collision and
>   exhaustion paths only. The debit-first reservation catch — the one remaining post-claim throw —
>   still returned without handing the airframe back. Fixed in increment 3.

A drone implicated in a failure (lost comms, mechanical, any return-to-base) is now **grounded**
rather than returned to the pool, `airworthy` cleared — not just the status, or an operator
flipping it back to AVAILABLE would make it dispatchable with nobody having looked at it.

**Admin fleet surface** — `rangeKm` is REQUIRED on registration and shown in the list.

### Verification
```
prisma generate: ok
tsc (tsconfig.build.json): clean
lint: 98 problems (0 errors, 98 warnings)   ← baseline unchanged
Test Suites: 82 passed, 82 total
Tests:       822 passed, 822 total          (+47)
prisma:drift-check: No difference detected
admin: tsc clean · lint 0 problems · 78 tests passed (+3)
```

**Mutation testing — 12 mutations, 12 caught.** Backend: removing the success release; releasing
at RETURNING; dropping `airworthy: false` from grounding; dropping the recovery leg from the
mission; removing the route bound; collapsing `no_capacity`; weakening the claim CAS; dropping
the failed-create rollback; returning a candidate instead of throwing on saturation; claiming for
a scheduled pickup. Admin: not sending `rangeKm`; dropping it from the submit gate.

**One mutation initially survived** — dropping the recovery leg. The `-t` filter had matched a
test that did not depend on it, and the RANGE test's numbers were too small to discriminate (both
one-way and round-trip exceeded the budget). The test now asserts the one-way trip FITS and the
round trip does not, and it fails under that mutation.

### Decisions made
- **`LIVE_DISPATCH` defaults OFF.** Every existing deployment, CI run and demo keeps working with
  no fleet registered. Turning it on is an operational decision.
- **Refuse rather than downgrade.** With live dispatch on and no aircraft available, the booking
  is REJECTED. Falling back to SIMULATED would be a worse version of the bug being fixed — a
  customer told a real drone is coming, watching an animation.
- **Scheduled pickups stay SIMULATED under `LIVE_DISPATCH`.** You do not hold an airframe out of
  service for three weeks. Kickoff-time dispatch is Phase 12.
- **Smallest sufficient capacity beats nearest.** Sending the heavy-lift airframe on a 200 g job
  is locally optimal and globally wrong: it is the only aircraft that can take the next heavy
  booking, and while it is out that booking gets rejected.
- **Two refusal messages, not five.** Which airframes are airworthy, charged or flying is fleet
  information and this path is reachable by any authenticated customer.
- **A returned-to-base aircraft is grounded, not pooled.** A return-to-base is an aborted mission
  and the thing that aborted it has not been diagnosed.

### Deviations from the plan
- **11.2 (per-aircraft credentials) not done.** `ingestKeyHash` exists and is unique, but
  `DroneAuthGuard` still checks the shared `INGEST_API_KEY`. It is a self-contained auth change,
  independent of the engine, and was left out to keep this increment reviewable.
- **No saturation QUEUE.** The plan allows "queued or rejected"; this rejects. A queue needs a
  retry loop and a customer-visible pending state — its own increment.
  > **Correction (increment 3):** accurate for `create()`, where the rejection is a 409 the
  > customer sees and can act on. Increment 2 then moved the same refusal to a call site with
  > no caller — the kickoff job — where "rejects" meant the job died and an already-charged
  > delivery sat in SCHEDULED indefinitely. That change in consequence was not recorded at the
  > time. Increment 3 routes it into the pre-flight's HOLD/ABORT machinery; a genuine
  > saturation queue is still outstanding.
- **No reassignment-on-unresponsive.** A drone that goes silent mid-flight physically still has
  the parcel, so the mission cannot simply be handed to another airframe. What IS handled: the
  watchdog reaps the delivery, the claim is released so the fleet is not blocked, and the
  aircraft is grounded.

### Left undone / follow-ups
- Per-aircraft ingest credentials (11.2).
- Saturation queue; reassignment semantics for a lost airframe.
- Kickoff-time dispatch for scheduled LIVE deliveries.
- `rangeKm` has a schema default of 12 — legacy rows registered before this change carry it. The
  admin form now requires a real value, but existing rows should be audited.
- The fleet console still has never been opened in a browser.
- Pre-existing, not introduced here: `deliveries.controller.spec.ts:120` fails a full-project
  `tsc -p tsconfig.json` (`'result' is possibly 'null'`). `tsconfig.build.json`, which is what
  builds and CI use, excludes specs and is clean.

### Next
- **Phase 12** (flight ops) — append-only flight log, energy management, re-gating weather and
  airspace at dispatch, the flight-ops console, incident management, operator audit log.
- **Phase 10** still blocked on Stripe test keys.

---

## Phase 12 (increment 1) — Flight log + energy management — DONE

**Date:** 2026-08-01
**Branch:** `fix/audit-phase-12-flight-log` (backend)
**Covers plan items:** 12.1 (append-only flight log), 12.2 (energy management)

### What changed

**`FlightFrame` — the flight recorder (new, partitioned from birth).**
`DeliveryTracking` is ONE row that every frame overwrites, so the last transmission before a
loss of comms had already been destroyed by the frame after it — after a crash or a watchdog
reap there was nothing to reconstruct from. `routeJson` was declared and never written.

It records **what was RECEIVED, not what was accepted**. A stale, out-of-order or
out-of-bounds frame is still evidence of what the aircraft transmitted and when, and those are
exactly what a failing GPS or a wedged flight controller looks like from the ground.

Co-partitioned by `RANGE("deliveryCreatedAt")` following `drone_commands`. This is the
highest-volume table in the system — one row per telemetry tick, where every other delivery
child is one row per delivery or per operator action — so retention must be able to bare-DROP
an aged month in O(1). Prisma cannot express `PARTITION BY`, so the generated migration was
replaced with a hand-written one; verified against the live catalog:
```
partition key: deliveryCreatedAt
partitions:    flight_frames_default, _y2026m08, _y2026m09, _y2026m10, _y2026m11
```

**Telemetry now carries altitude, battery and airspeed.** Bounds-checked as SANITY limits, not
airspace rules — the job is to reject a sign-flipped or unit-confused reading before it lands
in a log an incident review will later trust.

**Energy management — the platform recalls its own aircraft.** Two triggers:

| Trigger | Fires when |
|---|---|
| `INSUFFICIENT_RANGE_HOME` | remaining usable range no longer covers the way back, × a margin |
| `CRITICAL_BATTERY` | state of charge alone, no geometry involved |

Charge is checked FIRST. The geometry answer is only as good as `rangeKm` and the reported
position; if either is wrong it will happily conclude a nearly flat aircraft is within budget.
Charge is the one input that cannot be wrong about itself.

`assessRecall` reuses `usableRangeKm` from the dispatch engine, so the recall threshold and the
DISPATCH threshold cannot drift apart — an aircraft is sent out on a budget and recalled when
that same budget stops covering the return. Two energy models would eventually disagree, and
the disagreement would be discovered in the field.

The RETURN_TO_BASE mechanism was already built and fully tested (issue/poll/ack/CAS +
stranded-ack reconciler). **Nothing ever computed WHEN to fire it except a human clicking in
the console.** `DroneCommandService.issue` now takes a nullable `adminId` so the audit row says
the platform did it.

**Live aircraft state.** Every frame pushes position + charge + `lastSeenAt` onto the `drones`
row, so dispatch decides using where the aircraft actually is rather than what someone typed at
registration. Scoped to `activeDeliveryId`, so a late frame from a finished flight cannot
overwrite a drone another delivery has since claimed.

### Verification
```
prisma generate: ok
tsc (tsconfig.build.json): clean
lint: 98 problems (0 errors, 98 warnings)   ← baseline unchanged
Test Suites: 84 passed, 84 total
Tests:       856 passed, 856 total          (+34)
prisma:drift-check: No difference detected
partition key + 5 partitions confirmed against the live catalog
```

**Mutation testing — 12 mutations, 12 caught.** Dropping the range trigger; dropping the
trigger margin; swapping the check order; skipping terminal-delivery frames; dropping the
partition key from the insert; scoping the drone update by id instead of the active claim;
recalling without a battery reading; dropping the exception-phase guard; dropping the cooldown;
attributing the recall to a fake admin; unwiring the recorder from ingest; moving the record
call after the branch.

**Two mutations initially survived, both real gaps:**
- *Swapping the check order* — the ordering test used a case where only one trigger fired, so
  order could not matter. Rewritten to a case where BOTH fire and the reported reason is
  decided purely by order.
- *Unwiring the recorder from `ingest()` entirely* — every recorder unit test passed with the
  feature completely absent. Added integration tests through `TelemetryService.ingest` that
  assert a frame is recorded, exception frames are recorded, an ownership-guard failure records
  nothing, the aircraft row is freshened, and a flat aircraft is recalled through the real
  command path.

### Decisions made
- **Log what was received, not what was accepted.** A status-gated recorder would drop exactly
  the frames an incident review needs.
- **Record before the happy/exception branch**, after the auth and ownership guards. A stranger
  with a valid ingest key still cannot write into another delivery's log.
- **No auto-return without a real battery reading AND position.** A fleet whose gateway never
  sends `batteryPercent` gets no auto-return. The platform will not invent a state of charge —
  guessing wrong in the permissive direction is a drone that does not come back.
- **The cooldown is a write-rate damper, not the dedupe.** The authoritative dedupe is the
  existing one-open-command partial unique index; a second issue is a 409 and is swallowed. The
  in-memory map is per-replica on purpose — it is an optimisation and does not deserve a
  distributed failure mode.
- **The trigger margin inflates the DISTANCE, not the range.** Applying it to the range would
  make a low battery look better, which is the wrong direction for a safety margin.

### Deviations from the plan
- **12.3–12.7 not attempted** (re-gate weather/airspace at dispatch, airspace as data, the
  flight-ops console, incident management, operator audit log). This increment is the data and
  control layer the rest of them build on.
- `routeJson` is still declared and never written. The flight log supersedes it; the column
  should be dropped in a later increment rather than left as a decoy.

### Left undone / follow-ups
- **The recall costs one extra indexed read per frame** (battery + position + returnable status
  + cooldown elapsed). Fine at current scale; at high-frequency streaming across a large fleet
  it wants the drone row cached or folded into the state write.
- **No flight-log read surface.** The frames are written and nothing reads them yet — no replay
  endpoint, no admin timeline. That is the flight-ops console (12.5).
- **`forget()` is never called.** The cooldown map entry is dropped only on explicit call; wire
  it into terminal cleanup so a long-lived worker cannot accumulate entries.
- Position ordering is still last-write-wins with no sequence guard (pre-existing).
- Per-aircraft ingest credentials (11.2) and the saturation queue still outstanding.

### Next
- **Phase 12 increment 2** — re-gate weather and airspace at dispatch (12.3). Serviceability is
  evaluated at the quote and at `create()` and never again: a delivery booked 60 days out is
  weather-checked at booking and then launched by a kickoff job with zero re-check. The check
  that matters is the one immediately before rotor spin-up.
- **Phase 10** still blocked on Stripe test keys.

---

## Phase 12 (increment 2) — Pre-flight re-check + dispatch at launch — DONE

**Date:** 2026-08-01
**Branch:** `fix/audit-phase-12-preflight` (backend)
**Covers plan items:** 12.3 (re-gate weather and airspace at dispatch) + the Phase 11 deferral
(kickoff-time dispatch for scheduled deliveries)

### What changed

**Serviceability is now re-checked immediately before launch.** It was evaluated in the quote
and in `create()` and **never again** — a delivery booked 60 days out was weather-checked at
BOOKING and then launched by the kickoff job into whatever was actually happening two months
later. A forecast is not a safety control.

`handleKickoff` now runs a pre-flight check with three outcomes:

| Outcome | When | What happens |
|---|---|---|
| `LAUNCH` | serviceable | proceed |
| `HOLD` | `weatherHold` — the only transient blocker | defer 15 min, up to 4 attempts (~1 h) |
| `ABORT` | no-fly zone, out of area, route too long, or holds exhausted | fail + refund |

The HOLD/ABORT split is exactly the `weatherHold` flag serviceability already computed. Holding
on a permanent blocker would leave a delivery in SCHEDULED looking to its customer precisely
like one about to happen, until it silently expired.

The abort passes `[SCHEDULED]` as the CAS gate — `FAILABLE_STATUSES` is wider and covers the
in-flight states, so passing the default would let a pre-flight abort fail a delivery that had
already launched. Same extension point the watchdog uses.

**Dispatch now happens at launch** (the Phase 11 deferral). `create()` deliberately claims no
airframe for a scheduled delivery — you do not hold one out of service for weeks — so the claim
happens here, **co-committed with the `SCHEDULED → PENDING` transition** so the row is never
PENDING while still claiming SIMULATED with a live drone bound. When the CAS loses (canceled
during pre-flight, or another replica won) the aircraft is released explicitly: the claim
commits on a separate, non-partitioned row that nothing else rolls back.

**The retry budget rides in the job payload**, not worker memory — a redeploy would otherwise
reset it to zero and hold a weather-grounded delivery forever, which is the exact failure the
budget exists to prevent. Each defer uses a NEW jobId (`-kickoff-r2`, `-r3`, …); reusing the
original would be deduped against the job currently being processed and the hold would silently
become a drop.

### Verification
```
tsc (tsconfig.build.json): clean
lint: 98 problems (0 errors, 98 warnings)   ← baseline unchanged
Test Suites: 85 passed, 85 total
Tests:       886 passed, 886 total          (+30)
prisma:drift-check: No difference detected
```

**Mutation testing — 12 mutations, 12 caught.** Skipping the pre-flight entirely; holding a
hard block; aborting a weather hold; never exhausting the budget; widening the abort CAS to
`FAILABLE_STATUSES`; dropping the release when the CAS loses; dispatching as still-scheduled;
starting the sim for a LIVE launch; not binding the drone in the transition write; reusing the
original jobId on a defer; dropping the attempt counter from the payload; shortening the retry
delay to 30 s.

**Three mutations initially survived**, all against `deferKickoff`, which the processor spec
mocks and which had no test of its own. The jobId one is the serious one — reusing the original
id turns a hold into a *silent drop*, with every other test still passing while the delivery is
never re-checked again. Added `SimulationService.deferKickoff` tests for the jobId, the payload
and the delay.

### Decisions made
- **Weather holds, everything else aborts.** Reusing the existing `weatherHold` flag rather
  than inventing a second transient/permanent taxonomy that could disagree with it.
- **A held delivery is eventually failed, with a refund.** ~1 hour, then the honest answer is
  "we could not fly this" rather than another hour of a customer watching a delivery that is
  never going to happen.
- **`UNSAFE_DROP_ZONE` for a no-fly abort, `OTHER` for the rest.** Both are drone-fault under
  `isDroneFaultReason`, so the customer is refunded — correct, since nothing here is their doing.
- **Fail-open on an unresolved route.** No coordinates means nothing to check geometrically, and
  `DispatchService` rejects it independently, so failing at pre-flight would just be the second
  refusal for the same reason.
- **Claim before the CAS, release if the CAS loses** — the same ordering rule `create()` uses,
  for the same reason.
  > **Correction (increment 3):** true about the ORDERING, but the parity it asserts was not
  > there. `create()` covers the CAS loss *and* a throw; `handleKickoff` covered only the loss,
  > so a pool timeout on the transition write — exactly what `attempts: 5` exists for — leaked
  > the claim and then poisoned every retry with a P2002 on `drones_activeDeliveryId_key`. The
  > "12 mutations, 12 caught" set did not reach it either: the processor spec mocks `dispatch`
  > as resolving in every case, so no test exercised a throw from that call or from the write
  > after it. Fixed in increment 3.

### Deviations from the plan
- **12.4 (airspace as data) not attempted.** Restricted airspace is still two hardcoded circles
  with no altitude dimension. The re-check now runs at the right *time*; making the zones
  DB-backed with time windows and altitude ceilings is its own increment, and the flight log
  from increment 1 now records the altitude it would need.

### Left undone / follow-ups
- **No customer notification on a HOLD.** The delivery is silently held for up to an hour. The
  abort notifies via `failExceptional`'s existing comms, but a "your delivery is waiting for
  weather" message would be better than silence.
- **The hold is invisible in the API.** The delivery stays SCHEDULED with no indication it has
  been deferred; a `heldUntil` / attempt count on the row would surface it.
- Phase 12 items 12.4–12.7 remain (airspace as data, ops console, incident management, operator
  audit log).
- Per-aircraft ingest credentials (11.2) and the saturation queue still outstanding.

### Next
- **Phase 12 increment 3** — airspace as data (12.4) and/or the operator audit log (12.7).
  `forceCancel(deliveryId)` and `fail(deliveryId, reason)` still do not receive an admin id at
  all — the actor is dropped at the controller boundary.
- **Phase 10** still blocked on Stripe test keys.

---

## Phase 12 (increment 3) — Claim release + the refusal at launch — DONE

**Date:** 2026-08-01
**Branch:** `fix/audit-phase-12-claim-release` (backend)
**Covers:** no new plan item. This increment is a **re-check of the day's own work** — phases 11
(increments 1–3) and 12 (increments 1–2) were re-reviewed end to end, and this is what that found.

### Why this exists

The five increments above were each verified, mutation-tested and merged. Re-reviewing them as
one body of work — nine independent lenses over `b1ce5c8..HEAD`, every finding then handed to a
verifier told to refute it — turned up four defects that survived all five per-increment reviews.

They share a shape worth recording: **the day's work was reviewed on the paths where a delivery
STARTS, and the defects are all on the paths where one ENDS or FAILS.** Selection arithmetic, the
claim CAS, the partitioned recorder and the HOLD/ABORT taxonomy were checked hard and hold up. The
release half of the same lifecycle had one call site tested out of five, and the kickoff job's
error paths had none.

### What changed

**An airborne aircraft is no longer returned to the dispatchable pool.** Two call sites did it:

| Call site | What it did |
|---|---|
| `adminForceCancel` | Passed two arguments to `cleanupAfterTermination`, taking the `RETURN_TO_FLEET` default — while its own CAS deliberately fires from the in-flight statuses, `RETURNING` included |
| `failExceptional` (`RECIPIENT_UNAVAILABLE`) | Decided the disposition on "is the airframe implicated?" alone, and a no-show at the door is blameless |

With `LIVE_DISPATCH=on` the consequence is a drone flying with one customer's parcel being
claimed for another's booking. The unique index cannot help — the release nulls the column it
guards — and because the delivery goes terminal in the same breath,
`COMMAND_TYPE_TO_LEGAL_STATUSES` stops permitting `RETURN_TO_BASE`, so the operator loses the
recall channel at the instant the aircraft becomes re-dispatchable.

The disposition is now derived from the status the transition fired **from**, not from the
reason. `updateMany` cannot report the row it matched, so each of the two methods issues two
conditional CASes — the pre-launch set, then the in-flight set — whose union is exactly the
single predicate each replaced. What may be cancelled or failed is unchanged; only what happens
to the airframe is.

`GROUND_FOR_INSPECTION` and not `STILL_AIRBORNE`, deliberately: a CANCELED delivery never reaches
`completeReturnToBase`, so keeping the claim would hold the aircraft forever. Grounding frees the
claim while keeping it undispatchable, which is the honest state — a mission ended mid-air and a
human has to find out where the aircraft is.

**A dispatch refusal at launch holds or aborts; it never strands.** Kickoff is the first time the
fleet is consulted about a delivery the customer has already paid for — `create()` deliberately
claims nothing for a scheduled one. `dispatch()` was awaited with no `try`/`catch`, so a
saturated fleet threw, the job burned its five attempts in ~15 s against a condition that changes
on the timescale of a *flight*, and `onFailed` logged. The delivery then sat in `SCHEDULED`
indefinitely: reachable by neither `WATCHDOG_STUCK_STATUSES` nor `FAILABLE_STATUSES`, with no
`scheduledFor` sweeper — looking to its customer exactly like one about to happen, which is the
precise outcome the pre-flight ABORT was built to prevent.

The refusal now takes the same two outcomes as the weather check, **sharing its hold budget
rather than getting its own** — the budget bounds how long a customer waits on a delivery that
has not started, and that bound must not double because the reason for waiting changed.
`no_capacity` aborts immediately; holding an hour for an airframe that does not exist is a lie.

**A throw from the transition write no longer leaks the claim.** The release only ran inside
`if (count === 0)`, so the pool timeout that `attempts: 5` exists for skipped it — and the retry
then *poisoned itself*: the row was still SCHEDULED, the candidate query excluded the stuck drone,
a second was picked, and writing its claim raised an unhandled **P2002** on
`drones_activeDeliveryId_key`. All five attempts failed identically. A recoverable blip became a
deterministic permanent failure.

The release is conditional on **proof** the transition did not commit — a re-read showing the row
still SCHEDULED. A rejected promise is not that proof; it can land with the row already written,
which is the case `create()`'s reservation catch is explicitly built around. Releasing blind on
that path would hand a drone that is about to fly back to the dispatchable pool, and the retry
short-circuits on the leading status read so nothing re-claims it. A failed re-read also keeps
the claim: unknown is not "did not commit", a leak self-heals through the re-entrant claim, and a
double-booked airframe does not. (See *What the review caught* below — the first version of this
fix released unconditionally.)

**The claim is now re-entrant** (`selectAndClaim` returns the airframe this delivery already
holds). That is what makes the retry above idempotent rather than merely lucky, and it closes the
same window for `create()`.

**The debit-first reservation catch releases the airframe** — the one throw path out of `create()`
after the claim that did not.

### Verification
```
tsc (tsconfig.build.json): clean
tsc (tsconfig.json):       1 pre-existing error (deliveries.controller.spec.ts:120), unchanged
lint: 98 problems (0 errors, 98 warnings)   ← baseline unchanged
Test Suites: 85 passed, 85 total
Tests:       904 passed, 904 total          (+18)
prisma:drift-check: No difference detected   (no schema change in this increment)
```

**Mutation testing — 19 mutations, 19 caught.** Skipping the refusal handler; forcing every
refusal permanent; forcing every refusal transient; never exhausting the hold budget; resetting
the attempt counter on each defer; widening the dispatch-abort CAS past `[SCHEDULED]`; never
releasing when the transition write throws; releasing blind on an ambiguous failure; treating an
unreadable status as proof the write did not land; dropping the re-entrant lookup; keying it on
the drone id instead of the delivery; forcing force-cancel to `RETURN_TO_FLEET`; forcing it to
`GROUND_FOR_INSPECTION`; dropping the airborne axis from the failure disposition; grounding on
every failure regardless; dropping the debit-first release; dropping the status gate from the
airborne force-cancel CAS; dropping the delivery id from that CAS; dropping it from the airborne
failure CAS.

One mutation was initially miscounted: widening the abort CAS to `FAILABLE_STATUSES` fails to
**compile** in that file (it is not imported), so jest failing proved nothing about the tests.
Re-run as an explicit two-status array, which compiles — and is caught by the test.

**Baseline re-verified independently rather than read from this log:** every mechanically
checkable claim in the day's five entries (test counts, lint counts, drift, the `flight_frames`
partition key and its five partitions) was re-run and matched.

### What the review caught

This branch was itself reviewed before merging, by five lenses with an adversarial verifier on
each finding. It found a regression **this increment introduced**, which is the entry's most
useful line:

- **The release-on-CAS-throw was unconditional.** A rejected `updateMany` can land with the row
  already written. On that path the delivery is PENDING and bound to the aircraft, and
  `handleKickoff` returns early on any status that is not SCHEDULED, so nothing re-claims it —
  the release put a live delivery's airframe back in the dispatchable pool for the next booking
  to take. **Before this increment the same connection reset was benign** (the claim simply
  stayed, matching the committed state), so the first version of the fix strictly worsened it.
  The new test even used `connection reset by peer` as its trigger — the exact error that makes
  releasing wrong. Fixed by releasing only on proof, above.
- **Two CAS mutations survived the new tests**: dropping the status gate from the airborne
  force-cancel CAS (a DELIVERED delivery would be flipped to CANCELED and refunded), and dropping
  `id: deliveryId` from it (**one admin force-cancel would cancel every in-flight delivery in the
  fleet**). Both passed 103/103 because the disposition tests assert on `drone.updateMany` and the
  no-resurrect test used a flat `count: 0`. The count-based helper models Postgres faithfully —
  an absent filter constrains nothing — which is precisely why a count cannot see a missing
  predicate. Now asserted directly: every terminal-path CAS must carry its delivery id.

The lesson is the same one the corrections below record: a mock that answers "did it match?"
cannot tell you *what* it matched on. Where a CAS predicate is the safety property, assert the
predicate.

### Decisions made
- **Derive the disposition, don't pass it.** Threading an argument through `adminForceCancel`
  would have fixed the one call site and left the next one to make the same mistake. The question
  "was it flying?" has an answer in the data; the code now asks it.
- **Two CASes, not a read-then-write.** An advisory read of the status before the CAS would
  reintroduce exactly the race the single-winner CAS pattern exists to close.
- **Ground rather than hold the claim.** `STILL_AIRBORNE` is the honest label for a force-cancel
  and the wrong behavior — nothing would ever release it.
- **Share the pre-flight's hold budget.** A separate dispatch budget would let a delivery
  alternating between weather and saturation wait twice as long as either bound allows.
- **Re-entrancy over catching P2002.** Catching the constraint violation treats the symptom; the
  claim being non-idempotent is the defect.
- **Keep the claim when the outcome is unknown.** The two failure modes are not symmetric: a
  leaked claim is one aircraft out of service until someone looks, and the re-entrant claim heals
  it on the next retry; a wrongly released one is two deliveries flying one airframe. Every
  ambiguous branch resolves toward the leak.
- **Left `no_capacity`'s grounded-airframe gloss alone.** Dropping `airworthy` from the count
  would give a written-off fleet a permanent "try again shortly", and `Drone` has no
  retired/decommissioned concept to tell the two apart. Corrected the log, filed the behavior.

### Corrections to earlier entries
Four claims in the increments above overstated what was delivered, and the overstatement is
why three of these defects survived. Correction notes are inline at each claim (Phase 11
increment 3's defect table and its `no_capacity` gloss; its saturation-queue disclosure; Phase 12
increment 2's "same ordering rule `create()` uses"). The pattern to avoid: describing a fixed
call site as a fixed class.

### Left undone / follow-ups
- **Battery state-of-charge only ever decreases.** `drones.batteryPercent` became telemetry-written
  and a hard dispatch gate (`gte: 25`) on the same day; nothing raises it, and `DroneStatus.CHARGING`
  has zero call sites. A LIVE fleet strands itself after a few flights while the aircraft sit on
  chargers, and every booking gets "try again shortly" — a condition that never clears. Also
  `CreateDroneDto` has no `batteryPercent`, so a newly registered airframe flies its first mission
  on a fabricated `@default(100)`. **Required before any real fleet flies.**
- **No stale-claim sweeper.** A LIVE delivery claimed at PENDING/CONFIRMED whose gateway never
  sends a frame is covered by neither `WATCHDOG_STUCK_STATUSES` nor `FAILABLE_STATUSES`, so its
  claim is freed only by a human. Pre-existing; today's work gave it a consequence.
- **A mid-flight force-cancel leaves an aircraft the platform can no longer track.** Grounding
  clears `activeDeliveryId`, and both `updateDroneState` and `maybeRecall` are scoped by it. The
  trade (a double-dispatch for an untracked airframe) is the right one and is now explicit, but
  the real answer is an incident workflow — 12.6.
- **No customer notification on a dispatch hold**, same as the weather hold.
- `no_capacity` counts grounded airframes as absent (above).
- Per-aircraft ingest credentials (11.2); the saturation queue; Phase 12 items 12.4–12.7.

### Next
- **Phase 12 increment 4** — airspace as data (12.4) and/or the operator audit log (12.7).
  `forceCancel(deliveryId)` and `fail(deliveryId, reason)` still do not receive an admin id.
- Battery replenishment before `LIVE_DISPATCH` is turned on anywhere.
- **Phase 10** still blocked on Stripe test keys.

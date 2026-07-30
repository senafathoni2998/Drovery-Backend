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

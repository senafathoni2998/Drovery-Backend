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

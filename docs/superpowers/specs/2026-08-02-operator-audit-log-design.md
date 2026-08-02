# Operator audit log — design

**Date:** 2026-08-02
**Phase:** 12, increment 4 (plan item 12.7)
**Repo:** backend only

## Problem

Force-cancel, fail-with-reason, goodwill refund, role changes and promo edits leave only a pino
line that rotates away. `adminForceCancel(deliveryId)` and `adminFail(deliveryId, reason)` do not
even receive an admin id — the actor is dropped at the controller boundary.

The surface, measured rather than assumed: **11 mutating admin/agent routes. 3 receive an actor
id. 2 persist it.**

| # | Route | Service | Actor reaches service? | Persisted? |
|---|---|---|---|---|
| 1 | `POST /admin/deliveries/:id/force-cancel` | `DeliveriesService.adminForceCancel` | no | no |
| 2 | `POST /admin/deliveries/:id/fail` | `DeliveriesService.adminFail` | no | no |
| 3 | `POST /admin/deliveries/:id/refund` | `AdminService.refund` | no | no |
| 4 | `POST /admin/deliveries/:id/commands` | `DroneCommandService.issue` | yes | **yes** (`issuedByUserId`) |
| 5 | `POST /admin/drones` | `AdminService.createDrone` | no | no |
| 6 | `PATCH /admin/drones/:id` | `AdminService.updateDrone` | no | no |
| 7 | `POST /admin/promos` | `AdminService.createPromo` | no | no |
| 8 | `PATCH /admin/promos/:id` | `AdminService.updatePromo` | no | no |
| 9 | `PATCH /admin/users/:id/role` | `AdminService.setRole` | yes | no — logged only |
| 10 | `POST /admin/support/tickets/:id/messages` | `AdminService.replyAsAgent` | yes | **yes** (`senderUserId`) |
| 11 | `PATCH /admin/support/tickets/:id/status` | `AdminService.setTicketStatus` | no | no |

This increment gives all 11 a durable, queryable record.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Write guarantee | **Co-committed** with the mutation | A best-effort audit row drops exactly when you need it. Matches the existing pattern: `DroneCommand`'s audit *is* the command row. |
| Scope | **All 11**, including the 2 already persisting an actor | The log's value is being the ONE place that answers "what did this operator do?". If 2 of 11 are only reachable by joining `drone_commands` and `support_chat_messages`, it fails at its only job. Redundancy is the point. |
| Row content | **before/after of changed fields** on update-shaped actions; submitted arguments on the rest | "It was airworthy before you touched it" is what an incident review asks, and only a before-value answers it. |

### Which actions carry which

- **`before` + `after`** — `DRONE_UPDATE`, `PROMO_UPDATE`, `USER_ROLE_SET`,
  `SUPPORT_TICKET_STATUS_SET`: the changed fields' prior and new values.
- **`before` only** — `DELIVERY_FORCE_CANCEL` and `DELIVERY_FAIL` record the status they fired
  *from*. Increment 3 split both CASes by pre-launch vs in-flight precisely to know this, so the
  value is already in hand: it is the difference between cancelling a delivery that had not
  launched and one that was airborne, and it is the same fact that decided the aircraft's
  disposition. `after` is implied by the action.
- **`args` only** — `DELIVERY_REFUND` (amount), `DRONE_COMMAND_ISSUE` (type, reason),
  `DRONE_CREATE`, `PROMO_CREATE`, `SUPPORT_TICKET_REPLY` (message length, not content — see
  Redaction).
| Partitioning | **Partitioned**, following the convention | Consistent with `notifications` / `deliveries` / `drone_commands` / `flight_frames`. |
| Read surface | **`GET /admin/audit`**, this increment | Increment 1 shipped the flight recorder with no read surface; a write-only table is how you discover months later that the write was broken. |

## Data model

New model `AdminAuditLog`, `@@map("admin_audit_logs")`.

```
id                String    @default(uuid())
createdAt         DateTime  @default(now())   -- PARTITION KEY
actorUserId       String                      -- plain column, NO foreign key
actorRole         Role                        -- snapshot of the role at the time
action            AdminAuditAction
targetType        AdminAuditTargetType
targetId          String
before            Json?
after             Json?
args              Json?

@@id([id, createdAt])
@@index([actorUserId, createdAt])
@@index([targetType, targetId, createdAt])
@@index([action, createdAt])
```

### `actorUserId` has no foreign key — deliberately

`DroneCommand.issuedByUserId` uses `onDelete: SetNull` so deleting an admin cannot cascade the
audit row away. For an audit log that is the wrong trade: `SetNull` preserves the row while
destroying its single most important field. GDPR delete is on the backlog (`AUDIT-PLAN.md` §4);
when it lands it must not be able to erase attribution. A plain column cannot be nulled by a
cascade.

`actorUserId` is **non-null**. Every one of the 11 routes is authenticated and role-gated, so
there is always a human actor. The automated `RETURN_TO_BASE` issued by the flight recorder does
not pass through an admin route and gets no audit row — it is not an operator action, and
`DroneCommand.issuedByUserId` already records "the platform did it" for that case.

`actorRole` is snapshotted because `RolesGuard` re-reads the role from the DB on every request
(`roles.guard.ts:42`) and a role can change afterwards. "Who was an ADMIN when they did this" is
not answerable from the current `users` row.

### Enums

`AdminAuditAction` — 11 values, one per route:
`DELIVERY_FORCE_CANCEL`, `DELIVERY_FAIL`, `DELIVERY_REFUND`, `DRONE_COMMAND_ISSUE`,
`DRONE_CREATE`, `DRONE_UPDATE`, `PROMO_CREATE`, `PROMO_UPDATE`, `USER_ROLE_SET`,
`SUPPORT_TICKET_REPLY`, `SUPPORT_TICKET_STATUS_SET`.

`AdminAuditTargetType` — `DELIVERY`, `DRONE`, `PROMO`, `USER`, `SUPPORT_TICKET`.

An enum rather than a free string: it is queryable, groupable, and a typo cannot mint a phantom
action that no dashboard will ever show.

### Migration

Hand-written, following `prisma/migrations/20260801053057_add_flight_frames/migration.sql`:
composite PK with `id` first, `PARTITION BY RANGE ("createdAt")`, indexes created on the parent
with names byte-identical to Prisma's, a `DEFAULT` partition created before `partition_ensure`,
then `SELECT partition_ensure('admin_audit_logs', 3)`. Registered in `PARTITIONED_TABLES`
(`partition.constants.ts`). `npm run prisma:drift-check` must report no difference.

No composite FK: this table hangs off no partitioned parent, and `targetId` is polymorphic.

## Write path

`AdminAuditService.recordWithinTx(tx, entry)` — takes a Prisma transaction client, mirroring
`OutboxService.enqueueWithinTx` and `PromoService.redeemWithinTx`.

**The rule: the audit row co-commits with the authoritative state transition, never with the
best-effort cleanup that follows it.** `adminForceCancel` is CAS-then-cleanup, and the cleanup
does network I/O (refunds, MQTT, queue writes). Holding a transaction open across that would be a
worse defect than the one being fixed. The CAS is the moment the action happens, so that is what
the audit row commits with.

Per route:

| Route | Where the audit row commits |
|---|---|
| 1 force-cancel | Inside one interactive `$transaction` containing both force-cancel CASes. `cleanupAfterTermination` stays outside, unchanged. |
| 2 fail | Inside `failExceptional`'s CAS transaction, via a new extension point (below). |
| 3 refund | The existing `$transaction` in `AdminService.refund` — add the call. |
| 4 issue command | Wrap the existing `droneCommand.create`. |
| 5–8 drone/promo create+update | Wrap each single write. |
| 9 set role | Wrap the existing `user.update`. |
| 10 support reply | The existing `$transaction([...])` — add the call. |
| 11 ticket status | Wrap the existing update. |

### `failExceptional` needs an extension point

`adminFail` delegates to `failExceptional`, which owns the CAS **and** calls
`cleanupAfterTermination` + `announceException` internally. There is no seam to co-commit into
today.

`failExceptional` gains an optional `auditWithinTx?: (tx) => Promise<void>` parameter, invoked
inside the same interactive transaction as the status CAS, only when the CAS matched. `adminFail`
passes one; the watchdog and the pre-flight abort pass nothing and are byte-identical to today.

This mirrors the existing `allowedStatuses` parameter — a caller-supplied narrowing of a shared
transition — and is the same shape for the same reason: the operator-ness of a failure is a fact
about the caller, not about the transition.

**Non-goal:** the watchdog reap and the pre-flight abort are *not* operator actions and get no
audit row. Recording them would make "what did a human do?" unanswerable again, this time by
dilution rather than absence.

### Actor plumbing

Six controller methods currently drop the actor. Each gains `@CurrentUser('sub') actorId: string`
and passes it down; `RolesGuard` has already written the DB-fresh role onto `req.user`, so
`actorRole` is available at the same boundary without a second read.

## Redaction — allowlist, not denylist

`src/common/redact.ts` is a URL-token redactor only; it does not help here.

Each action declares the exact field names it captures into `before` / `after` / `args`. Anything
not on the list is dropped. A denylist would mean a field added to a DTO later starts appearing in
the audit log until someone remembers to exclude it; an allowlist fails closed.

Nothing captures a handoff code, a password hash, a token, or a full address.

`SUPPORT_TICKET_REPLY` records the message **length**, not its text. The content already lives in
`support_chat_messages` with its own `senderUserId`; copying customer-support prose into a second
table widens the blast radius of an audit-log read for no forensic gain — the question the audit
log answers is "who replied, and when".

## Read surface

`GET /admin/audit` — ADMIN-only (not AGENT: the log records agent actions, so agents reading it
is a separation-of-duties problem).

Query: `PaginationDto` (`page`, `limit` ≤ 100) plus optional `actorUserId`, `targetType`,
`targetId`, `action`, `from`, `to`. Ordered `createdAt` desc.

**Defaults to the last 30 days when no range is given.** On a partitioned table an unbounded
`ORDER BY createdAt DESC LIMIT 20` touches every partition; a default window keeps the plan
pruned. The default is documented in the response so a caller cannot mistake a windowed result
for the whole history.

## Retention

`PARTITION_RETAIN_MONTHS` is currently a **single global knob**, applied to every table in
`PARTITIONED_TABLES`. It defaults to `0` (retention disabled), so nothing is dropped today.

The hazard is specific: the one table whose write rate would ever motivate setting it is
`flight_frames`. Setting it for telemetry silently takes audit history with it.

`PARTITIONED_TABLES` therefore becomes a list of `{ table, retainMonths? }` entries, with
`retainMonths` overriding the global default per table. `admin_audit_logs` sets `0` explicitly —
never dropped, whatever the global is set to. This is a generalization rather than a special
case: telemetry and audit genuinely want different windows, and the maintenance loop keeps one
code path.

## Testing

Unit tests against the mocked Prisma, per the existing suite's conventions.

- **Atomicity is the class that matters.** If the audit write throws, the mutation rolls back —
  and no audit row is written when the CAS matches nothing. Both directions, per route.
- Each of the 11 routes: the actor reaches the service, and the row carries the right action,
  target and before/after.
- `failExceptional` without the callback behaves exactly as before (watchdog, pre-flight abort).
- The allowlist drops an unlisted field.
- The read endpoint: each filter, the default 30-day window, ADMIN-only, and pagination bounds.
- Migration verified against the live catalog (partition key + partitions), and
  `prisma:drift-check` clean.
- Mutation testing before merge, as every increment in this phase has done.

## Out of scope

- The ops console UI (12.5) and its per-delivery timeline.
- Backfilling history — there is none to backfill; it was only ever log lines.
- Alerting on audit events.
- Any admin repo change.

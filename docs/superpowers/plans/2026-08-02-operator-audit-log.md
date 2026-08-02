# Operator Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all 11 mutating admin/agent routes a durable, queryable audit row that commits in the same transaction as the mutation it records.

**Architecture:** A new partitioned `admin_audit_logs` table. One service, `AdminAuditService`, exposes `recordWithinTx(tx, entry)` — taking a Prisma transaction client, mirroring `OutboxService.enqueueWithinTx`. Each mutation wraps its authoritative write in an interactive `$transaction` and calls it. The audit row co-commits with the *state transition*, never with the best-effort cleanup that follows it (that cleanup does network I/O and must not be held inside a transaction). A read endpoint `GET /admin/audit` closes the loop.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL, native RANGE partitioning), Jest with a mocked Prisma client (`src/test/prisma-mock.ts`), class-validator DTOs.

**Spec:** `docs/superpowers/specs/2026-08-02-operator-audit-log-design.md`

## Global Constraints

- **Read the spec first.** Every design decision below is justified there; do not re-litigate them.
- **TDD is mandatory.** Write the failing test, run it, watch it fail for the right reason, then implement. This repo's tests are unit tests against a mocked Prisma — "tests pass" proves little, so each test must name the production change that would break it.
- **The audit row co-commits with the authoritative state transition, never with post-transition cleanup.** `cleanupAfterTermination` and `announceException` do network I/O (refunds, MQTT, queue writes). Nothing may hold a transaction open across them.
- **Never run `npm run lint`** — it passes `--fix` and rewrites files. Use `npx eslint "{src,apps,libs,test}/**/*.ts"`.
- **Lint baseline is exactly `98 problems (0 errors, 98 warnings)`.** Any new error must be fixed before commit. Prettier formatting is enforced as an error.
- **Typecheck with `npx tsc -p tsconfig.build.json --noEmit`** (must be clean). `tsconfig.json` has one pre-existing error at `src/deliveries/deliveries.controller.spec.ts:120` — ignore it, do not fix it.
- **Baseline at plan time: 904 tests, 85 suites, all passing.** Never let a suite go red.
- **Partitioned tables cannot use `findUnique`/`update`/`delete` by bare id.** There is no single-column unique on `id`. Use `findFirst` and `updateMany`. This will bite on `admin_audit_logs`.
- **`prisma db push` and `prisma db pull` are forbidden** (see `prisma/PARTITIONING.md`). Migrations are hand-written where partitioning is involved. `npm run prisma:drift-check` must report "No difference detected".
- **The DB URL lives in `.env`** and is not in the shell by default. Prefix DB commands: `set -a; . ./.env; set +a; <command>`.
- **Commit after every task**, with a message explaining *why* in the body — match the existing log's voice (`git log --oneline -20`).

---

### Task 1: The table

**Files:**
- Modify: `prisma/schema.prisma` (add model + 2 enums, and one `Role`-adjacent relation is deliberately NOT added)
- Create: `prisma/migrations/<timestamp>_add_admin_audit_logs/migration.sql`
- Modify: `src/partition-maintenance/partition.constants.ts:38-46`
- Modify: `src/partition-maintenance/partition-maintenance.service.ts:32-47`
- Modify: `src/test/prisma-mock.ts:20-33` and the model list around `:94-127`
- Test: `src/partition-maintenance/partition-maintenance.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `AdminAuditLog` with fields `id, createdAt, actorUserId, actorRole, action, targetType, targetId, before, after, args`; enums `AdminAuditAction` and `AdminAuditTargetType`; `PARTITIONED_TABLES` becomes `readonly PartitionedTable[]` where `PartitionedTable = { table: string; retainMonths?: number }`; `prisma.adminAuditLog` exists on the test mock.

- [ ] **Step 1: Add the model and enums to `prisma/schema.prisma`**

Place the enums next to the other domain enums, and the model at the end of the file near `FlightFrame`.

```prisma
enum AdminAuditAction {
  DELIVERY_FORCE_CANCEL
  DELIVERY_FAIL
  DELIVERY_REFUND
  DRONE_COMMAND_ISSUE
  DRONE_CREATE
  DRONE_UPDATE
  PROMO_CREATE
  PROMO_UPDATE
  USER_ROLE_SET
  SUPPORT_TICKET_REPLY
  SUPPORT_TICKET_STATUS_SET
}

enum AdminAuditTargetType {
  DELIVERY
  DRONE
  PROMO
  USER
  SUPPORT_TICKET
}

/// Operator actions, append-only. Partitioned from birth by RANGE("createdAt").
///
/// `actorUserId` carries NO foreign key, unlike DroneCommand.issuedByUserId. That
/// column uses onDelete: SetNull so deleting an admin cannot cascade the audit row
/// away — but for an audit log SetNull is the wrong trade: it preserves the row while
/// destroying its single most important field. GDPR delete is on the backlog; when it
/// lands it must not be able to erase attribution. A plain column cannot be nulled by
/// a cascade.
model AdminAuditLog {
  id        String   @default(uuid())
  createdAt DateTime @default(now())

  /// The operator. Non-null: every audited route is authenticated and role-gated.
  /// The platform's own automated RETURN_TO_BASE does not pass through an admin
  /// route and gets no row here — DroneCommand.issuedByUserId already records it.
  actorUserId String
  /// Snapshot. RolesGuard re-reads the role from the DB per request and it can change
  /// afterwards; "who was an ADMIN when they did this" is not answerable from `users`.
  actorRole Role

  action     AdminAuditAction
  targetType AdminAuditTargetType
  targetId   String

  /// Changed fields only, prior values (update-shaped actions) or the status a
  /// delivery transition fired FROM.
  before Json?
  /// Changed fields only, new values.
  after Json?
  /// Submitted arguments, for actions with no prior state.
  args Json?

  @@id([id, createdAt])
  @@index([actorUserId, createdAt])
  @@index([targetType, targetId, createdAt])
  @@index([action, createdAt])
  @@map("admin_audit_logs")
}
```

- [ ] **Step 2: Generate the migration scaffold, then replace it**

```bash
set -a; . ./.env; set +a
npx prisma migrate dev --create-only --name add_admin_audit_logs
```

Prisma emits a plain `CREATE TABLE` — it cannot express `PARTITION BY`. Replace the generated `migration.sql` entirely with the following. Keep the index names byte-identical to what Prisma generated (check the file before overwriting; if they differ from below, use Prisma's, or the drift gate will fail).

```sql
-- Operator audit log, PARTITIONED FROM BIRTH by RANGE("createdAt").
--
-- Prisma generated a plain CREATE TABLE (it cannot express PARTITION BY); this is the
-- hand-written equivalent. See prisma/PARTITIONING.md.
--
-- Unlike every other partitioned child this one does NOT hang off `deliveries`: its
-- `targetId` is polymorphic (a delivery, a drone, a promo, a user, a ticket), so there
-- is no composite FK to add and its partition key is its own "createdAt".
--
-- Retention: this table sets retainMonths 0 explicitly in PARTITIONED_TABLES. It is
-- partitioned for the convention and for partition pruning on reads, NOT so that its
-- history can be dropped.

-- 1. The partitioned parent. Composite PK, id first, so a bare-id lookup still uses it.
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" "AdminAuditAction" NOT NULL,
    "targetType" "AdminAuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "args" JSONB,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id","createdAt")
) PARTITION BY RANGE ("createdAt");

-- 2. Indexes on the parent; PG propagates them to every partition, existing and future.
--    Names preserved exactly as Prisma generated them so the drift gate sees no diff.
CREATE INDEX "admin_audit_logs_actorUserId_createdAt_idx" ON "admin_audit_logs"("actorUserId", "createdAt");
CREATE INDEX "admin_audit_logs_targetType_targetId_createdAt_idx" ON "admin_audit_logs"("targetType", "targetId", "createdAt");
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

-- 3. The permanent catch-all, so an INSERT can never fail for want of a partition. An
--    audit write that fails now rolls back the operator action it was recording.
CREATE TABLE "admin_audit_logs_default" PARTITION OF "admin_audit_logs" DEFAULT;

-- 4. Provision the forward window now rather than waiting for the first maintenance run.
SELECT partition_ensure('admin_audit_logs', 3);
```

Note the enum types must already exist when this runs — Prisma emits the `CREATE TYPE` statements. Keep them at the top of the file, above the `CREATE TABLE`.

- [ ] **Step 3: Apply and verify against the live catalog**

```bash
set -a; . ./.env; set +a
npx prisma migrate dev
npm run prisma:drift-check
U="${DATABASE_URL%%\?*}"
psql "$U" -At -c "SELECT pg_get_partkeydef('admin_audit_logs'::regclass);"
psql "$U" -At -c "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='admin_audit_logs' ORDER BY 1;"
```

Expected: drift-check says `No difference detected`; partition key is `RANGE ("createdAt")`; partitions are `admin_audit_logs_default` plus three forward months.

- [ ] **Step 4: Write the failing test for per-table retention**

The retention override is the point of this step: `PARTITION_RETAIN_MONTHS` is a single global knob, and the one table whose write rate would ever motivate setting it is `flight_frames`. Setting it for telemetry must not take audit history with it.

Add to `src/partition-maintenance/partition-maintenance.service.spec.ts`:

```typescript
it('never drops audit history, even when global retention is enabled', async () => {
  // The global knob exists for flight_frames volume. admin_audit_logs opts out by
  // name, so enabling retention for telemetry cannot silently erase who did what.
  process.env.PARTITION_RETAIN_MONTHS = '6';
  jest.resetModules();

  const { PARTITIONED_TABLES } = await import(
    './partition.constants'
  );
  const audit = PARTITIONED_TABLES.find(
    (t) => t.table === 'admin_audit_logs',
  );

  expect(audit).toBeDefined();
  expect(audit!.retainMonths).toBe(0);

  delete process.env.PARTITION_RETAIN_MONTHS;
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx jest src/partition-maintenance/partition-maintenance.service.spec.ts -t "never drops audit history"
```

Expected: FAIL — `PARTITIONED_TABLES.find is not a function` or `audit` is `undefined`, because `PARTITIONED_TABLES` is still `readonly string[]`.

- [ ] **Step 6: Change `PARTITIONED_TABLES` to carry a per-table retention override**

In `src/partition-maintenance/partition.constants.ts`, replace the `PARTITIONED_TABLES` declaration (currently `readonly string[]` at `:38-46`):

```typescript
export interface PartitionedTable {
  table: string;
  /**
   * Per-table retention override, in months. Falls back to the global
   * PARTITION_RETAIN_MONTHS when omitted. 0 means NEVER drop.
   *
   * This exists because the global knob is one setting for every table, and the only
   * table whose write rate would ever motivate enabling it is `flight_frames`. Without
   * an override, tuning telemetry retention silently deletes audit history too.
   */
  retainMonths?: number;
}

export const PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { table: 'notifications' },
  { table: 'workflow_step_completions' },
  { table: 'drone_commands' },
  // The flight recorder — by far the highest-volume child (one row per telemetry
  // tick), so its aged months are the ones retention most needs to bare-DROP.
  { table: 'flight_frames' },
  // Operator actions. Partitioned for the convention and for read pruning, NOT so the
  // history can age out: retention is pinned OFF regardless of the global setting.
  { table: 'admin_audit_logs', retainMonths: 0 },
  { table: 'deliveries' },
];
```

- [ ] **Step 7: Update the maintenance loop to honour the override**

In `src/partition-maintenance/partition-maintenance.service.ts`, change the loop header and the retention branch:

```typescript
  async run(): Promise<void> {
    for (const { table, retainMonths } of PARTITIONED_TABLES) {
      try {
        const drained = await this.callFn('partition_drain_default', table);
        const created = await this.callFn(
          'partition_ensure',
          table,
          PARTITION_MONTHS_AHEAD,
        );
        // Per-table override wins over the global default, INCLUDING an explicit 0
        // (never drop) — so `?? ` and not `||`.
        const retain = retainMonths ?? PARTITION_RETAIN_MONTHS;
        const dropped =
          retain > 0 ? await this.callFn('partition_drop_old', table, retain) : 0;
```

The rest of the loop body is unchanged. Fix any other `PARTITIONED_TABLES` consumers the typecheck flags (the oldest-partition gauge later in the same method iterates the same list — it needs `table` destructured, which the header now provides).

- [ ] **Step 8: Add the mock delegate**

In `src/test/prisma-mock.ts`, add `| 'adminAuditLog'` to the model-name union around `:20-33`, and `adminAuditLog: createModelMock(),` to the object literal around `:94-127`.

- [ ] **Step 9: Run the tests**

```bash
npx jest src/partition-maintenance
npx tsc -p tsconfig.build.json --noEmit
```

Expected: all pass, typecheck clean. If other specs assert on `PARTITIONED_TABLES` as strings, update them — the shape changed deliberately.

- [ ] **Step 10: Commit**

```bash
git add prisma/ src/partition-maintenance/ src/test/prisma-mock.ts
git commit -m "feat(audit): admin_audit_logs, partitioned from birth and pinned out of retention

Retention is a single global knob applied to every partitioned table, and the one
table whose write rate would ever motivate enabling it is flight_frames. Tuning
telemetry retention would have silently dropped audit history, so PARTITIONED_TABLES
now carries a per-table override and this table pins it to 0.

actorUserId deliberately carries no FK: DroneCommand uses onDelete SetNull so deleting
an admin cannot cascade the row away, but for an audit log that preserves the row while
destroying its most important field."
```

---

### Task 2: `AdminAuditService`

**Files:**
- Create: `src/admin/audit/admin-audit.service.ts`
- Create: `src/admin/audit/admin-audit.constants.ts`
- Create: `src/admin/audit/admin-audit.service.spec.ts`
- Modify: `src/admin/admin.module.ts`

**Interfaces:**
- Consumes: `prisma.adminAuditLog` (Task 1).
- Produces:
  - `AUDIT_FIELD_ALLOWLIST: Record<AdminAuditAction, readonly string[]>`
  - `pickAllowed(action: AdminAuditAction, source: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined`
  - `diffAllowed(action, before, after): { before?: Record<string, unknown>; after?: Record<string, unknown> }`
  - `AdminAuditService.recordWithinTx(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>` where
    `AuditEntry = { actorUserId: string; actorRole: Role; action: AdminAuditAction; targetType: AdminAuditTargetType; targetId: string; before?: Record<string, unknown>; after?: Record<string, unknown>; args?: Record<string, unknown> }`

- [ ] **Step 1: Write the failing tests**

Create `src/admin/audit/admin-audit.service.spec.ts`:

```typescript
import { AdminAuditAction, AdminAuditTargetType, Role } from '@prisma/client';

import { createMockPrismaService } from '../../test/prisma-mock';
import { AdminAuditService } from './admin-audit.service';
import { diffAllowed, pickAllowed } from './admin-audit.constants';

describe('AdminAuditService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: AdminAuditService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminAuditService();
  });

  it('writes the row through the CALLER transaction, not its own client', async () => {
    // The whole guarantee: the audit row commits with the mutation or not at all. A
    // service holding its own PrismaService would commit independently and silently
    // reintroduce the best-effort log this increment exists to replace.
    await service.recordWithinTx(prisma as any, {
      actorUserId: 'admin-1',
      actorRole: Role.ADMIN,
      action: AdminAuditAction.DRONE_UPDATE,
      targetType: AdminAuditTargetType.DRONE,
      targetId: 'drone-7',
      before: { airworthy: true },
      after: { airworthy: false },
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-1',
        actorRole: Role.ADMIN,
        action: AdminAuditAction.DRONE_UPDATE,
        targetType: AdminAuditTargetType.DRONE,
        targetId: 'drone-7',
        before: { airworthy: true },
        after: { airworthy: false },
        args: undefined,
      },
    });
  });

  it('propagates a write failure instead of swallowing it', async () => {
    // Swallowing here would leave the mutation committed with no record — exactly the
    // failure mode a co-committed audit row exists to make impossible.
    prisma.adminAuditLog.create.mockRejectedValue(new Error('disk full'));

    await expect(
      service.recordWithinTx(prisma as any, {
        actorUserId: 'admin-1',
        actorRole: Role.ADMIN,
        action: AdminAuditAction.USER_ROLE_SET,
        targetType: AdminAuditTargetType.USER,
        targetId: 'user-2',
      }),
    ).rejects.toThrow('disk full');
  });
});

describe('audit field allowlist', () => {
  it('keeps only the declared fields', () => {
    const picked = pickAllowed(AdminAuditAction.DRONE_CREATE, {
      serial: 'DRV-001',
      rangeKm: 12,
      ingestKeyHash: 'secret-hash',
    });

    // Allowlist, not denylist: a field added to a DTO later cannot start appearing
    // in the audit log until someone declares it.
    expect(picked).toEqual({ serial: 'DRV-001', rangeKm: 12 });
  });

  it('is undefined rather than empty when nothing survives', () => {
    expect(
      pickAllowed(AdminAuditAction.DRONE_CREATE, { ingestKeyHash: 'x' }),
    ).toBeUndefined();
    expect(pickAllowed(AdminAuditAction.DRONE_CREATE, null)).toBeUndefined();
  });

  it('diffs only the fields that actually changed', () => {
    const { before, after } = diffAllowed(
      AdminAuditAction.DRONE_UPDATE,
      { airworthy: true, status: 'AVAILABLE', serial: 'DRV-001' },
      { airworthy: false, status: 'AVAILABLE', serial: 'DRV-001' },
    );

    // An unchanged field in the diff is noise that makes a real change harder to see.
    expect(before).toEqual({ airworthy: true });
    expect(after).toEqual({ airworthy: false });
  });

  it('reports no diff when nothing changed', () => {
    const { before, after } = diffAllowed(
      AdminAuditAction.DRONE_UPDATE,
      { airworthy: true },
      { airworthy: true },
    );

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  it('never captures a support reply body, only its length', () => {
    // The content already lives in support_chat_messages with its own senderUserId.
    // Copying customer prose here widens what an audit read exposes for no forensic gain.
    const picked = pickAllowed(AdminAuditAction.SUPPORT_TICKET_REPLY, {
      content: 'my card was charged twice, here is my number 0812...',
      contentLength: 51,
    });

    expect(picked).toEqual({ contentLength: 51 });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx jest src/admin/audit
```

Expected: FAIL — `Cannot find module './admin-audit.service'`.

- [ ] **Step 3: Write `admin-audit.constants.ts`**

```typescript
import { AdminAuditAction } from '@prisma/client';

/**
 * Which fields each action may capture into `before` / `after` / `args`.
 *
 * An ALLOWLIST, not a denylist, and the difference is load-bearing: a denylist means a
 * field added to a DTO later starts appearing in the audit log until somebody remembers
 * to exclude it. This fails closed instead.
 *
 * Nothing here captures a handoff code, a password hash, an ingest key, a token or a
 * full address. SUPPORT_TICKET_REPLY captures the message LENGTH, never its text — the
 * content already lives in `support_chat_messages` with its own `senderUserId`.
 */
export const AUDIT_FIELD_ALLOWLIST: Record<
  AdminAuditAction,
  readonly string[]
> = {
  DELIVERY_FORCE_CANCEL: ['status'],
  DELIVERY_FAIL: ['status', 'reason'],
  DELIVERY_REFUND: ['amount'],
  DRONE_COMMAND_ISSUE: ['type', 'reason'],
  DRONE_CREATE: ['serial', 'model', 'maxPayloadKg', 'rangeKm', 'homeBaseLat', 'homeBaseLng'],
  DRONE_UPDATE: [
    'status',
    'airworthy',
    'model',
    'firmwareVersion',
    'maxPayloadKg',
    'rangeKm',
    'maintenanceDueAt',
    'homeBaseLat',
    'homeBaseLng',
  ],
  PROMO_CREATE: ['code', 'discountType', 'discountValue', 'maxRedemptions', 'endsAt'],
  PROMO_UPDATE: [
    'discountValue',
    'minOrderTotal',
    'maxDiscount',
    'endsAt',
    'maxRedemptions',
    'active',
  ],
  USER_ROLE_SET: ['role'],
  SUPPORT_TICKET_REPLY: ['contentLength'],
  SUPPORT_TICKET_STATUS_SET: ['status'],
};

type Fields = Record<string, unknown>;

/** Keep only the declared fields; `undefined` when nothing survives, so an empty object
 *  is never stored (an empty `{}` reads as "we captured this and it was blank"). */
export function pickAllowed(
  action: AdminAuditAction,
  source: Fields | null | undefined,
): Fields | undefined {
  if (!source) return undefined;
  const allowed = AUDIT_FIELD_ALLOWLIST[action];
  const out: Fields = {};
  for (const key of allowed) {
    if (source[key] !== undefined) out[key] = normalize(source[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Prior/new values of the allowed fields that ACTUALLY changed. An unchanged field in
 *  the diff is noise that makes the real change harder to find. */
export function diffAllowed(
  action: AdminAuditAction,
  before: Fields | null | undefined,
  after: Fields | null | undefined,
): { before?: Fields; after?: Fields } {
  const b = pickAllowed(action, before) ?? {};
  const a = pickAllowed(action, after) ?? {};
  const changedBefore: Fields = {};
  const changedAfter: Fields = {};

  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      if (b[key] !== undefined) changedBefore[key] = b[key];
      if (a[key] !== undefined) changedAfter[key] = a[key];
    }
  }

  return {
    before: Object.keys(changedBefore).length ? changedBefore : undefined,
    after: Object.keys(changedAfter).length ? changedAfter : undefined,
  };
}

/** Dates go in as ISO strings so a JSONB round-trip compares equal to what went in. */
function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
```

- [ ] **Step 4: Write `admin-audit.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import {
  AdminAuditAction,
  AdminAuditTargetType,
  Prisma,
  Role,
} from '@prisma/client';

export interface AuditEntry {
  actorUserId: string;
  actorRole: Role;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

/**
 * The operator audit log's write side.
 *
 * It holds NO PrismaService. Every method takes the caller's transaction client, so an
 * audit row cannot commit independently of the mutation it records — which is the whole
 * guarantee. A service with its own client would compile, pass tests, and silently
 * reintroduce the best-effort trail this replaces.
 *
 * Failures propagate. An audit write that throws must roll the operator's action back:
 * a mutation that happened with no record of who did it is the exact state this exists
 * to make impossible.
 */
@Injectable()
export class AdminAuditService {
  async recordWithinTx(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before as Prisma.InputJsonValue | undefined,
        after: entry.after as Prisma.InputJsonValue | undefined,
        args: entry.args as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
```

- [ ] **Step 5: Register it in `src/admin/admin.module.ts`**

Add `AdminAuditService` to `providers` and to `exports` (Task 4 needs it from `DeliveriesModule`'s side — export it so the eventual import is a one-liner).

- [ ] **Step 6: Run the tests**

```bash
npx jest src/admin/audit
npx tsc -p tsconfig.build.json --noEmit
```

Expected: all pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/admin/audit/ src/admin/admin.module.ts
git commit -m "feat(audit): the write side, with an allowlist that fails closed

AdminAuditService holds no PrismaService — every method takes the caller's transaction
client, so an audit row cannot commit independently of the mutation it records. A
service with its own client would compile, pass its tests, and silently reintroduce the
best-effort trail this replaces.

Fields are an allowlist rather than a denylist: a field added to a DTO later cannot
start appearing in the audit log until somebody declares it."
```

---

### Task 3: The `failExceptional` extension point

**Files:**
- Modify: `src/deliveries/deliveries.service.ts` (`failExceptional`, currently around `:950-1020`)
- Test: `src/deliveries/deliveries.service.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `failExceptional(deliveryId: string, reason: DeliveryFailureReason, allowedStatuses?: DeliveryStatus[], auditWithinTx?: (tx: Prisma.TransactionClient, firedFrom: DeliveryStatus | null) => Promise<void>): Promise<boolean>` — the callback runs inside the same interactive transaction as the status CAS, only when the CAS matched, and receives the status the transition fired FROM.

**Why this task exists:** `adminFail` delegates to `failExceptional`, which owns the CAS *and* calls `cleanupAfterTermination` + `announceException`. There is no seam to co-commit into today, and those two do network I/O so the transaction cannot simply be widened around them.

- [ ] **Step 1: Write the failing tests**

Add to the `aircraft release — the claim lifecycle` describe in `src/deliveries/deliveries.service.spec.ts` (it already has the `deliveryReallyIn` helper):

```typescript
it('runs the audit callback inside the CAS transaction, before any cleanup', async () => {
  deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
  const audit = jest.fn().mockResolvedValue(undefined);

  await service.failExceptional(
    'delivery-1',
    'MECHANICAL' as any,
    undefined,
    audit,
  );

  // Co-committed with the transition, not bolted on after it.
  expect(prisma.$transaction).toHaveBeenCalled();
  expect(audit).toHaveBeenCalledTimes(1);
  // And it learns which status the transition fired FROM — the fact that decides
  // whether an aircraft was airborne.
  expect(audit.mock.calls[0][1]).toBe(DeliveryStatus.IN_TRANSIT);
});

it('does not audit a transition that did not happen', async () => {
  deliveryReallyIn(DeliveryStatus.DELIVERED); // outside FAILABLE_STATUSES
  const audit = jest.fn().mockResolvedValue(undefined);

  const applied = await service.failExceptional(
    'delivery-1',
    'MECHANICAL' as any,
    undefined,
    audit,
  );

  expect(applied).toBe(false);
  expect(audit).not.toHaveBeenCalled();
});

it('rolls the failure back when the audit write throws', async () => {
  deliveryReallyIn(DeliveryStatus.IN_TRANSIT);
  const audit = jest.fn().mockRejectedValue(new Error('audit write failed'));

  await expect(
    service.failExceptional('delivery-1', 'MECHANICAL' as any, undefined, audit),
  ).rejects.toThrow('audit write failed');

  // The cleanup must not have run — the transition it cleans up after never committed.
  expect(prisma.drone.updateMany).not.toHaveBeenCalled();
});

it('is byte-identical for callers that pass no callback', async () => {
  // The watchdog and the pre-flight abort are not operator actions and get no row.
  deliveryReallyIn(DeliveryStatus.IN_TRANSIT);

  const applied = await service.failExceptional('delivery-1', 'MECHANICAL' as any);

  expect(applied).toBe(true);
  expect(prisma.drone.updateMany).toHaveBeenCalled(); // cleanup still ran
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/deliveries/deliveries.service.spec.ts -t "audit callback inside the CAS"
```

Expected: FAIL — `audit` is never called (the 4th parameter does not exist yet).

- [ ] **Step 3: Add the parameter and wrap the CASes in one interactive transaction**

In `failExceptional`, replace the two sequential `this.prisma.delivery.updateMany(...)` calls (added in increment 3) with a single interactive transaction that also runs the callback. The existing `airborneAllowed` / `groundedAllowed` split and the `airborne` flag stay exactly as they are.

```typescript
    allowedStatuses: DeliveryStatus[] = FAILABLE_STATUSES,
    /**
     * Optional: write an audit row in the SAME transaction as the status CAS.
     *
     * Runs only when the CAS matched, and receives the status the transition fired
     * FROM — the fact that decides whether an aircraft was airborne. Callers that pass
     * nothing (the watchdog, the pre-flight abort) are byte-identical to before: those
     * are not operator actions, and recording them would make "what did a human do?"
     * unanswerable by dilution rather than absence.
     *
     * It runs INSIDE the transaction and OUTSIDE cleanupAfterTermination, which does
     * network I/O (refunds, MQTT, queue writes) that must never be held in one.
     */
    auditWithinTx?: (
      tx: Prisma.TransactionClient,
      firedFrom: DeliveryStatus | null,
    ) => Promise<void>,
  ): Promise<boolean> {
    const airborneAllowed = allowedStatuses.filter((s) =>
      FAILABLE_STATUSES.includes(s),
    );
    const groundedAllowed = allowedStatuses.filter(
      (s) => !FAILABLE_STATUSES.includes(s),
    );

    const outcome = await this.prisma.$transaction(async (tx) => {
      let matched = 0;
      let firedFrom: DeliveryStatus | null = null;
      let wasAirborne = false;

      if (groundedAllowed.length) {
        ({ count: matched } = await tx.delivery.updateMany({
          where: { id: deliveryId, status: { in: groundedAllowed } },
          data: { status: DeliveryStatus.DELIVERY_FAILED, failureReason: reason },
        }));
        if (matched > 0) firedFrom = groundedAllowed[0] ?? null;
      }
      if (matched === 0 && airborneAllowed.length) {
        ({ count: matched } = await tx.delivery.updateMany({
          where: { id: deliveryId, status: { in: airborneAllowed } },
          data: { status: DeliveryStatus.DELIVERY_FAILED, failureReason: reason },
        }));
        if (matched > 0) {
          wasAirborne = true;
          firedFrom = airborneAllowed[0] ?? null;
        }
      }
      if (matched === 0) return null;

      if (auditWithinTx) await auditWithinTx(tx, firedFrom);
      return { airborne: wasAirborne };
    });

    if (!outcome) return false;
    const airborne = outcome.airborne;
```

Everything from the `// TWO independent reasons to keep an aircraft out...` comment onwards is unchanged.

**Caveat to carry:** `firedFrom` is the first status of the matching set, not necessarily the row's exact status when the set has more than one member. When the caller needs the precise value it must read it — `adminForceCancel` (Task 4) does. This is honest about what a CAS can tell you and is why the parameter is named `firedFrom` rather than `previousStatus`. State this in the doc comment.

- [ ] **Step 4: Run the tests**

```bash
npx jest src/deliveries/deliveries.service.spec.ts
npx jest src/delivery-watchdog src/deliveries/simulation
```

Expected: all pass. The watchdog and pre-flight suites are the regression guard that the no-callback path is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/deliveries/deliveries.service.ts src/deliveries/deliveries.service.spec.ts
git commit -m "feat(deliveries): let a caller co-commit an audit row with a failure CAS

adminFail delegates to failExceptional, which owns both the CAS and the network-I/O
cleanup that follows it, so there was no seam to co-commit into and the transaction
could not simply be widened.

Mirrors allowedStatuses: a caller-supplied narrowing of a shared transition, for the
same reason — the operator-ness of a failure is a fact about the caller, not about the
transition. The watchdog and the pre-flight abort pass nothing and are unchanged; they
are not operator actions and deliberately get no row."
```

---

### Task 4: Delivery mutations — force-cancel, fail, refund

**Files:**
- Modify: `src/admin/admin.controller.ts:66-83`
- Modify: `src/admin/admin.service.ts` (`forceCancel` `:204-206`, `fail` `:210-215`, `refund` `:237-288`)
- Modify: `src/deliveries/deliveries.service.ts` (`adminForceCancel`, `adminFail`)
- Modify: `src/deliveries/deliveries.module.ts` (import `AdminAuditService`)
- Test: `src/admin/admin.service.spec.ts`, `src/deliveries/deliveries.service.spec.ts`

**Interfaces:**
- Consumes: `AdminAuditService.recordWithinTx` (Task 2); `failExceptional`'s `auditWithinTx` (Task 3).
- Produces: `AdminService.forceCancel(actor: AuditActor, deliveryId: string)`, `AdminService.fail(actor: AuditActor, deliveryId: string, reason?: DeliveryFailureReason)`, `AdminService.refund(actor: AuditActor, deliveryId: string, amount?: number)`, and `AuditActor = { userId: string; role: Role }` exported from `src/admin/audit/admin-audit.service.ts`.

- [ ] **Step 1: Add the `AuditActor` type and a controller decorator for it**

In `src/admin/audit/admin-audit.service.ts`:

```typescript
/** Who is acting. Assembled at the controller boundary, where RolesGuard has already
 *  written the DB-fresh role onto the request. */
export interface AuditActor {
  userId: string;
  role: Role;
}
```

`RolesGuard` sets `req.user.role` (`src/common/guards/roles.guard.ts:42`), so both fields come from the existing `@CurrentUser` decorator with no extra read.

- [ ] **Step 2: Write the failing tests**

Add a new describe to `src/admin/admin.service.spec.ts`:

```typescript
describe('operator audit — delivery mutations', () => {
  const actor = { userId: 'admin-1', role: 'ADMIN' as const };

  it('records who force-cancelled, and the status it fired from', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.delivery.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'IN_TRANSIT',
    });

    await service.forceCancel(actor, 'd-1');

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'DELIVERY_FORCE_CANCEL',
        targetType: 'DELIVERY',
        targetId: 'd-1',
        before: { status: 'IN_TRANSIT' },
      }),
    });
  });

  it('records the refund amount inside the refund transaction', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.delivery.findUnique.mockResolvedValue({
      userId: 'u-1',
      estimatedPrice: 20,
    });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });

    await service.refund(actor, 'd-1', 5);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DELIVERY_REFUND',
        targetId: 'd-1',
        args: { amount: 5 },
      }),
    });
  });

  it('writes no audit row when the refund loses its single-winner gate', async () => {
    // The gate exists so a card charge is refunded at most once. An audit row for a
    // refund that did not happen is worse than none — it invents an event.
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.delivery.findUnique.mockResolvedValue({
      userId: 'u-1',
      estimatedPrice: 20,
    });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.refund(actor, 'd-1', 5)).rejects.toThrow();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run and watch them fail**

```bash
npx jest src/admin/admin.service.spec.ts -t "operator audit"
```

Expected: FAIL — `forceCancel` takes one argument, so `actor` lands in `deliveryId`.

- [ ] **Step 4: Thread the actor through the three controller methods**

In `src/admin/admin.controller.ts`:

```typescript
  @Post('deliveries/:id/force-cancel')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  forceCancel(
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') actorRole: Role,
    @Param('id') id: string,
  ) {
    return this.admin.forceCancel({ userId: actorId, role: actorRole }, id);
  }

  @Post('deliveries/:id/fail')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  fail(
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') actorRole: Role,
    @Param('id') id: string,
    @Body() dto: FailDeliveryDto,
  ) {
    return this.admin.fail({ userId: actorId, role: actorRole }, id, dto.reason);
  }

  @Post('deliveries/:id/refund')
  @ApiCreatedResponse({ type: AdminRefundResponseDto })
  refund(
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') actorRole: Role,
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    return this.admin.refund({ userId: actorId, role: actorRole }, id, dto.amount);
  }
```

- [ ] **Step 5: Make `adminForceCancel` co-commit its audit row**

`adminForceCancel` (increment 3) runs two CASes and derives the aircraft disposition from which one matched. Wrap both plus the audit write in one interactive transaction; `cleanupAfterTermination` stays outside, exactly where it is.

Change the signature to `adminForceCancel(deliveryId: string, auditWithinTx?: (tx: Prisma.TransactionClient, firedFrom: DeliveryStatus) => Promise<void>)`. Inside the transaction, before each CAS, read the current status with `tx.delivery.findFirst({ where: { id: deliveryId }, select: { status: true } })` so `firedFrom` is the *exact* status rather than a set member — force-cancel is a rare admin path and can afford the read, and "you cancelled an IN_TRANSIT delivery" is the whole point of capturing it.

`AdminService.forceCancel` then becomes:

```typescript
  forceCancel(actor: AuditActor, deliveryId: string) {
    return this.deliveries.adminForceCancel(deliveryId, (tx, firedFrom) =>
      this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DELIVERY_FORCE_CANCEL,
        targetType: AdminAuditTargetType.DELIVERY,
        targetId: deliveryId,
        before: { status: firedFrom },
      }),
    );
  }
```

- [ ] **Step 6: Wire `fail` through the Task 3 callback**

`adminFail` gains the same optional callback and forwards it to `failExceptional`. `AdminService.fail`:

```typescript
  fail(actor: AuditActor, deliveryId: string, reason?: DeliveryFailureReason) {
    const resolved = reason ?? DeliveryFailureReason.ADMIN_ABORT;
    return this.deliveries.adminFail(deliveryId, resolved, (tx, firedFrom) =>
      this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DELIVERY_FAIL,
        targetType: AdminAuditTargetType.DELIVERY,
        targetId: deliveryId,
        before: { status: firedFrom },
        args: { reason: resolved },
      }),
    );
  }
```

- [ ] **Step 7: Wire `refund` into its existing transaction**

`AdminService.refund` already runs `this.prisma.$transaction(async (tx) => {...})`. Add the audit call after the `count === 0` guard and after `creditWithinTx`, so it only records a refund that actually won the single-winner gate:

```typescript
        await this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.DELIVERY_REFUND,
          targetType: AdminAuditTargetType.DELIVERY,
          targetId: deliveryId,
          args: { amount: refundAmount },
        });
```

Inject `AdminAuditService` into `AdminService`'s constructor, and import it where `DeliveriesService` needs it (`deliveries.module.ts`).

- [ ] **Step 8: Run the tests**

```bash
npx jest src/admin src/deliveries
npx tsc -p tsconfig.build.json --noEmit
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
```

Expected: all pass; typecheck clean; lint back at `98 problems (0 errors, 98 warnings)`. Existing `admin.service.spec.ts` tests calling `forceCancel('d-1')` will need the actor argument — update them.

- [ ] **Step 9: Commit**

```bash
git add src/admin/ src/deliveries/
git commit -m "feat(audit): record who force-cancelled, failed or refunded a delivery

These three dropped the actor at the controller boundary — adminForceCancel and
adminFail did not even receive an admin id — leaving a pino line that rotates away as
the only trace of an action that grounds aircraft and moves money.

Each row co-commits with the authoritative CAS, never with the cleanup that follows it:
that cleanup refunds, publishes MQTT and writes queues, and holding a transaction open
across it would be a worse defect than the one being fixed.

force-cancel reads the exact prior status inside the transaction rather than taking a
set member — it is a rare admin path, and 'you cancelled an IN_TRANSIT delivery' is the
whole reason to capture it."
```

---

### Task 5: Fleet and promo mutations

**Files:**
- Modify: `src/admin/admin.controller.ts` (`createDrone`, `updateDrone`, `createPromo`, `updatePromo`)
- Modify: `src/admin/admin.service.ts` (`createDrone` `:333-347`, `updateDrone` `:357-372`, `createPromo` `:389-414`, `updatePromo` `:437-470`)
- Test: `src/admin/admin.service.spec.ts`

**Interfaces:**
- Consumes: `AdminAuditService.recordWithinTx`, `AuditActor`, `pickAllowed`, `diffAllowed`.
- Produces: all four service methods take `actor: AuditActor` as their first parameter.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('operator audit — fleet and promos', () => {
  const actor = { userId: 'admin-1', role: 'ADMIN' as const };

  it('records the prior airworthiness when an aircraft is grounded', async () => {
    // The question an incident review asks is "was it airworthy before you touched
    // it" — and only a before-value answers that.
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.drone.findUnique.mockResolvedValue({
      id: 'drone-7',
      serial: 'DRV-001',
      airworthy: true,
      status: 'AVAILABLE',
    });
    prisma.drone.update.mockResolvedValue({
      id: 'drone-7',
      serial: 'DRV-001',
      airworthy: false,
      status: 'MAINTENANCE',
    });

    await service.updateDrone(actor, 'drone-7', {
      airworthy: false,
      status: 'MAINTENANCE',
    } as any);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DRONE_UPDATE',
        targetType: 'DRONE',
        targetId: 'drone-7',
        before: { airworthy: true, status: 'AVAILABLE' },
        after: { airworthy: false, status: 'MAINTENANCE' },
      }),
    });
  });

  it('records a promo edit as a diff, not the whole row', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.promoCode.findUnique
      .mockResolvedValueOnce({ id: 'p-1', discountType: 'PERCENT', discountValue: 10, active: true })
      .mockResolvedValue({ id: 'p-1', discountType: 'PERCENT', discountValue: 25, active: true });
    prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });

    await service.updatePromo(actor, 'p-1', { discountValue: 25 } as any);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PROMO_UPDATE',
        before: { discountValue: 10 },
        after: { discountValue: 25 },
      }),
    });
  });

  it('does not record a drone registration that failed on a duplicate serial', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.drone.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002', name: 'PrismaClientKnownRequestError' }),
    );

    await expect(
      service.createDrone(actor, { serial: 'DRV-001' } as any),
    ).rejects.toThrow();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/admin/admin.service.spec.ts -t "fleet and promos"
```

Expected: FAIL — the methods take `(id, dto)`, not `(actor, id, dto)`.

- [ ] **Step 3: Implement all four**

Pattern for a create (`createDrone`, `createPromo`) — wrap the existing write in an interactive transaction, keeping the existing P2002 handling *outside* it so a duplicate-serial conflict is still translated:

```typescript
  async createDrone(actor: AuditActor, dto: CreateDroneDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const drone = await tx.drone.create({ data: { ...dto } });
        await this.audit.recordWithinTx(tx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: AdminAuditAction.DRONE_CREATE,
          targetType: AdminAuditTargetType.DRONE,
          targetId: drone.id,
          args: pickAllowed(AdminAuditAction.DRONE_CREATE, dto as never),
        });
        return drone;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppConflictException('error.admin.drone.serial_exists', {
          serial: dto.serial,
        });
      }
      throw e;
    }
  }
```

Pattern for an update (`updateDrone`, `updatePromo`) — the pre-read already exists in both (`this.getDrone(id)`, `this.getPromo(id)`); capture its result as `before` instead of discarding it:

```typescript
  async updateDrone(actor: AuditActor, id: string, dto: UpdateDroneDto) {
    const before = await this.getDrone(id); // 404 if missing; now also the audit's before
    const drone = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.drone.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.maintenanceDueAt
            ? { maintenanceDueAt: new Date(dto.maintenanceDueAt) }
            : {}),
        },
      });
      const diff = diffAllowed(AdminAuditAction.DRONE_UPDATE, before as never, updated as never);
      await this.audit.recordWithinTx(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AdminAuditAction.DRONE_UPDATE,
        targetType: AdminAuditTargetType.DRONE,
        targetId: id,
        before: diff.before,
        after: diff.after,
      });
      return updated;
    });
    this.logger.log(
      `drone ${drone.serial} updated by ${actor.userId} (status=${drone.status} airworthy=${drone.airworthy})`,
    );
    return drone;
  }
```

`updatePromo` ends with a re-read (`findUnique`) after its `updateMany`; move that read inside the transaction so the `after` diff sees the committed values, and keep the `count === 0` 404 guard before the audit call.

- [ ] **Step 4: Update the controller signatures**

All four gain `@CurrentUser('sub') actorId: string, @CurrentUser('role') actorRole: Role` as leading parameters and pass `{ userId: actorId, role: actorRole }` first, matching Task 4's shape.

- [ ] **Step 5: Run the tests**

```bash
npx jest src/admin
npx tsc -p tsconfig.build.json --noEmit
```

Expected: all pass. Update any existing spec calls to the four methods.

- [ ] **Step 6: Commit**

```bash
git add src/admin/
git commit -m "feat(audit): record fleet and promo edits as before/after diffs

Grounding an aircraft and re-pricing a promo both had zero durable trace — createDrone,
createPromo and updatePromo did not even emit a log line.

The update paths already did a pre-read for their 404; that result is now the audit's
before-value rather than being discarded, so the cost is a diff rather than a query."
```

---

### Task 6: Role, support and drone commands

**Files:**
- Modify: `src/admin/admin.controller.ts` (`setRole`, `issueCommand`)
- Modify: `src/admin/admin-support.controller.ts:48-60`
- Modify: `src/admin/admin.service.ts` (`setRole` `:556-581`, `replyAsAgent` `:101-136`, `setTicketStatus` `:138-149`, `issueDroneCommand` `:378-380`)
- Modify: `src/deliveries/commands/drone-command.service.ts` (`issue` `:73`)
- Test: `src/admin/admin.service.spec.ts`, `src/deliveries/commands/drone-command.service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `setRole(actor, targetId, role)`, `replyAsAgent(actor, ticketId, content)`, `setTicketStatus(actor, ticketId, status)`, `issueDroneCommand(actor, deliveryId, dto)`; `DroneCommandService.issue(adminId: string | null, deliveryId, dto, auditWithinTx?)`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('operator audit — roles, support and commands', () => {
  const actor = { userId: 'admin-1', role: 'ADMIN' as const };
  const agent = { userId: 'agent-1', role: 'AGENT' as const };

  it('records a role change with the prior role', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    prisma.user.update.mockResolvedValue({ id: 'u-2', email: 'a@b.c', role: 'ADMIN' });

    await service.setRole(actor, 'u-2', 'ADMIN' as any);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'USER_ROLE_SET',
        targetType: 'USER',
        targetId: 'u-2',
        before: { role: 'USER' },
        after: { role: 'ADMIN' },
      }),
    });
  });

  it('records the AGENT role of a support reply, not a blanket ADMIN', async () => {
    // The log records agent actions too, and "which hat were they wearing" is part of
    // the record — an agent is not an admin.
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
    prisma.supportChatMessage.create.mockResolvedValue({
      id: 'm-1',
      ticketId: 't-1',
      senderRole: 'AGENT',
      content: 'hello',
      createdAt: new Date(),
    });

    await service.replyAsAgent(agent, 't-1', 'hello');

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorRole: 'AGENT',
        action: 'SUPPORT_TICKET_REPLY',
        targetType: 'SUPPORT_TICKET',
        targetId: 't-1',
        args: { contentLength: 5 },
      }),
    });
  });

  it('never stores the text of a support reply', async () => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.supportTicket.findUnique.mockResolvedValue({ status: 'OPEN' });
    prisma.supportChatMessage.create.mockResolvedValue({
      id: 'm-1', ticketId: 't-1', senderRole: 'AGENT', content: 'x', createdAt: new Date(),
    });

    await service.replyAsAgent(agent, 't-1', 'my card number is 4111 1111 1111 1111');

    const row = JSON.stringify(prisma.adminAuditLog.create.mock.calls[0][0]);
    expect(row).not.toContain('4111');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/admin/admin.service.spec.ts -t "roles, support and commands"
```

Expected: FAIL — signatures do not take an actor.

- [ ] **Step 3: Implement**

`setRole`: keep the existing target read and the last-admin guard outside; wrap the `user.update` plus the audit write in one interactive transaction, using the already-read `target.role` as `before`.

`replyAsAgent`: the method already uses `this.prisma.$transaction([...])` with an **array**. Convert it to the interactive form so the audit write can join it, keeping the same two writes in the same order. `args: { contentLength: content.length }` — never `content`.

`setTicketStatus`: read the current status first (needed for `before`, and it lets the 404 stay a 404), then wrap `updateMany` + audit in a transaction, keeping the `count === 0` guard before the audit call.

`issueDroneCommand` / `DroneCommandService.issue`: `issue` gains an optional `auditWithinTx` callback like Task 3's, wrapping its existing `droneCommand.create` in an interactive transaction. The **automated** caller (`flight-recorder.service.ts:195-201`, `adminId: null`) passes nothing and is unchanged — the platform recalling its own aircraft is not an operator action, and `issuedByUserId: null` already records that.

- [ ] **Step 4: Update the controllers**

`setRole` and `issueCommand` in `admin.controller.ts` already take `@CurrentUser('sub')`; add `@CurrentUser('role')` and pass an `AuditActor`. Both methods in `admin-support.controller.ts` gain both decorators.

- [ ] **Step 5: Run the tests**

```bash
npx jest src/admin src/deliveries
npx tsc -p tsconfig.build.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/admin/ src/deliveries/
git commit -m "feat(audit): record role changes, support actions and issued commands

setRole received an admin id and threw it away into a log line; setTicketStatus did not
receive one at all. Command issue and support reply already persisted an actor in their
own domain tables, and get a row here anyway — the log's value is being the one place
that answers 'what did this operator do', and two actions reachable only by joining
drone_commands and support_chat_messages would defeat that.

A reply records its LENGTH, never its text: the content already lives in
support_chat_messages, and copying customer prose here widens what an audit read exposes
for no forensic gain.

The platform's own automated RETURN_TO_BASE passes no callback and gets no row. It is
not an operator action, and issuedByUserId already records that it was automated."
```

---

### Task 7: The read surface

**Files:**
- Create: `src/admin/audit/dto/audit-query.dto.ts`
- Create: `src/admin/audit/dto/audit-response.dto.ts`
- Modify: `src/admin/audit/admin-audit.service.ts` (add `list`)
- Modify: `src/admin/admin.controller.ts` (add `GET admin/audit`)
- Test: `src/admin/audit/admin-audit.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.adminAuditLog`.
- Produces: `AdminAuditService.list(query: AuditQueryDto): Promise<{ items: AdminAuditLog[]; total: number; page: number; limit: number; from: Date; to: Date }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('AdminAuditService.list', () => {
  it('defaults to the last 30 days when no range is given', async () => {
    // On a partitioned table an unbounded ORDER BY createdAt DESC LIMIT 20 touches
    // EVERY partition. A default window keeps the plan pruned.
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    const result = await service.list({ page: 1, limit: 20, skip: 0 } as any);

    const where = prisma.adminAuditLog.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
    const days =
      (where.createdAt.lte.getTime() - where.createdAt.gte.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // And the caller is told, so a windowed result is not mistaken for all history.
    expect(result.from).toEqual(where.createdAt.gte);
  });

  it('filters by actor, target and action together', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({
      page: 1, limit: 20, skip: 0,
      actorUserId: 'admin-1',
      targetType: 'DRONE',
      targetId: 'drone-7',
      action: 'DRONE_UPDATE',
    } as any);

    expect(prisma.adminAuditLog.findMany.mock.calls[0][0].where).toMatchObject({
      actorUserId: 'admin-1',
      targetType: 'DRONE',
      targetId: 'drone-7',
      action: 'DRONE_UPDATE',
    });
  });

  it('returns newest first', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ page: 1, limit: 20, skip: 0 } as any);

    expect(prisma.adminAuditLog.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
```

The `{ id: 'desc' }` tiebreaker is deliberate: `admin_audit_logs` is partitioned, and paginating on a non-unique sort key across partitions can repeat or skip rows between pages. The backlog already records this exact defect for the delivery list.

- [ ] **Step 2: Run and watch them fail**

```bash
npx jest src/admin/audit -t "AdminAuditService.list"
```

Expected: FAIL — `service.list is not a function`.

- [ ] **Step 3: Write the query DTO**

`src/admin/audit/dto/audit-query.dto.ts` extends `PaginationDto` (`src/common/dto/pagination.dto.ts`) with optional `@IsString() actorUserId`, `@IsEnum(AdminAuditTargetType) targetType`, `@IsString() targetId`, `@IsEnum(AdminAuditAction) action`, and `@IsDateString() from` / `to`.

- [ ] **Step 4: Implement `list`**

Add a `AUDIT_DEFAULT_WINDOW_DAYS = 30` constant to `admin-audit.constants.ts` with a comment naming the partition-pruning reason. `list` builds the `where`, defaults the window, and returns `{ items, total, page, limit, from, to }`. Use `findMany` + `count` — not `findUnique`; this table has no single-column unique `id`.

- [ ] **Step 5: Add the endpoint**

In `admin.controller.ts` (the class already carries `@Roles(Role.ADMIN)`):

```typescript
  // ── Operator audit log ──
  // ADMIN only, deliberately not AGENT: this log records agent actions, so agents
  // reading it is a separation-of-duties problem.
  @Get('audit')
  @ApiOkResponse({ type: AdminPaginatedAuditDto })
  listAudit(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
```

Inject `AdminAuditService` into the controller. Place the route **before** any `@Get(':id')`-style wildcard on the same controller so it is not shadowed — check the ordering after adding.

- [ ] **Step 6: Run the tests**

```bash
npx jest src/admin
npx tsc -p tsconfig.build.json --noEmit
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
```

- [ ] **Step 7: Commit**

```bash
git add src/admin/
git commit -m "feat(audit): GET /admin/audit, windowed by default

Increment 1 shipped the flight recorder with no read surface and recorded that as a
follow-up; a second write-only table in a row is how you discover months later that the
write was broken.

Defaults to the last 30 days because an unbounded ORDER BY createdAt DESC LIMIT 20 on a
partitioned table touches every partition — and the window is returned to the caller so
a windowed result cannot be mistaken for the whole history. Ordered with an id
tiebreaker: paginating on a non-unique sort key across partitions repeats or skips rows.

ADMIN only, not AGENT: the log records agent actions."
```

---

### Task 8: Verification and the log entry

**Files:**
- Modify: `.env.example` (the partition-maintenance section, ~`:154-162`)
- Modify: `prisma/PARTITIONING.md` (the table list at `:9-14` — it is already one table stale, missing `flight_frames`)
- Modify: `AUDIT-LOG.md`, `AUDIT-PLAN.md`
- Create: a mutation-testing script under the session scratchpad

- [ ] **Step 1: Document the per-table retention override in `.env.example`**

Under `PARTITION_RETAIN_MONTHS`, add that it is a global default and that `PARTITIONED_TABLES` carries per-table overrides — `admin_audit_logs` pins 0 so audit history is never dropped.

- [ ] **Step 2: Fix and extend `prisma/PARTITIONING.md`**

Add both `flight_frames` (pre-existing omission) and `admin_audit_logs` to the table list, with their partition keys.

- [ ] **Step 3: Run the full verification sweep**

```bash
npx jest 2>&1 | tail -5
npx tsc -p tsconfig.build.json --noEmit && echo "tsc clean"
npx eslint "{src,apps,libs,test}/**/*.ts" 2>&1 | tail -2
set -a; . ./.env; set +a; npm run prisma:drift-check
```

Expected: all suites pass with more tests than the 904 baseline; tsc clean; lint exactly `98 problems (0 errors, 98 warnings)`; drift-check `No difference detected`.

- [ ] **Step 4: Mutation-test the new code**

Write a script following the pattern in this session's scratchpad (`mutate.py`): for each mutation, apply a single string replacement, run the one test that should catch it, confirm it fails, restore. Every mutation must COMPILE — a mutation caught by the typechecker proves nothing about the tests.

At minimum, these must all be caught:

1. `recordWithinTx` uses its own client instead of `tx`
2. `recordWithinTx` swallows the write error instead of propagating
3. `pickAllowed` returns the whole source object (allowlist bypassed)
4. `pickAllowed` returns `{}` instead of `undefined` when nothing survives
5. `diffAllowed` includes unchanged fields
6. `failExceptional` calls the audit callback when the CAS matched nothing
7. `failExceptional` calls the callback outside the transaction
8. `adminForceCancel` records the wrong `firedFrom` (the post-cancel status)
9. `refund` records before the single-winner gate rather than after
10. `updateDrone` records `after` as `before`
11. `replyAsAgent` records `content` instead of `contentLength`
12. `issue`'s automated path writes an audit row
13. `list` drops the default 30-day window
14. `list` drops the `id` tiebreaker from `orderBy`
15. `PARTITIONED_TABLES` retention override uses `||` instead of `??` (so an explicit 0 falls through to the global)

Mutation 15 is the important one — `retainMonths ?? PARTITION_RETAIN_MONTHS` versus `||` is the entire difference between "never drop audit history" and "drop it whenever the global is set".

- [ ] **Step 5: Verify partitioning against the live catalog one final time**

```bash
set -a; . ./.env; set +a; U="${DATABASE_URL%%\?*}"
psql "$U" -At -c "SELECT pg_get_partkeydef('admin_audit_logs'::regclass);"
psql "$U" -At -c "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='admin_audit_logs' ORDER BY 1;"
```

- [ ] **Step 6: Append the increment entry to `AUDIT-LOG.md`**

Follow the existing entries' structure exactly: `What changed`, `Verification` (a fenced block with real counts), `Decisions made`, `Deviations from the plan`, `Left undone / follow-ups`, `Next`. Record the real numbers, not the plan's expectations. Known follow-ups to list:

- No admin UI for the audit log — that is 12.5.
- The `before` on `DELIVERY_FAIL` is the first status of the matching set, not a read-back exact value (unlike force-cancel, which reads). Note why: `failExceptional` is on the watchdog's hot path and does not deserve an extra read per reap.
- No alerting on audit events.
- Retention is pinned off for this table; if the table ever needs bounding, that is a deliberate decision with its own migration.

- [ ] **Step 7: Update the Phase 12 row in `AUDIT-PLAN.md` §2**

- [ ] **Step 8: Commit and merge**

```bash
git add -A
git commit -m "docs(audit): log phase 12 increment 4 (operator audit log)"
git checkout main
git merge --no-ff fix/audit-phase-12-operator-audit-log
```

---

## Self-review notes

- **Spec coverage:** data model → Task 1; write path + allowlist → Task 2; `failExceptional` extension point → Task 3; all 11 routes → Tasks 4 (3), 5 (4), 6 (4); read surface → Task 7; retention override → Task 1 + Task 8 docs; testing → each task plus Task 8's mutation set.
- **The 11 routes, accounted for:** force-cancel, fail, refund (T4); createDrone, updateDrone, createPromo, updatePromo (T5); setRole, replyAsAgent, setTicketStatus, issueDroneCommand (T6).
- **Naming consistency:** `recordWithinTx` / `AuditActor` / `pickAllowed` / `diffAllowed` / `auditWithinTx` / `firedFrom` / `retainMonths` are used identically in every task that references them.
- **Known sequencing constraint:** Task 3 must land before Task 4 (`adminFail` needs the callback), and Task 1 before everything (the mock delegate and the model).

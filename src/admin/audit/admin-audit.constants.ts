import { AdminAuditAction } from '@prisma/client';

/**
 * Default lookback for GET /admin/audit when the caller gives no `from`/`to`.
 *
 * `admin_audit_logs` is partitioned by `createdAt`. An unbounded
 * `ORDER BY createdAt DESC LIMIT n` has to prove no newer row exists in ANY
 * partition, so it touches every one of them. Windowing the query keeps the
 * planner pruned to the partitions that can possibly match.
 */
export const AUDIT_DEFAULT_WINDOW_DAYS = 30;

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
  DRONE_CREATE: [
    'serial',
    'model',
    // `CreateDroneDto` accepts it and DRONE_UPDATE already allowlists it; leaving it
    // off here meant the firmware an aircraft was REGISTERED with was the one value
    // in its history nothing recorded.
    'firmwareVersion',
    'maxPayloadKg',
    'rangeKm',
    'homeBaseLat',
    'homeBaseLng',
  ],
  DRONE_UPDATE: [
    'status',
    'airworthy',
    'model',
    'firmwareVersion',
    'maxPayloadKg',
    'rangeKm',
    /**
     * Hand-editing an airframe's charge is the single most consequential drone edit
     * an operator can make — `flight-feasibility.ts` derates usable range by it and
     * refuses dispatch below `MIN_DISPATCH_BATTERY_PERCENT`, so raising it makes an
     * aircraft look dispatchable on a mission it cannot complete. It was also the
     * only `UpdateDroneDto` field with no allowlist entry, which meant a battery-only
     * edit wrote `before: null, after: null` — a row that reads as "an operator
     * touched this drone and changed nothing". Absence would have been better; that
     * was worse.
     *
     * COST, accepted: `updateDrone` reads its `before` OUTSIDE the transaction (a
     * documented, deliberate trade), and telemetry writes this column on every
     * heartbeat for a drone with an active delivery
     * (`flight-recorder.service.ts:114`). So an operator edit to an IN-FLIGHT drone
     * can pick up a concurrent battery drift and attribute it to the operator. The
     * pre-existing staleness window is unchanged; this field just makes it visible
     * more often. Recording nothing about a deliberate battery edit is the worse of
     * the two failures.
     */
    'batteryPercent',
    'maintenanceDueAt',
    'homeBaseLat',
    'homeBaseLng',
  ],
  PROMO_CREATE: [
    'code',
    'discountType',
    'discountValue',
    // The three below were missing while PROMO_UPDATE allowlisted two of them, so a
    // promo's created shape was recorded less completely than any later edit to it.
    // `maxDiscount` is the one that matters most: it caps a PERCENT promo's dollar
    // exposure, and a promo created uncapped at 90% recorded `discountValue: 90` and
    // nothing at all about the absent cap.
    'minOrderTotal',
    'maxDiscount',
    'startsAt',
    'maxRedemptions',
    'endsAt',
  ],
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

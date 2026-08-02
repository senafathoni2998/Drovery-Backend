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
  DRONE_CREATE: [
    'serial',
    'model',
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
    'maintenanceDueAt',
    'homeBaseLat',
    'homeBaseLng',
  ],
  PROMO_CREATE: [
    'code',
    'discountType',
    'discountValue',
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

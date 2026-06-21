/**
 * Helpers for deferred ("scheduled") deliveries: turning a picked pickup date +
 * time into a concrete UTC instant in the service timezone, and deciding whether
 * a delivery is far enough in the future to defer.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Below this lead time we just start now — a "scheduled in 30s" delivery isn't
 * worth a deferred job, and it absorbs small clock skew between API and worker. */
export const SCHEDULE_THRESHOLD_MS = 60_000;

/** Upper bound on how far out a pickup may be scheduled (bounds the BullMQ delay
 * and keeps one-off scheduling distinct from recurring, which is a later item). */
export const MAX_SCHEDULE_DAYS = 60;

export function serviceTz(): string {
  return process.env.NOTIFICATIONS_TZ ?? 'Asia/Jakarta';
}

/** "Now" as a pickup date + time in the service timezone (for immediate orders).
 * en-CA renders the date as YYYY-MM-DD; hour12:false gives HH:MM. */
export function nowInServiceTz(tz: string = serviceTz()): {
  date: string;
  time: string;
} {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return { date, time };
}

/** Milliseconds that `tz` is ahead of UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds render midnight as 24
  const asTz = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asTz - date.getTime();
}

/** Interpret wall-clock components in `tz` as a UTC instant. */
export function zonedWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  tz: string,
): Date {
  // Treat the wall clock as if it were UTC, then subtract tz's offset at that
  // instant. Exact for fixed-offset zones (WIB has no DST); near a DST jump it
  // can be off by the transition hour — acceptable for the WIB service area.
  const asUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offset = tzOffsetMs(new Date(asUtc), tz);
  return new Date(asUtc - offset);
}

/**
 * Resolves the UTC instant for a pickup from the picked calendar date
 * (`YYYY-MM-DD`, leading chars of `pickupDate`) + `HH:MM` time, interpreted in
 * the service timezone. Returns `null` when either part is malformed (the caller
 * then treats the delivery as immediate — never a hard failure on parse).
 */
export function computeScheduledFor(
  pickupDate: string,
  pickupTime: string,
  tz: string = serviceTz(),
): Date | null {
  const date = ISO_DATE.exec((pickupDate ?? '').slice(0, 10));
  const time = HH_MM.exec(pickupTime ?? '');
  if (!date || !time) return null;
  try {
    return zonedWallClockToUtc(
      Number(date[1]),
      Number(date[2]),
      Number(date[3]),
      Number(time[1]),
      Number(time[2]),
      tz,
    );
  } catch {
    // Invalid tz string / Intl failure → can't schedule; treat as immediate.
    return null;
  }
}

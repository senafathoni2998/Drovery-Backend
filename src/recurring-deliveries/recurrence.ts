import {
  serviceTz,
  zonedWallClockToUtc,
} from '../deliveries/delivery-schedule';

export type RecurrenceFreq = 'DAILY' | 'WEEKLY';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  daysOfWeek: number[]; // 0=Sun..6=Sat (service-tz weekday); WEEKLY only
  timeOfDay: string; // "HH:MM"
  startDate: Date;
  endDate: Date | null;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// 14 = the safe ceiling: WEEKLY may need up to 7 days to hit the next matching
// weekday, and "today's time already passed" can push that into next week.
const MAX_DAY_PROBE = 14;

/** The service-tz calendar date (y, m, d) of a UTC instant. */
function tzCalendarDate(
  instant: Date,
  tz: string,
): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day') };
}

/** First instant (00:00 in `tz`) of the service-tz calendar day `instant` falls on. */
function dayStartUtc(instant: Date, tz: string): number {
  const { y, mo, d } = tzCalendarDate(instant, tz);
  return zonedWallClockToUtc(y, mo, d, 0, 0, tz).getTime();
}

/** First instant of the NEXT service-tz calendar day after `instant`'s day. */
function nextDayStartUtc(instant: Date, tz: string): number {
  const { y, mo, d } = tzCalendarDate(instant, tz);
  // Date.UTC inside zonedWallClockToUtc normalizes the day overflow.
  return zonedWallClockToUtc(y, mo, d + 1, 0, 0, tz).getTime();
}

/**
 * The earliest occurrence UTC instant STRICTLY AFTER `after` (and never before
 * the rule's first valid day), honoring daysOfWeek + timeOfDay in the service
 * timezone and the inclusive `endDate`. Returns null when the recurrence is
 * exhausted (past endDate) or the rule can't produce a day.
 *
 * Weekday/date stepping uses noon-anchored UTC dates: a date built at 12:00 UTC
 * is far from any midnight boundary, so its UTC getters (getUTCDay / y-m-d) equal
 * the intended service-tz calendar day for a fixed-offset zone — avoiding the
 * classic bug where a late-evening local time falls on the next UTC day and
 * getUTCDay() reads the wrong weekday.
 */
export function computeNextOccurrence(
  rule: RecurrenceRule,
  after: Date,
  tz: string = serviceTz(),
): Date | null {
  const time = HH_MM.exec(rule.timeOfDay);
  if (!time) return null;
  const hh = Number(time[1]);
  const mm = Number(time[2]);

  const days = rule.freq === 'DAILY' ? ALL_DAYS : rule.daysOfWeek;
  if (!days || days.length === 0) return null;

  // startDate/endDate are CALENDAR DATES interpreted in the service tz (a
  // date-only string like "2026-06-30" parses to UTC midnight = 07:00 WIB, which
  // is NOT the start of that WIB day — so anchor both bounds to the WIB day).
  // floor = the instant just before 00:00 (service tz) of startDate's day, so an
  // early-morning occurrence on the first day still qualifies. `- 1` keeps strict-`>`.
  const floor = Math.max(after.getTime(), dayStartUtc(rule.startDate, tz) - 1);
  // endDate is inclusive THROUGH its whole service-tz day: anything on or after
  // 00:00 of the day AFTER endDate's day is past the recurrence.
  const endExclusive = rule.endDate
    ? nextDayStartUtc(rule.endDate, tz)
    : Number.POSITIVE_INFINITY;

  // Service-tz "today" relative to the floor.
  const base = tzCalendarDate(new Date(floor), tz);

  for (let offset = 0; offset < MAX_DAY_PROBE; offset++) {
    // Noon-anchored UTC date `offset` days after base → safe weekday + y/m/d.
    const noon = new Date(
      Date.UTC(base.y, base.mo - 1, base.d + offset, 12, 0, 0),
    );
    const weekday = noon.getUTCDay();
    if (!days.includes(weekday)) continue;

    const candidate = zonedWallClockToUtc(
      noon.getUTCFullYear(),
      noon.getUTCMonth() + 1,
      noon.getUTCDate(),
      hh,
      mm,
      tz,
    );
    if (candidate.getTime() <= floor) continue; // strictly after

    if (candidate.getTime() >= endExclusive) {
      return null; // past endDate's (inclusive) service-tz day → exhausted
    }
    return candidate;
  }
  return null;
}

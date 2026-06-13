import { serviceTz, zonedWallClockToUtc } from '../deliveries/delivery-schedule';

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

  // Probe strictly after `after`, and never earlier than the first instant the
  // rule is allowed to fire (startDate). `- 1` keeps the comparison strict-`>`.
  const floor = Math.max(after.getTime(), rule.startDate.getTime() - 1);

  // Service-tz "today" relative to the floor.
  const base = tzCalendarDate(new Date(floor), tz);

  for (let offset = 0; offset < MAX_DAY_PROBE; offset++) {
    // Noon-anchored UTC date `offset` days after base → safe weekday + y/m/d.
    const noon = new Date(Date.UTC(base.y, base.mo - 1, base.d + offset, 12, 0, 0));
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

    if (rule.endDate && candidate.getTime() > rule.endDate.getTime()) {
      return null; // exhausted (endDate inclusive)
    }
    return candidate;
  }
  return null;
}

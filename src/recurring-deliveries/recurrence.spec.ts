import { RecurrenceRule, computeNextOccurrence } from './recurrence';

// All cases use Asia/Jakarta (WIB, UTC+7, no DST). Reminder: WIB = UTC+7, so a
// WIB wall-clock instant is EARLIER in UTC — 08:00 WIB = 01:00Z, and an early
// morning like 02:00 WIB = the PREVIOUS UTC day at 19:00Z (the day-boundary case).
const TZ = 'Asia/Jakarta';

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  freq: 'DAILY',
  daysOfWeek: [],
  timeOfDay: '08:00',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: null,
  ...over,
});

describe('computeNextOccurrence', () => {
  it('DAILY: rolls to tomorrow when today’s time already passed', () => {
    // after = 2026-06-15 10:00 WIB (03:00Z); 08:00 WIB today already passed.
    const next = computeNextOccurrence(rule({}), new Date('2026-06-15T03:00:00.000Z'), TZ);
    expect(next?.toISOString()).toBe('2026-06-16T01:00:00.000Z'); // 16th 08:00 WIB
  });

  it('DAILY: fires later the same day when the time is still ahead', () => {
    // after = 2026-06-15 06:00 WIB (2026-06-14T23:00Z); 08:00 WIB today is ahead.
    const next = computeNextOccurrence(rule({}), new Date('2026-06-14T23:00:00.000Z'), TZ);
    expect(next?.toISOString()).toBe('2026-06-15T01:00:00.000Z'); // 15th 08:00 WIB
  });

  it('WEEKLY: picks the next matching weekday', () => {
    // Mon/Wed/Fri at 09:00 WIB (02:00Z). after = Tue 2026-06-16 12:00 WIB.
    const r = rule({ freq: 'WEEKLY', daysOfWeek: [1, 3, 5], timeOfDay: '09:00' });
    const next = computeNextOccurrence(r, new Date('2026-06-16T05:00:00.000Z'), TZ);
    expect(next?.toISOString()).toBe('2026-06-17T02:00:00.000Z'); // Wed 09:00 WIB
  });

  it('WEEKLY: wraps to next week when this week’s days are exhausted', () => {
    // after = Fri 2026-06-19 10:00 WIB (after the 09:00 fire) → next is Mon.
    const r = rule({ freq: 'WEEKLY', daysOfWeek: [1, 3, 5], timeOfDay: '09:00' });
    const next = computeNextOccurrence(r, new Date('2026-06-19T03:00:00.000Z'), TZ);
    expect(next?.toISOString()).toBe('2026-06-22T02:00:00.000Z'); // Mon 09:00 WIB
  });

  it('WEEKLY: reads the weekday from the SERVICE-TZ date, not the UTC date', () => {
    // Saturday 02:00 WIB lands on the PREVIOUS UTC day (Friday 19:00Z). A
    // getUTCDay() implementation would read Friday and skip this Saturday-only
    // schedule; noon-anchoring reads Saturday correctly.
    const r = rule({ freq: 'WEEKLY', daysOfWeek: [6], timeOfDay: '02:00' });
    const next = computeNextOccurrence(r, new Date('2026-06-18T05:00:00.000Z'), TZ);
    expect(next?.toISOString()).toBe('2026-06-19T19:00:00.000Z'); // Sat 2026-06-20 02:00 WIB
  });

  it('is strictly after its own occurrence (no same-instant repeat)', () => {
    const r = rule({});
    const first = computeNextOccurrence(r, new Date('2026-06-15T03:00:00.000Z'), TZ)!;
    const second = computeNextOccurrence(r, first, TZ);
    expect(second?.toISOString()).toBe('2026-06-17T01:00:00.000Z');
    expect(second!.getTime()).toBeGreaterThan(first.getTime());
  });

  it('treats endDate as inclusive', () => {
    const r = rule({ endDate: new Date('2026-06-16T01:00:00.000Z') }); // exactly an occurrence
    // An occurrence AT endDate is allowed.
    expect(
      computeNextOccurrence(r, new Date('2026-06-15T03:00:00.000Z'), TZ)?.toISOString(),
    ).toBe('2026-06-16T01:00:00.000Z');
    // The next one (past endDate) is null.
    expect(
      computeNextOccurrence(r, new Date('2026-06-16T01:00:00.000Z'), TZ),
    ).toBeNull();
  });

  it('returns null when the recurrence has already ended', () => {
    const r = rule({ endDate: new Date('2020-01-01T00:00:00.000Z') });
    expect(computeNextOccurrence(r, new Date('2026-06-15T03:00:00.000Z'), TZ)).toBeNull();
  });

  it('returns null for an empty WEEKLY day set or a malformed time', () => {
    expect(computeNextOccurrence(rule({ freq: 'WEEKLY', daysOfWeek: [] }), new Date(), TZ)).toBeNull();
    expect(computeNextOccurrence(rule({ timeOfDay: '24:00' }), new Date(), TZ)).toBeNull();
  });
});

import {
  PICKUP_DATE_RE,
  PICKUP_TIME_RE,
  computeScheduledFor,
  isValidPickupDate,
} from './delivery-schedule';

describe('computeScheduledFor', () => {
  const TZ = 'Asia/Jakarta'; // WIB, UTC+7, no DST

  it('combines the picked date + HH:MM as a WIB wall clock → correct UTC instant', () => {
    // 2026-06-20 14:00 WIB === 07:00 UTC.
    const instant = computeScheduledFor('2026-06-20', '14:00', TZ);
    expect(instant?.toISOString()).toBe('2026-06-20T07:00:00.000Z');
  });

  it('handles a late-evening time that stays on the same UTC day', () => {
    // 2026-06-20 23:59 WIB === 16:59 UTC (same calendar day).
    const instant = computeScheduledFor('2026-06-20', '23:59', TZ);
    expect(instant?.toISOString()).toBe('2026-06-20T16:59:00.000Z');
  });

  it('handles an early-morning time that lands on the previous UTC day', () => {
    // 2026-06-20 06:00 WIB === 2026-06-19 23:00 UTC.
    const instant = computeScheduledFor('2026-06-20', '06:00', TZ);
    expect(instant?.toISOString()).toBe('2026-06-19T23:00:00.000Z');
  });

  it('takes the leading YYYY-MM-DD from a full ISO pickupDate', () => {
    const instant = computeScheduledFor(
      '2026-06-20T00:00:00.000Z',
      '09:30',
      TZ,
    );
    expect(instant?.toISOString()).toBe('2026-06-20T02:30:00.000Z');
  });

  it('respects a different (fixed-offset) timezone', () => {
    // 14:00 UTC === 14:00 UTC.
    expect(
      computeScheduledFor('2026-06-20', '14:00', 'UTC')?.toISOString(),
    ).toBe('2026-06-20T14:00:00.000Z');
  });

  it.each([
    ['', '14:00'],
    ['2026-06-20', ''],
    ['not-a-date', '14:00'],
    ['2026-06-20', '24:00'],
    ['2026-06-20', '14:60'],
    ['2026-06-20', '9:00'], // not zero-padded → rejected
    ['2026-06-20', '14:3a'],
  ])('returns null for malformed input (%s, %s)', (date, time) => {
    expect(computeScheduledFor(date, time, TZ)).toBeNull();
  });
});

describe('PICKUP_DATE_RE / PICKUP_TIME_RE — the DTO guards', () => {
  // These exist so a format mismatch 400s at the boundary. Without them
  // computeScheduledFor returns null and create() reads that as "dispatch now":
  // a real drone launches, the response is still 201, and the stored pickupDate
  // even looks right because `new Date("Jul 30, 2026")` happens to parse.
  const acceptsDate = (v: string) => PICKUP_DATE_RE.test(v);
  const acceptsTime = (v: string) => PICKUP_TIME_RE.test(v);

  it('accepts exactly what computeScheduledFor can parse', () => {
    expect(acceptsDate('2026-07-30')).toBe(true);
    expect(acceptsTime('09:30')).toBe(true);
    expect(
      computeScheduledFor('2026-07-30', '09:30', 'Asia/Jakarta'),
    ).not.toBeNull();
  });

  it('rejects the exact strings the mobile app used to send', () => {
    expect(acceptsDate('Jul 30, 2026')).toBe(false);
    expect(acceptsTime('09:30 AM')).toBe(false);
    // …and those are precisely the ones the parser silently turns into "now".
    expect(
      computeScheduledFor('Jul 30, 2026', '09:30 AM', 'Asia/Jakarta'),
    ).toBeNull();
  });

  it('rejects a partial or over-long date that ISO_DATE alone would tolerate', () => {
    // ISO_DATE is unanchored at the end because it runs on `.slice(0, 10)`; the DTO
    // guard validates the whole string, so a full ISO instant must not slip through
    // as if it were a plain calendar date.
    expect(acceptsDate('2026-07-30T09:30:00.000Z')).toBe(false);
    expect(acceptsDate('2026-7-30')).toBe(false);
    expect(acceptsDate('')).toBe(false);
  });

  it('rejects out-of-range clock values', () => {
    expect(acceptsTime('24:00')).toBe(false);
    expect(acceptsTime('09:60')).toBe(false);
    expect(acceptsTime('9:30')).toBe(false);
  });
});

describe('isValidPickupDate — the calendar guard the regex cannot express', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isValidPickupDate('2026-07-30')).toBe(true);
    expect(isValidPickupDate('2024-02-29')).toBe(true); // 2024 is a leap year
  });

  it('rejects a day that does not exist in that month', () => {
    // Date.UTC rolls these forward, so without the guard the delivery would be
    // scheduled for a day the caller never asked for.
    expect(isValidPickupDate('2026-02-31')).toBe(false);
    expect(isValidPickupDate('2026-04-31')).toBe(false);
    expect(isValidPickupDate('2025-02-29')).toBe(false); // 2025 is NOT a leap year
  });

  it('rejects out-of-range components the shape regex lets through', () => {
    for (const bad of [
      '2026-13-45',
      '2026-00-10',
      '2026-07-00',
      '2026-99-99',
    ]) {
      expect(PICKUP_DATE_RE.test(bad)).toBe(true); // shape passes…
      expect(isValidPickupDate(bad)).toBe(false); // …calendar does not
    }
  });

  it('still rejects everything the shape regex rejects', () => {
    for (const bad of [
      'Jul 30, 2026',
      '2026-7-30',
      '',
      '2026-07-30T09:00:00Z',
    ]) {
      expect(isValidPickupDate(bad)).toBe(false);
    }
  });
});

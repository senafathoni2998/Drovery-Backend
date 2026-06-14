import { computeScheduledFor } from './delivery-schedule';

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

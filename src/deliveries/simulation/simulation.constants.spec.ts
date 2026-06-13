import { DeliveryStatus } from '@prisma/client';

import { STATUS_ORDER, statusesBefore } from './simulation.constants';

/**
 * Tripwire for the highest-risk invariant of delivery exceptions (P3 #16): the
 * monotonic forward CAS is LINEAR. The exception statuses (RETURNING /
 * DELIVERY_FAILED / RETURNED_TO_BASE) and CANCELED/SCHEDULED MUST stay OUT of
 * STATUS_ORDER — otherwise the happy-path CAS could skip a live delivery sideways
 * into an exception state, and statusesBefore(DELIVERED) could include RETURNING
 * (auto-delivering a returning drone). If someone appends one, this test fails.
 */
describe('STATUS_ORDER invariants', () => {
  it('is exactly the 7 happy-path statuses, in order', () => {
    expect(STATUS_ORDER).toEqual([
      DeliveryStatus.PENDING,
      DeliveryStatus.CONFIRMED,
      DeliveryStatus.DRONE_ASSIGNED,
      DeliveryStatus.PICKUP_IN_PROGRESS,
      DeliveryStatus.IN_TRANSIT,
      DeliveryStatus.AWAITING_HANDOFF,
      DeliveryStatus.DELIVERED,
    ]);
  });

  it('excludes every branch/terminal status', () => {
    for (const s of [
      DeliveryStatus.SCHEDULED,
      DeliveryStatus.CANCELED,
      DeliveryStatus.RETURNING,
      DeliveryStatus.DELIVERY_FAILED,
      DeliveryStatus.RETURNED_TO_BASE,
    ]) {
      expect(STATUS_ORDER).not.toContain(s);
    }
  });

  it('statusesBefore() of any branch/terminal status is empty (the forward CAS can never enter it)', () => {
    for (const s of [
      DeliveryStatus.SCHEDULED,
      DeliveryStatus.CANCELED,
      DeliveryStatus.RETURNING,
      DeliveryStatus.DELIVERY_FAILED,
      DeliveryStatus.RETURNED_TO_BASE,
    ]) {
      expect(statusesBefore(s)).toEqual([]);
    }
  });

  it('does not include RETURNING among the states DELIVERED can advance from', () => {
    expect(statusesBefore(DeliveryStatus.DELIVERED)).not.toContain(
      DeliveryStatus.RETURNING,
    );
  });
});

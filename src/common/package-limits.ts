import { MAX_WEIGHT_KG } from './constants';
import { AppBadRequestException } from './exceptions/app-exception';

/**
 * Enforces the per-size payload cap a drone can physically lift.
 *
 * `MAX_WEIGHT_KG` existed since the beginning with ZERO call sites: the only
 * enforcement was a react-hook-form validator in the mobile app, so any direct
 * API call could book a 500 kg "Small" package. Critically, `create()` is also
 * reached by reorder, favorite-order and the recurring materializer, all of which
 * hand-build a `CreateDeliveryDto` in-process and therefore never pass through the
 * ValidationPipe — a DTO decorator alone would not close the hole. Call this from
 * the SERVICE so every path is covered.
 *
 * An unknown size is not this function's error to raise: `@IsIn(PACKAGE_SIZES)` on
 * the DTO owns that, and the materializer replays a size that was already validated.
 */
export function assertWeightWithinCap(
  packageSize: string,
  packageWeight: number,
): void {
  const maxKg = MAX_WEIGHT_KG[packageSize];
  if (maxKg == null) return;

  if (packageWeight > maxKg) {
    throw new AppBadRequestException(
      'error.delivery.package.weight_exceeds_cap',
      { size: packageSize, maxKg, weightKg: packageWeight },
    );
  }
}

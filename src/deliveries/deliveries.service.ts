import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  Prisma,
  TrackingSource,
} from '@prisma/client';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import {
  AppBadRequestException,
  AppConflictException,
  AppHttpException,
  AppNotFoundException,
  AppUnauthorizedException,
  AppUnprocessableEntityException,
} from '../common/exceptions/app-exception';
import { haversineKm } from '../common/geo-distance';
import { assertWeightWithinCap } from '../common/package-limits';
import { DispatchService, ReleaseOutcome } from '../dispatch/dispatch.service';
import { GeoService } from '../geo/geo.service';
import { I18nService } from '../i18n/i18n.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { PromoService } from '../promo/promo.service';
import { WalletService } from '../wallet/wallet.service';
import { OutboxService } from '../outbox/outbox.service';
import {
  OUTBOX_EVENT_REFERRAL_REWARD,
  OUTBOX_REFERRAL_ENABLED,
} from '../outbox/outbox.constants';
import { ProofService } from './proof/proof.service';
import { SimulationService } from './simulation/simulation.service';
import { TrackingPublisher } from './tracking/tracking.publisher';
import { TrackingHotStore } from './tracking/tracking-hot-store';
import {
  FAILABLE_STATUSES,
  RETURNABLE_STATUSES,
  TERMINAL_STATUSES,
  exceptionMessageKey,
  isDroneFaultReason,
} from './delivery-exceptions';
import {
  MAX_SCHEDULE_DAYS,
  SCHEDULE_THRESHOLD_MS,
  computeScheduledFor,
  isValidPickupDate,
  nowInServiceTz,
} from './delivery-schedule';
import { CreateDeliveryDto, DeliveryQueryDto } from './dto';

const HANDOFF_LOCKED = 423; // @nestjs/common has no LockedException / HttpStatus.LOCKED

interface ResolvedCoords {
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
}

const ACTIVE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.CONFIRMED,
  DeliveryStatus.DRONE_ASSIGNED,
  DeliveryStatus.PICKUP_IN_PROGRESS,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.AWAITING_HANDOFF,
  // The drone is airborne flying the package home — still live on the map, so it
  // stays in the active/current lists (it's transient, not a terminal).
  DeliveryStatus.RETURNING,
];

const MAX_HANDOFF_ATTEMPTS = 5;
const MAX_TRACKING_ID_TRIES = 5;

// Phase-3 §2 Stage-A2: the debit-first saga. When ON, create() runs the AUTHORITATIVE
// promo-redeem + wallet-debit in their OWN single-shard (user-shard) transactions BEFORE
// the delivery's (delivery-shard) tx — so no single $transaction co-commits user-rooted
// balance state with the delivery row, which is what a ShardRouter needs to flip
// shardCount>1. Orphaned reservations (a failure between reserve and delivery-create) are
// reversed by the EXISTING idempotent compensations (releaseForDelivery/refundForDelivery).
// Default OFF = today's single co-committing $transaction, byte-identical.
//
// ONE KNOWN EXCEPTION, taken deliberately: the operator audit row. When an admin route
// supplies an `auditWithinTx` callback, an actor-rooted AdminAuditLog co-commits with the
// delivery-rooted CAS — in `adminForceCancel`, in `failExceptional`, and in
// `DroneCommandService.issue`. The reasoning and the cost it accepts are written once, in
// the block comment above `adminForceCancel`'s `$transaction`. This pointer exists only
// so the rule above is not read as unbroken. (Deliberately no line numbers: adding these
// six lines moved every one of them.)
const DELIVERY_DEBIT_FIRST = process.env.DELIVERY_DEBIT_FIRST === 'true';

const CANCELABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.SCHEDULED,
  DeliveryStatus.PENDING,
  DeliveryStatus.CONFIRMED,
];

const MAX_SCHEDULE_MS = MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * How far a caller-supplied coordinate may sit from the geocode of the address it
 * claims to describe before we reject the pair outright. Generous enough to absorb
 * the difference between a rooftop pin and the street centroid a geocoder returns,
 * tight enough that "same address, wildly different point" is a 400.
 */
const MAX_COORD_DEVIATION_KM = 1;

/**
 * What happens to the claimed airframe when a delivery terminates.
 *
 * `STILL_AIRBORNE` is the one that is easy to get wrong, and was: a delivery can
 * reach a terminal-for-the-customer state (RETURNING) while the aircraft is still
 * in the air. Releasing it there hands a flying drone to the next booking.
 */
type AircraftDisposition = ReleaseOutcome | 'STILL_AIRBORNE';

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationService: SimulationService,
    private readonly geoService: GeoService,
    private readonly pricingService: PricingService,
    private readonly paymentsService: PaymentsService,
    private readonly proofService: ProofService,
    private readonly serviceabilityService: ServiceabilityService,
    private readonly promoService: PromoService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly trackingPublisher: TrackingPublisher,
    private readonly i18n: I18nService,
    private readonly dispatchService: DispatchService,
    // Optional so the many specs that build DeliveriesService don't all need it; the
    // app always provides it (DeliveriesModule). Freshens the poll under the hot-store.
    @Optional() private readonly trackingHotStore?: TrackingHotStore,
    // Optional (same reason). When present + DELIVERY_OUTBOX_REFERRAL=true, the referral
    // reward is enqueued as a transactional-outbox event instead of granted inline (§2
    // Phase-3 DB-write-shard unblock). Absent or flag-off → today's inline grant.
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /** Route the referral reward through the transactional outbox (when the flag is on AND
   * the service is wired) vs the inline in-tx grant. Extracted so the producer fork in
   * create() is unit-testable without re-importing the import-time env const. */
  private referralOutboxEnabled(): boolean {
    return OUTBOX_REFERRAL_ENABLED && !!this.outbox;
  }

  /** Run the charge-gating promo-redeem + wallet-debit as authoritative pre-delivery
   * reservations (their own single-shard txns) instead of inside the delivery tx.
   * Extracted so the reorder is unit-testable without re-importing the import-time const. */
  private debitFirstEnabled(): boolean {
    return DELIVERY_DEBIT_FIRST;
  }

  /** Reverse any orphaned charge-gating reservations (debit-first saga). Both are idempotent
   * and keyed by deliveryId, and each no-ops when its row is absent, so calling both
   * unconditionally is safe regardless of which reservations actually ran. */
  private async compensateReservations(deliveryId: string): Promise<void> {
    await this.promoService
      .releaseForDelivery(deliveryId)
      .catch((e) =>
        this.logger.warn(
          `promo release (compensation) failed for ${deliveryId}: ${(e as Error).message}`,
        ),
      );
    await this.walletService
      .refundForDelivery(deliveryId)
      .catch((e) =>
        this.logger.warn(
          `credit refund (compensation) failed for ${deliveryId}: ${(e as Error).message}`,
        ),
      );
  }

  /**
   * Undo a dispatch claim when the create that made it never committed.
   *
   * No-op for a SIMULATED delivery (nothing was claimed). Best-effort: it runs on
   * a path that is already throwing, and turning a create failure into a DIFFERENT
   * failure would hide the real one.
   */
  private async releaseClaimedAircraft(
    droneId: string | null,
    deliveryId: string,
  ): Promise<void> {
    if (!droneId) return;
    await this.dispatchService.release(deliveryId, 'RETURN_TO_FLEET');
  }

  async create(userId: string, dto: CreateDeliveryDto) {
    // A drone can only lift so much. Reject an over-capacity package before any
    // geocode / pricing / DB / queue work. Enforced HERE and not only on the DTO
    // because reorder, favorite-order and the recurring materializer all call
    // create() with a hand-built DTO that never sees the ValidationPipe.
    assertWeightWithinCap(dto.packageSize, dto.packageWeight);

    // The DTO's @Matches only checks SHAPE. "2026-02-31" and "2026-00-10" match it,
    // and Date.UTC rolls them over rather than rejecting — the first would schedule a
    // flight for a day the caller never asked for, the second reaches Prisma as an
    // Invalid Date and 500s. Checked here so reorder, favorite-order and the recurring
    // materializer are covered too; none of them pass through the ValidationPipe.
    if (!isValidPickupDate(dto.pickupDate)) {
      throw new AppBadRequestException('error.delivery.schedule.invalid_date', {
        pickupDate: dto.pickupDate,
      });
    }

    const trackingId = uuidv4().slice(0, 8).toUpperCase();
    // Pre-generate the delivery's id (the Phase-3 §2 Stage-A1 keystone). Today this is
    // byte-identical to the DB `@default(uuid())` — the row just gets an explicit id —
    // but minting it HERE makes every money idempotency key (`debit:<id>`, the promo
    // redemption's `deliveryId`, `refund:<id>`) knowable BEFORE the row exists, which is
    // the prerequisite for the debit-first saga (A2) that moves the charge-gating
    // wallet/promo writes out of this (future cross-shard) transaction. Generated ONCE,
    // so it stays stable across the trackingId-collision retry loop (only trackingId
    // regenerates) — a re-run can never mint a second id and double-debit. createdAt
    // stays DB-authoritative (no app-clock partition-boundary risk); the money keys need
    // only the id.
    const deliveryId = uuidv4();

    // Resolve pickup/dropoff coordinates so the drone can fly a real route.
    // Server-side geocode of the addresses is authoritative — caller-supplied
    // coords are validated against it but never priced from. See resolveCoords.
    const coords = await this.resolveCoords(dto);

    // Gate on serviceability BEFORE any DB/payment/queue side-effects: reject
    // out-of-area / no-fly (422, non-retryable) or a weather hold (503, retryable).
    await this.assertServiceable(coords);

    // Price via the single source of truth (PricingService) so the stored
    // price always matches the quote — including the distance component.
    const pricing = await this.pricingService.estimate({
      packageSize: dto.packageSize,
      packageWeight: dto.packageWeight,
      packageTypes: dto.packageTypes,
      fromAddress: dto.fromAddress,
      toAddress: dto.toAddress,
      ...coords,
    });

    // Decide whether to defer the lifecycle to a future pickup window. A pickup
    // far enough ahead (> threshold, ≤ max horizon) becomes a SCHEDULED delivery
    // whose lifecycle a kickoff job starts at `scheduledFor`; anything now/past
    // or unparseable behaves exactly as before (immediate PENDING).
    const scheduledFor = computeScheduledFor(dto.pickupDate, dto.pickupTime);
    const leadMs = scheduledFor ? scheduledFor.getTime() - Date.now() : 0;
    const isScheduled = leadMs > SCHEDULE_THRESHOLD_MS;
    if (isScheduled && leadMs > MAX_SCHEDULE_MS) {
      throw new AppBadRequestException('error.delivery.schedule.too_far', {
        maxDays: MAX_SCHEDULE_DAYS,
      });
    }

    // Apply an optional promo code. validateForRedeem throws (422/409) BEFORE any
    // write; the actual redemption is co-committed with the delivery below so a
    // code can never be over-redeemed. No code → charge the full price.
    const originalTotal = pricing.total;
    const promoCode = dto.promoCode
      ? await this.promoService.validateForRedeem(
          dto.promoCode,
          userId,
          originalTotal,
        )
      : null;
    const discount = promoCode
      ? this.promoService.computeDiscount(promoCode, originalTotal)
      : { discountAmount: 0, finalTotal: originalTotal };
    const afterPromo = discount.finalTotal;

    // Wallet credits, STACKED AFTER the promo discount. Clamp to both the balance
    // and the remaining charge (never negative). The authoritative debit is the
    // CAS inside the transaction below; this read just sizes the charge.
    let creditsToApply = 0;
    if (dto.useCredits) {
      const wallet = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { creditBalance: true },
      });
      creditsToApply = round2(
        Math.max(0, Math.min(wallet?.creditBalance ?? 0, afterPromo)),
      );
    }
    const finalTotal = round2(afterPromo - creditsToApply);

    // Grant the referral reward on the referee's first delivery (no-op otherwise).
    const pendingReferral = await this.prisma.referral.findFirst({
      where: { refereeId: userId, status: 'PENDING' },
    });

    // Recipient handoff OTP: store only the hash; the plaintext is returned
    // once below (the sender shares it with the recipient, who reads it back at
    // handoff). The drone won't finalize as DELIVERED without it.
    const handoffCode = this.generateHandoffCode();

    // Who flies this — decided by the SERVER, not the request body. `trackingSource`
    // and `droneId` used to be optional fields on the public create DTO, so any
    // authenticated customer could declare their delivery LIVE and name the airframe
    // that would carry it; the engine now picks one that can actually fly the route
    // and claims it atomically, or refuses the booking.
    //
    // Claimed as LATE as possible: everything above (geocode, pricing, promo,
    // wallet) can reject, and each of those would otherwise strand an aircraft.
    const dispatched = await this.dispatchService.dispatch({
      deliveryId,
      payloadKg: dto.packageWeight,
      route: coords,
      isScheduled,
    });

    const deliveryData = {
      id: deliveryId,
      trackingId,
      userId,
      status: isScheduled ? DeliveryStatus.SCHEDULED : DeliveryStatus.PENDING,
      trackingSource: dispatched.trackingSource,
      assignedDroneId: dispatched.droneId,
      scheduledFor: isScheduled ? scheduledFor : null,
      fromAddress: dto.fromAddress,
      toAddress: dto.toAddress,
      fromLat: coords.fromLat,
      fromLng: coords.fromLng,
      toLat: coords.toLat,
      toLng: coords.toLng,
      receiver: dto.receiver,
      packages: dto.packages,
      packageSize: dto.packageSize,
      packageWeight: dto.packageWeight,
      packageTypes: dto.packageTypes,
      pickupDate: new Date(dto.pickupDate),
      pickupTime: dto.pickupTime,
      estimatedPrice: finalTotal, // the discounted total is the charged amount
      handoffCodeHash: this.hashHandoffCode(handoffCode),
    };

    const debitFirst = this.debitFirstEnabled();

    // DEBIT-FIRST SAGA (§2 A2): run the AUTHORITATIVE promo-redeem + wallet-debit in their
    // OWN single-shard (user-shard) transactions BEFORE the delivery tx, keyed to the
    // pre-generated deliveryId. The card charge (finalTotal) is now backed by committed
    // reservations: a failed debit aborts create() before any delivery/charge exists, so
    // the platform can never under-charge. Promo first (credits are sized against
    // afterPromo), so a failed debit compensates exactly the one prior reservation.
    if (debitFirst) {
      try {
        if (promoCode) {
          await this.prisma.$transaction((tx) =>
            this.promoService.redeemWithinTx(
              tx,
              promoCode,
              userId,
              deliveryId,
              originalTotal,
              discount,
            ),
          );
        }
        if (creditsToApply > 0) {
          await this.prisma.$transaction((tx) =>
            this.walletService.debitWithinTx(tx, userId, creditsToApply, {
              deliveryId,
              idempotencyKey: `debit:${deliveryId}`,
            }),
          );
        }
      } catch (error) {
        // Reverse BOTH reservations on ANY throw out of the reservation block, then surface
        // the error (no delivery, no card charge). Wrapping the WHOLE block — not just the
        // debit — is load-bearing: a $transaction can COMMIT and then have its awaited promise
        // REJECT (a post-commit driver/connection error), landing HERE in-process with the
        // money already moved. That applies to the promo redeem too (promoCode set +
        // useCredits=false → the debit block is skipped, so the promo redeem is the only
        // money write); an unwrapped promo redeem would leak a consumed promo slot — including
        // a globally-capped code another customer could use — with no delivery and no charge.
        // compensateReservations is idempotent and a no-op when nothing committed, so
        // unconditional compensation is safe on every path and restores the documented
        // "in-process failures are compensated synchronously" invariant (only a process CRASH
        // falls through to the orphan reaper).
        await this.compensateReservations(deliveryId);
        // And the airframe, for the same reason the collision path below does it:
        // the claim committed on `drones` — a separate, non-partitioned row — so
        // nothing here rolls it back, and every later release keys on a delivery
        // that will never exist. This was the one throw out of create() after the
        // claim that did not hand the aircraft back.
        await this.releaseClaimedAircraft(dispatched.droneId, deliveryId);
        throw error;
      }
    }

    // The delivery row + the trackingId-registry row (+ any promo/credit/referral
    // balance mutations) commit in ONE transaction. The registry insert is what
    // enforces global trackingId uniqueness now that `deliveries` is partitioned
    // (a partitioned table can't carry UNIQUE(trackingId)); the balance helpers each
    // throw to roll the whole thing back on a race (cap loss / insufficient credits),
    // so there's never an orphan delivery, an over-counted code, or an unregistered id.
    // trackingId is an 8-char slice of a uuid; at volume a collision is rare but
    // non-zero, and an unhandled P2002 would fail an otherwise-valid create. Regenerate
    // + retry on a registry collision (≤ MAX_TRACKING_ID_TRIES); because the create is
    // the FIRST op in the $transaction, a collision rolls the whole tx back, so
    // promo/credit/referral re-run cleanly (no double-redeem).
    let delivery: Awaited<
      ReturnType<typeof this.prisma.delivery.create>
    > | null = null;
    for (let attempt = 0; attempt < MAX_TRACKING_ID_TRIES; attempt++) {
      try {
        delivery = await this.prisma.$transaction(async (tx) => {
          const created = await tx.delivery.create({ data: deliveryData });
          await tx.trackingIdRegistry.create({
            data: {
              trackingId: created.trackingId,
              deliveryId: created.id,
              deliveryCreatedAt: created.createdAt,
            },
          });
          // When debit-first is ON these ran as authoritative reservations above (their own
          // user-shard txns), so they must NOT run again here — a trackingId collision rolls
          // this tx back and re-runs the body, which would otherwise re-attempt the debit
          // against an already-committed key (P2002, mis-read as a non-collision failure).
          if (!debitFirst && promoCode) {
            await this.promoService.redeemWithinTx(
              tx,
              promoCode,
              userId,
              created.id,
              originalTotal,
              discount,
            );
          }
          if (!debitFirst && creditsToApply > 0) {
            await this.walletService.debitWithinTx(tx, userId, creditsToApply, {
              deliveryId: created.id,
              idempotencyKey: `debit:${created.id}`,
            });
          }
          if (pendingReferral) {
            // The referral reward is a pure credit with no failure mode, so it is the
            // first user-rooted side effect peeled out of this (future cross-shard) tx
            // (SCALING-1M.md §2). When the outbox is wired + DELIVERY_OUTBOX_REFERRAL=true,
            // enqueue a transactional-outbox event (committed atomically with the delivery
            // on its shard; applied to the user's shard by the worker dispatcher,
            // idempotently). Gated on the SAME `pendingReferral` pre-check as the inline
            // path, and the dispatcher re-runs maybeGrantReferralRewardWithinTx's CAS, so
            // behavior is identical to today (the flag-off default is byte-identical).
            if (this.referralOutboxEnabled()) {
              await this.outbox!.enqueueWithinTx(tx, {
                aggregateType: 'delivery',
                aggregateId: created.id,
                eventType: OUTBOX_EVENT_REFERRAL_REWARD,
                // Per-delivery key dedupes the tracking-id retry loop (a collision rolls
                // the whole tx back + re-runs this block → same key → P2002 on retry).
                idempotencyKey: `outbox-referral:${created.id}`,
                payload: { refereeUserId: userId },
              });
            } else {
              await this.walletService.maybeGrantReferralRewardWithinTx(
                tx,
                userId,
              );
            }
          }
          return created;
        });
        break;
      } catch (error) {
        // Only a trackingId collision is retryable; anything else (incl. the in-tx
        // debit idempotencyKey P2002) propagates unchanged.
        if (!this.isTrackingIdCollision(error)) {
          // Debit-first: the reservations committed in their own txns but the delivery
          // never will — reverse them (idempotent) so the credits/promo aren't stranded.
          if (debitFirst) await this.compensateReservations(deliveryId);
          // Same reasoning for the airframe. The claim committed on the `drones`
          // table (a separate, non-partitioned row) so this rollback does not undo
          // it, and every later release is keyed on a delivery row that will never
          // exist — the aircraft would be held out of service permanently.
          await this.releaseClaimedAircraft(dispatched.droneId, deliveryId);
          throw error;
        }
        deliveryData.trackingId = uuidv4().slice(0, 8).toUpperCase();
        // Last attempt that still collides falls through to the throw below.
      }
    }
    if (!delivery) {
      // Retries exhausted on collisions: same orphaned-reservation cleanup as above.
      if (debitFirst) await this.compensateReservations(deliveryId);
      await this.releaseClaimedAircraft(dispatched.droneId, deliveryId);
      throw new AppConflictException('error.delivery.tracking_id_alloc_failed');
    }

    // Create the payment (Stripe PaymentIntent) for the discounted total.
    // Best-effort; skipped entirely for a free order (Stripe rejects $0 intents).
    if (Math.round(finalTotal * 100) > 0) {
      try {
        await this.paymentsService.createDeliveryPayment(
          delivery.id,
          delivery.createdAt,
          finalTotal,
        );
      } catch (error) {
        this.logger.warn(
          `Payment creation failed for delivery ${delivery.id}: ${(error as Error).message}`,
        );
      }
    } else {
      this.logger.log(
        `Delivery ${delivery.id} is free after promo/credits — skipping payment.`,
      );
    }

    // A LIVE delivery is driven entirely by inbound drone telemetry, so it
    // enqueues NO simulation jobs — that's what guarantees the sim and a live
    // producer can never both drive one delivery. Otherwise either defer the
    // lifecycle to the pickup window (a single kickoff job) or start it now.
    // Best-effort: a queue/Redis hiccup must not fail creation.
    if (dispatched.trackingSource !== TrackingSource.LIVE) {
      try {
        if (isScheduled) {
          await this.simulationService.scheduleKickoff(
            delivery.id,
            delivery.createdAt,
            userId,
            coords,
            scheduledFor!,
          );
        } else {
          await this.simulationService.startSimulation(
            delivery.id,
            delivery.createdAt,
            userId,
            coords,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to queue ${isScheduled ? 'kickoff' : 'simulation'} for delivery ${delivery.id}: ${(error as Error).message}`,
        );
      }
    }

    // Return the plaintext handoff code exactly once (never persisted, never
    // returned by any other endpoint).
    return { ...delivery, handoffCode };
  }

  /**
   * Resolves pickup/dropoff coordinates for pricing, serviceability and the stored
   * flight route.
   *
   * SECURITY — the GEOCODE OF THE ADDRESS IS AUTHORITATIVE. Caller-supplied
   * coordinates are validated but never used for any of the three. This used to be
   * "client-supplied coords win", which meant the distance fee — the largest single
   * component of the price (PER_KM_RATE × haversine) — was computed from a number
   * the caller chose. Posting `fromLat/fromLng === toLat/toLng` zeroed it, and the
   * same coords were then handed to `assertServiceable`, so the geofence was passed
   * by construction rather than checked.
   *
   * Both addresses are geocoded on every create. `GeoService` caches, so a repeated
   * address is a cache hit; correctness beats a saved round-trip on a money path.
   *
   * A failed geocode leaves the pair undefined, which `assertServiceable` then
   * rejects as UNRESOLVED_LOCATION — deliberately fail-closed. We do NOT fall back
   * to caller coords, because that is exactly the trust boundary being closed here.
   */
  private async resolveCoords(dto: CreateDeliveryDto): Promise<ResolvedCoords> {
    const [fromGeo, toGeo] = await Promise.all([
      dto.fromAddress ? this.geoService.geocode(dto.fromAddress) : null,
      dto.toAddress ? this.geoService.geocode(dto.toAddress) : null,
    ]);

    // Caller coords are still worth something as an INPUT-SANITY signal: if the
    // caller pinned a point that disagrees with the address they typed, one of the
    // two is wrong, and 400 is a better answer than silently flying to whichever
    // street centroid the geocoder returned.
    this.assertCoordAgreesWithAddress(
      fromGeo,
      dto.fromLat,
      dto.fromLng,
      'fromAddress',
    );
    this.assertCoordAgreesWithAddress(toGeo, dto.toLat, dto.toLng, 'toAddress');

    return {
      fromLat: fromGeo?.lat,
      fromLng: fromGeo?.lng,
      toLat: toGeo?.lat,
      toLng: toGeo?.lng,
    };
  }

  /**
   * Rejects a caller coordinate that sits further than MAX_COORD_DEVIATION_KM from
   * the geocode of the address it claims to describe. No-ops when either side is
   * absent — a missing geocode is `assertServiceable`'s error to raise, and callers
   * that send no coords (every first-party client today) are unaffected.
   */
  private assertCoordAgreesWithAddress(
    geo: { lat: number; lng: number } | null,
    lat: number | undefined,
    lng: number | undefined,
    field: string,
  ): void {
    if (!geo || lat == null || lng == null) return;

    const deviationKm = haversineKm(geo.lat, geo.lng, lat, lng);
    if (deviationKm > MAX_COORD_DEVIATION_KM) {
      throw new AppBadRequestException(
        'error.delivery.coords.address_mismatch',
        {
          field,
          maxKm: MAX_COORD_DEVIATION_KM,
          deviationKm: Math.round(deviationKm * 10) / 10,
        },
      );
    }
  }

  /**
   * Rejects a delivery that can't be flown. Out-of-area / no-fly are hard
   * (422, non-retryable); a weather hold is soft (503 + retryAfter). If the
   * coordinates can't be resolved we can't verify serviceability — and the drone
   * can't fly to a place we can't locate — so reject rather than skip the gate.
   */
  private async assertServiceable(coords: ResolvedCoords): Promise<void> {
    if (
      coords.fromLat == null ||
      coords.fromLng == null ||
      coords.toLat == null ||
      coords.toLng == null
    ) {
      throw new AppUnprocessableEntityException(
        'error.delivery.serviceability.unresolved_location',
        undefined,
        { code: 'UNRESOLVED_LOCATION' },
      );
    }

    const result = await this.serviceabilityService.checkServiceability(
      coords.fromLat,
      coords.fromLng,
      coords.toLat,
      coords.toLng,
    );
    if (result.serviceable) return;

    const status = result.weatherHold
      ? HttpStatus.SERVICE_UNAVAILABLE // 503, retryable
      : HttpStatus.UNPROCESSABLE_ENTITY; // 422, non-retryable
    const code = result.weatherHold
      ? result.codes.find((c) => c.startsWith('WEATHER'))
      : result.codes.find((c) => !c.startsWith('WEATHER'));

    // Localize the SPECIFIC blocking reason per code (error.serviceability.<CODE>, with
    // {zoneName}/{windKph} params); fall back to the generic key if no code is present.
    // The English reasons[] + code + retryAfter stay as machine passthrough.
    throw new AppHttpException(
      status,
      code
        ? `error.serviceability.${code}`
        : 'error.delivery.serviceability.not_flyable',
      result.params,
      {
        reasons: result.reasons,
        ...(code ? { code } : {}),
        ...(result.weatherHold ? { retryAfter: 1800 } : {}),
      },
    );
  }

  async findAll(userId: string, query: DeliveryQueryDto) {
    const where: Prisma.DeliveryWhereInput = { userId };

    if (query.status === 'current') {
      where.status = { in: ACTIVE_STATUSES };
    } else if (query.status === 'scheduled') {
      where.status = DeliveryStatus.SCHEDULED;
    } else if (query.status === 'completed') {
      // "Completed" = settled outcomes the client groups as history: a successful
      // delivery AND the terminal exceptions (failed / returned-to-base). Without
      // the latter, a failed/returned delivery would match NO list filter and
      // disappear from the user's orders entirely.
      where.status = {
        in: [
          DeliveryStatus.DELIVERED,
          DeliveryStatus.DELIVERY_FAILED,
          DeliveryStatus.RETURNED_TO_BASE,
        ],
      };
    } else if (query.status === 'canceled') {
      where.status = DeliveryStatus.CANCELED;
    }

    if (query.q) {
      where.OR = [
        { trackingId: { contains: query.q, mode: 'insensitive' } },
        { packages: { contains: query.q, mode: 'insensitive' } },
        { receiver: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.DeliveryOrderByWithRelationInput;
    switch (query.sort) {
      case 'title':
        orderBy = { packages: 'asc' };
        break;
      case 'status':
        orderBy = { status: 'asc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
        break;
    }

    // Lag-tolerant rendered list → read replica (falls back to primary).
    const [items, total] = await this.prisma.readWithFallback((c) =>
      Promise.all([
        c.delivery.findMany({
          where,
          orderBy,
          skip: query.skip,
          take: query.limit,
        }),
        c.delivery.count({ where }),
      ]),
    );

    return {
      items,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOne(userId: string, deliveryId: string) {
    // `deliveries` is partitioned (composite PK), so id alone is no longer a
    // unique-where → findFirst (the uuid id matches at most one row).
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
        proofOfDelivery: true,
        rating: true,
      },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });
    }

    // Under the tracking hot-store, delivery.tracking is the last CHECKPOINTED position
    // (up to the checkpoint interval stale). Overlay the live position from Redis so a
    // poll — the WS-down fallback — reflects the drone within ms (SCALING-1M.md §3).
    // No-op when the hot-store is off, there's no tracking row, or no live position
    // exists (terminal/expired) → the checkpointed row stands.
    if (this.trackingHotStore?.enabled && delivery.tracking) {
      const hot = await this.trackingHotStore.readPosition(deliveryId);
      if (hot) {
        const t = delivery.tracking;
        if (hot.droneLat !== undefined) t.droneLat = hot.droneLat;
        if (hot.droneLng !== undefined) t.droneLng = hot.droneLng;
        if (hot.droneStatus !== undefined) t.droneStatus = hot.droneStatus;
        if (hot.eta !== undefined) t.eta = hot.eta;
      }
    }

    return delivery;
  }

  async findByTrackingId(userId: string, trackingId: string) {
    // A tracking poll — lag-tolerant → read replica (falls back to primary).
    // trackingId is no longer a column-unique on the partitioned `deliveries`; resolve
    // it via the non-partitioned registry → (deliveryId, deliveryCreatedAt) → a
    // composite-PK fetch (which prunes to the one partition).
    const delivery = await this.prisma.readWithFallback(async (c) => {
      const reg = await c.trackingIdRegistry.findUnique({
        where: { trackingId },
        select: { deliveryId: true, deliveryCreatedAt: true },
      });
      if (!reg) return null;
      return c.delivery.findUnique({
        where: {
          id_createdAt: {
            id: reg.deliveryId,
            createdAt: reg.deliveryCreatedAt,
          },
        },
        include: {
          tracking: true,
          workflowSteps: true,
          payment: true,
          proofOfDelivery: true,
          rating: true,
        },
      });
    });

    // Ownership-scoped: don't leak other users' deliveries by tracking id.
    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException(
        'error.delivery.not_found_by_tracking_id',
        { trackingId },
      );
    }

    return delivery;
  }

  async getActive(userId: string) {
    return this.prisma.readWithFallback((c) =>
      c.delivery.findMany({
        where: {
          userId,
          status: { in: ACTIVE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    );
  }

  async getRecent(userId: string) {
    return this.prisma.readWithFallback((c) =>
      c.delivery.findMany({
        where: {
          userId,
          status: DeliveryStatus.DELIVERED,
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    );
  }

  async cancel(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });
    }

    if (!CANCELABLE_STATUSES.includes(delivery.status)) {
      throw new AppBadRequestException('error.delivery.cancel.bad_status', {
        status: delivery.status,
        allowed: CANCELABLE_STATUSES.join(', '),
      });
    }

    // SINGLE-WINNER CAS, and it runs BEFORE any cleanup.
    //
    // This used to be: read, then three network round-trips of cleanup, then an
    // UNCONDITIONAL status write — the only transition in this file without a CAS.
    // The read above is advisory (the delivery can be dispatched, delivered or
    // failed while those round-trips are in flight), so a lost race both refunded a
    // delivery that had already completed AND overwrote its terminal status with
    // CANCELED. Claiming the transition first means only the winner cleans up, and
    // a terminal can never be resurrected.
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: { in: CANCELABLE_STATUSES } },
      data: { status: DeliveryStatus.CANCELED },
    });
    if (count === 0) {
      const current = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { status: true },
      });
      throw new AppConflictException('error.delivery.cancel.race_bad_status', {
        status: current?.status ?? delivery.status,
      });
    }

    // Refund BOTH legs. cancel() previously released the promo and returned the
    // wallet-credit portion but never refundChargeToWallet, so a customer who paid
    // partly by card was silently short-refunded — while every exception path
    // returned both. Same helper now serves all terminal paths.
    await this.cleanupAfterTermination(deliveryId, true);

    return this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
        proofOfDelivery: true,
        rating: true,
      },
    });
  }

  /**
   * ADMIN-only force-cancel — bypasses the owner check and the CANCELABLE gate to
   * cancel a stuck delivery in any non-terminal state. Single-winner conditional
   * CAS (can't un-deliver / double-cancel), then best-effort cleanup (sim jobs,
   * promo slot, spent credits). Caller must enforce the ADMIN role.
   */
  async adminForceCancel(
    deliveryId: string,
    /**
     * Optional: write an audit row in the SAME transaction as the winning CAS.
     *
     * Same contract as `failExceptional`'s: it runs only when a CAS matched, receives
     * the status the cancel fired FROM, and runs INSIDE the transaction but OUTSIDE
     * cleanupAfterTermination (which does network I/O). Only the admin route passes
     * one, so nothing else pays for the read it gates.
     */
    auditWithinTx?: (
      tx: Prisma.TransactionClient,
      firedFrom: DeliveryStatus | null,
    ) => Promise<void>,
  ) {
    // The exact status the cancel is about to fire from. Gated on the callback: no
    // other caller records it, and force-cancel is rare enough to afford the read
    // when someone does. Same read-then-CAS caveat as failExceptional's — under READ
    // COMMITTED a commit landing between the SELECT and the UPDATE would be recorded
    // one status stale.
    const readStatus = async (tx: Prisma.TransactionClient) =>
      auditWithinTx
        ? ((
            await tx.delivery.findFirst({
              where: { id: deliveryId },
              select: { status: true },
            })
          )?.status ?? null)
        : null;

    // ONE interactive transaction over both CASes and the audit row.
    //
    // This knowingly crosses the rule at the top of this file (§ the debit-first
    // saga, ~:86): no single $transaction may co-commit state rooted at different
    // shard keys, and an AdminAuditLog is actor-rooted while the delivery is
    // delivery-rooted. Accepted deliberately — an audit row that can commit apart
    // from the action it records is the exact defect this exists to remove, and the
    // cost is that admin_audit_logs would be pinned to the delivery shard if
    // shardCount ever goes above 1. Recorded here so it is found as a decision
    // rather than rediscovered as an accident.
    const outcome = await this.prisma.$transaction(async (tx) => {
      // TWO conditional CASes, not one, because the disposition of the AIRCRAFT
      // depends on which status we cancelled FROM and `updateMany` cannot report the
      // row it matched. Their union is exactly the old `notIn: TERMINAL_STATUSES`,
      // so what may be force-cancelled is unchanged — only what happens to the
      // airframe afterwards is.
      //
      // The pre-launch set first: it is the common case and nothing is flying.
      let firedFrom = await readStatus(tx);
      let { count } = await tx.delivery.updateMany({
        where: {
          id: deliveryId,
          // Never resurrect a SETTLED terminal (DELIVERED/CANCELED and the exception
          // terminals DELIVERY_FAILED/RETURNED_TO_BASE) — that would corrupt the
          // recorded outcome and trigger a second, policy-violating cleanup/refund.
          status: { notIn: [...TERMINAL_STATUSES, ...FAILABLE_STATUSES] },
        },
        data: { status: DeliveryStatus.CANCELED },
      });
      let aircraft: AircraftDisposition = 'RETURN_TO_FLEET';

      if (count === 0) {
        // The in-flight set. Force-cancelling an airborne delivery stays legal —
        // RETURNING included — but the aircraft is up there with the parcel and the
        // claim is the only thing keeping the engine from selling it to the next
        // booking. It is taken out of service instead: not because it is suspect,
        // but because a mission ended mid-air and a human has to find out where it
        // is. STILL_AIRBORNE would be the honest label and the wrong behavior — a
        // CANCELED delivery never reaches completeReturnToBase, so the claim would
        // be held forever.
        //
        // Re-read before this one: the first CAS missing says only that the row was
        // not pre-launch, so the status read before it is the wrong one to record.
        firedFrom = await readStatus(tx);
        ({ count } = await tx.delivery.updateMany({
          where: { id: deliveryId, status: { in: FAILABLE_STATUSES } },
          data: { status: DeliveryStatus.CANCELED },
        }));
        if (count > 0) aircraft = 'GROUND_FOR_INSPECTION';
      }

      if (count === 0) return null;
      if (auditWithinTx) await auditWithinTx(tx, firedFrom);
      return { aircraft };
    });

    if (outcome === null) {
      const existing = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { status: true },
      });
      if (!existing) {
        throw new AppNotFoundException('error.delivery.not_found', {
          id: deliveryId,
        });
      }
      throw new AppConflictException('error.delivery.cancel.race_bad_status', {
        status: existing.status,
      });
    }

    // Same cleanup as every other terminal path — including the card-charged leg,
    // which this used to omit exactly like owner-cancel did. Strictly OUTSIDE the
    // transaction above: it refunds, releases the airframe and cancels sim jobs.
    await this.cleanupAfterTermination(deliveryId, true, outcome.aircraft);

    return this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      include: { tracking: true, payment: true },
    });
  }

  // ───────────────────────── Delivery exceptions (P3 #16) ─────────────────────
  // Failed drop / weather abort / return-to-base as first-class outcomes. Each is
  // a dedicated conditional CAS (like adminForceCancel) from a guarded set of
  // in-flight states — single-winner, idempotent, never resurrects a terminal,
  // never auto-delivers (no exception CAS targets DELIVERED). Cleanup + comms run
  // exactly once, only for the winning transition (count > 0).

  /**
   * Fail an in-flight delivery (terminal DELIVERY_FAILED). Triggered by a drone
   * telemetry FAILED phase, the admin /fail endpoint, or an exhausted handoff OTP.
   * A drone/service-fault reason refunds the customer; a recipient-fault does not.
   * Returns whether THIS call performed the transition (idempotent for callers).
   */
  async failExceptional(
    deliveryId: string,
    reason: DeliveryFailureReason,
    /**
     * Statuses this particular caller is allowed to fail FROM. Defaults to the full
     * failable set; the watchdog passes its own narrower one.
     *
     * Why it exists: FAILABLE_STATUSES includes AWAITING_HANDOFF, but the watchdog's
     * candidate query deliberately EXCLUDES it — a drone hovering at the door is not
     * "stuck", it is waiting for a person. Because the CAS was wider than the query
     * that selected the row, a delivery picked up as IN_TRANSIT that reached handoff
     * mid-scan still passed the CAS and was failed + auto-refunded while the customer
     * was walking outside. The per-row recheck could not catch it: it re-reads
     * in-memory values from the original query, not the current status.
     */
    allowedStatuses: DeliveryStatus[] = FAILABLE_STATUSES,
    /**
     * Optional: write an audit row in the SAME transaction as the status CAS.
     *
     * Runs only when the CAS matched, and receives the status the transition fired
     * FROM — the fact that decides whether an aircraft was airborne. Callers that pass
     * nothing (the watchdog, the pre-flight abort) are byte-identical to before: those
     * are not operator actions, and recording them would make "what did a human do?"
     * unanswerable by dilution rather than absence.
     *
     * It runs INSIDE the transaction and OUTSIDE cleanupAfterTermination, which does
     * network I/O (refunds, MQTT, queue writes) that must never be held in one.
     *
     * `firedFrom` is the row's ACTUAL status, read inside the transaction immediately
     * before the CAS — not a guess derived from the allowed set.
     *
     * Precisely: it is a read-then-CAS, not the matched row's status. Under READ
     * COMMITTED (the default here — this path sets no isolation level and takes no row
     * lock) each statement gets a fresh snapshot, so a telemetry commit landing between
     * the SELECT and the UPDATE would have the audit row say DRONE_ASSIGNED while the
     * CAS actually fired from PICKUP_IN_PROGRESS. Sub-millisecond window, and not worth
     * a FOR UPDATE lock on this path — but it is a read-then-CAS, not a guarantee.
     */
    auditWithinTx?: (
      tx: Prisma.TransactionClient,
      firedFrom: DeliveryStatus | null,
    ) => Promise<void>,
  ): Promise<boolean> {
    // Split the caller's allowed set by whether a drone is AIRBORNE in that status,
    // and run whichever halves are non-empty. Every caller today passes a set that
    // is entirely one or the other (FAILABLE_STATUSES is in-flight by definition;
    // the pre-flight abort passes [SCHEDULED]), so this is one round trip in
    // practice — but the answer is derived rather than assumed, which is what makes
    // it survive the next caller.
    const airborneAllowed = allowedStatuses.filter((s) =>
      FAILABLE_STATUSES.includes(s),
    );
    const groundedAllowed = allowedStatuses.filter(
      (s) => !FAILABLE_STATUSES.includes(s),
    );

    // The CAS and the audit row co-commit or neither happens; the cleanup that
    // follows is deliberately OUTSIDE, because it does network I/O.
    const outcome = await this.prisma.$transaction(async (tx) => {
      // The exact status this transition is about to fire FROM.
      //
      // A CAS cannot report which status it matched, and the caller's allowed set is
      // usually the whole in-flight family — so deriving it from the set would record
      // DRONE_ASSIGNED for a delivery that was actually AWAITING_HANDOFF. Read it.
      //
      // Gated on `auditWithinTx` because only an operator action writes it down: the
      // watchdog reaps in bulk and must not pay an indexed read per reap for a field
      // nobody records. Read INSIDE the transaction, immediately before the CAS.
      const firedFrom = auditWithinTx
        ? ((
            await tx.delivery.findFirst({
              where: { id: deliveryId },
              select: { status: true },
            })
          )?.status ?? null)
        : null;

      let matched = 0;
      let wasAirborne = false;

      if (groundedAllowed.length) {
        ({ count: matched } = await tx.delivery.updateMany({
          where: { id: deliveryId, status: { in: groundedAllowed } },
          data: {
            status: DeliveryStatus.DELIVERY_FAILED,
            failureReason: reason,
          },
        }));
      }
      if (matched === 0 && airborneAllowed.length) {
        ({ count: matched } = await tx.delivery.updateMany({
          where: { id: deliveryId, status: { in: airborneAllowed } },
          data: {
            status: DeliveryStatus.DELIVERY_FAILED,
            failureReason: reason,
          },
        }));
        if (matched > 0) wasAirborne = true;
      }
      if (matched === 0) return null;

      if (auditWithinTx) await auditWithinTx(tx, firedFrom);
      return { airborne: wasAirborne };
    });

    if (!outcome) return false;
    const airborne = outcome.airborne;

    // TWO independent reasons to keep an aircraft out of the dispatchable pool,
    // and the second one used to be missing.
    //
    // Implicated: a drone-fault failure — lost comms, a mechanical abort. It does
    // not rejoin the pool on the strength of the same telemetry silence that got
    // the delivery reaped; a human signs it off.
    //
    // Airborne: it is still flying, whatever the reason. A no-show at the door is
    // a blameless RECIPIENT_UNAVAILABLE, and the aircraft is nonetheless hovering
    // over a stranger's garden holding their parcel — re-pooling it hands a flying
    // drone to the next booking. "The airframe is not at fault" and "the airframe
    // is parked" are different questions; only the second one licenses a release.
    await this.cleanupAfterTermination(
      deliveryId,
      isDroneFaultReason(reason),
      isDroneFaultReason(reason) || airborne
        ? 'GROUND_FOR_INSPECTION'
        : 'RETURN_TO_FLEET',
    );
    await this.announceException(
      deliveryId,
      DeliveryStatus.DELIVERY_FAILED,
      reason,
    );
    this.logger.log(`Delivery ${deliveryId} → DELIVERY_FAILED (${reason})`);
    return true;
  }

  /**
   * Begin a return-to-base flight (transient RETURNING): the drone aborted the
   * drop and is flying the package home; the user watches it return on the map.
   * The refund decision is made HERE (at the abort), not when the drone lands.
   */
  async beginReturnToBase(
    deliveryId: string,
    reason: DeliveryFailureReason,
  ): Promise<boolean> {
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: { in: RETURNABLE_STATUSES } },
      data: { status: DeliveryStatus.RETURNING, failureReason: reason },
    });
    if (count === 0) return false;
    // The aircraft KEEPS its claim here. RETURNING closes the delivery's money side
    // but the drone is airborne with the parcel; it is handed back when the return
    // flight lands (completeReturnToBase), and grounded then, because whatever
    // aborted the drop is a reason to look at it before it flies again.
    await this.cleanupAfterTermination(
      deliveryId,
      isDroneFaultReason(reason),
      'STILL_AIRBORNE',
    );
    await this.announceException(deliveryId, DeliveryStatus.RETURNING, reason);
    this.logger.log(`Delivery ${deliveryId} → RETURNING (${reason})`);
    return true;
  }

  /**
   * Complete a return flight (RETURNING → terminal RETURNED_TO_BASE). A guarded
   * forward step OFF the happy-path order; non-resurrectable (re-firing against
   * the terminal matches 0 rows). No second cleanup — the refund already ran at
   * beginReturnToBase; the failureReason set at the abort is preserved.
   *
   * This IS where the aircraft comes back, though: beginReturnToBase deliberately
   * left the claim in place because the drone was still flying. It has now landed,
   * and it is grounded rather than returned to the pool — a return-to-base is an
   * aborted mission, and the thing that aborted it has not been diagnosed.
   */
  async completeReturnToBase(deliveryId: string): Promise<boolean> {
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.RETURNING },
      data: { status: DeliveryStatus.RETURNED_TO_BASE },
    });
    if (count === 0) return false;
    await this.dispatchService.release(deliveryId, 'GROUND_FOR_INSPECTION');
    await this.announceException(deliveryId, DeliveryStatus.RETURNED_TO_BASE);
    this.logger.log(`Delivery ${deliveryId} → RETURNED_TO_BASE`);
    return true;
  }

  /**
   * ADMIN-only fail — owner-unscoped, mirrors adminForceCancel's 404/409 contract.
   * Caller must enforce the ADMIN role.
   */
  async adminFail(
    deliveryId: string,
    reason: DeliveryFailureReason,
    /** Forwarded verbatim to `failExceptional` — see its contract. This method owns
     *  no transaction of its own; it only decides 404 vs 409 when nothing applied. */
    auditWithinTx?: (
      tx: Prisma.TransactionClient,
      firedFrom: DeliveryStatus | null,
    ) => Promise<void>,
  ) {
    const applied = await this.failExceptional(
      deliveryId,
      reason,
      undefined,
      auditWithinTx,
    );
    if (!applied) {
      const existing = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { status: true },
      });
      if (!existing) {
        throw new AppNotFoundException('error.delivery.not_found', {
          id: deliveryId,
        });
      }
      throw new AppConflictException('error.delivery.fail.bad_status', {
        status: existing.status,
      });
    }
    return this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      include: { tracking: true, payment: true },
    });
  }

  /** Stop the sim, and for a drone-fault release the promo slot + refund credits.
   * Idempotent + best-effort — the same trio cancel/adminForceCancel use. */
  /**
   * The one cleanup every terminal path runs: stop the simulation and, when the
   * outcome warrants a refund, return BOTH legs of the charge (wallet credits and
   * the card-charged portion credited back to the wallet — there is no live Stripe
   * refund yet). Every step is idempotent and no-ops when unused.
   *
   * Shared by failExceptional, beginReturnToBase, cancel and adminForceCancel so a
   * new terminal cannot quietly refund one leg and forget the other, which is how
   * the two cancel paths came to short-refund card payers.
   */
  private async cleanupAfterTermination(
    deliveryId: string,
    refundCredits: boolean,
    aircraft: AircraftDisposition = 'RETURN_TO_FLEET',
  ): Promise<void> {
    // Give the aircraft back first — a terminated delivery must never keep holding
    // one, or the fleet leaks capacity one stuck delivery at a time.
    //
    // Except when it is still flying. RETURNING is a terminal outcome for the
    // DELIVERY (the customer is refunded, the money side is closed) but not for the
    // aircraft: it is airborne with the parcel, heading home, and the claim is the
    // only thing stopping the dispatch engine from selecting it for a new booking
    // mid-flight. It is released when the return flight actually lands.
    if (aircraft !== 'STILL_AIRBORNE') {
      await this.dispatchService.release(deliveryId, aircraft);
    }
    await this.simulationService
      .stopSimulation(deliveryId)
      .catch(() => undefined);
    if (refundCredits) {
      await this.promoService
        .releaseForDelivery(deliveryId)
        .catch((e) =>
          this.logger.warn(
            `Promo release failed for ${deliveryId}: ${(e as Error).message}`,
          ),
        );
      // Return BOTH portions of the charge so the "refunded to your wallet" comms
      // are truthful for every payer: the wallet-credit portion (refundForDelivery)
      // AND the card-charged portion credited back to the wallet (refundChargeToWallet,
      // since there's no live Stripe money-refund yet). Both idempotent.
      await this.walletService
        .refundForDelivery(deliveryId)
        .catch((e) =>
          this.logger.warn(
            `Credit refund failed for ${deliveryId}: ${(e as Error).message}`,
          ),
        );
      await this.walletService
        .refundChargeToWallet(deliveryId)
        .catch((e) =>
          this.logger.warn(
            `Charge refund failed for ${deliveryId}: ${(e as Error).message}`,
          ),
        );
    }
  }

  /** Notify the owner + publish the status to WS subscribers (best-effort, like
   * the simulation's stage side-effects). */
  private async announceException(
    deliveryId: string,
    status: DeliveryStatus,
    reason?: DeliveryFailureReason,
  ): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      select: { userId: true, user: { select: { locale: true } } },
    });
    if (!delivery) return;
    // Localize to the delivery OWNER's language (the notified party — NOT the
    // actor, which may be an admin). Folded into the read above (no extra query).
    const locale = delivery.user?.locale;
    const base = `notification.exception.${exceptionMessageKey(status, reason)}`;
    await this.safe(() =>
      this.notificationsService.create(
        delivery.userId,
        this.i18n.translate(`${base}.title`, locale),
        this.i18n.translate(`${base}.body`, locale),
        { deliveryId, status, failureReason: reason },
        'delivery',
      ),
    );
    await this.safe(() =>
      this.trackingPublisher.publishUpdate({
        deliveryId,
        status,
        droneStatus: this.i18n.translate(`${base}.droneStatus`, locale),
      }),
    );
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(
        `Exception side-effect failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * "Send again" — clone a past delivery into a new one. Reuses create(), so it
   * re-runs serviceability/pricing/payment fresh (a now-unflyable route is
   * rejected). Defaults to an immediate pickup; an optional override can schedule it.
   */
  async reorder(
    userId: string,
    deliveryId: string,
    overrides?: { pickupDate?: string; pickupTime?: string },
  ) {
    const src = await this.findOne(userId, deliveryId); // owner-scoped (404 otherwise)
    const now = nowInServiceTz();
    return this.create(userId, {
      fromAddress: src.fromAddress,
      toAddress: src.toAddress,
      receiver: src.receiver,
      packages: src.packages,
      packageSize: src.packageSize,
      packageWeight: src.packageWeight,
      packageTypes: src.packageTypes,
      // Deliberately NOT forwarding the source's coords. create() geocodes the
      // addresses and ignores caller coords entirely, so replaying stored ones can
      // only ever trip assertCoordAgreesWithAddress — a check meant for untrusted
      // CALLER input, not for values this service wrote itself.
      pickupDate: overrides?.pickupDate ?? now.date,
      pickupTime: overrides?.pickupTime ?? now.time,
    });
  }

  /**
   * Recipient handoff: the drone has arrived (AWAITING_HANDOFF) and only
   * finalizes as DELIVERED when the correct one-time code is presented. Prevents
   * releasing a package to the wrong person. Owner-scoped; the code is verified
   * with a constant-time compare; wrong guesses are counted and lock the handoff
   * after MAX_HANDOFF_ATTEMPTS.
   */
  async confirmHandoff(userId: string, deliveryId: string, code: string) {
    // handoffCodeHash + handoffAttempts are globally omitted from reads
    // (PrismaService) — opt them back in here for verification.
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      omit: { handoffCodeHash: false, handoffAttempts: false },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new AppNotFoundException('error.delivery.not_found', {
        id: deliveryId,
      });
    }
    if (delivery.status === DeliveryStatus.DELIVERED) {
      throw new AppConflictException(
        'error.delivery.handoff.already_completed',
      );
    }
    if (delivery.status !== DeliveryStatus.AWAITING_HANDOFF) {
      throw new AppConflictException('error.delivery.handoff.not_awaiting');
    }
    if (delivery.handoffAttempts >= MAX_HANDOFF_ATTEMPTS) {
      // Already locked. Self-heal: if a prior (concurrent) race locked the counter
      // without transitioning, fail it now so it can't sit AWAITING_HANDOFF forever
      // with the sim still running. Idempotent — a no-op once already failed.
      await this.failExceptional(
        deliveryId,
        DeliveryFailureReason.RECIPIENT_UNAVAILABLE,
      );
      throw this.handoffLockedError();
    }

    if (!this.handoffCodeMatches(code, delivery.handoffCodeHash)) {
      // Atomic, conditional increment: only bump while still under the cap, so
      // concurrent wrong guesses can't push the counter past MAX (TOCTOU-safe).
      // count === 0 means another request just reached the cap → locked.
      const { count } = await this.prisma.delivery.updateMany({
        where: {
          id: deliveryId,
          handoffAttempts: { lt: MAX_HANDOFF_ATTEMPTS },
        },
        data: { handoffAttempts: { increment: 1 } },
      });
      // Decide lock from the PERSISTED post-CAS counter, NOT the stale pre-CAS read
      // (which, under concurrent guesses, can be lower than the value this attempt's
      // increment produced — leaving the delivery locked but never failed). The
      // counter only rises and is capped at MAX by the CAS guard above, so this
      // re-read is race-safe. count === 0 means a concurrent attempt already hit
      // the cap. Either way auto-fail (recipient-fault → no auto-refund), then
      // report locked. failExceptional is idempotent → fails exactly once.
      const after = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { handoffAttempts: true },
      });
      if (
        count === 0 ||
        (after?.handoffAttempts ?? MAX_HANDOFF_ATTEMPTS) >= MAX_HANDOFF_ATTEMPTS
      ) {
        await this.failExceptional(
          deliveryId,
          DeliveryFailureReason.RECIPIENT_UNAVAILABLE,
        );
        throw this.handoffLockedError();
      }
      throw new AppUnauthorizedException('error.delivery.handoff.invalid_code');
    }

    // Atomic single-winner transition: only one concurrent confirm can flip
    // AWAITING_HANDOFF → DELIVERED; a loser updates 0 rows and is rejected.
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.AWAITING_HANDOFF },
      data: {
        status: DeliveryStatus.DELIVERED,
        handoffConfirmedAt: new Date(),
      },
    });
    if (count === 0) {
      throw new AppConflictException(
        'error.delivery.handoff.already_completed',
      );
    }

    // The mission is over — give the aircraft back. This is the SUCCESS path, and
    // it released nothing: every terminal path had a release except the one that
    // actually happens, so a healthy fleet lost one airframe per completed
    // delivery until every drone was permanently "in flight" and dispatch had
    // nothing left to assign. Runs behind the single-winner CAS, so exactly once.
    await this.dispatchService.release(deliveryId, 'RETURN_TO_FLEET');

    // Record proof of delivery now that the recipient has confirmed receipt
    // (best-effort — idempotent and non-fatal).
    try {
      await this.proofService.createAutoProof(deliveryId, delivery.createdAt, {
        lat: delivery.toLat ?? undefined,
        lng: delivery.toLng ?? undefined,
        recipientName: delivery.receiver,
      });
    } catch (error) {
      this.logger.warn(
        `Auto-proof failed for delivery ${deliveryId}: ${(error as Error).message}`,
      );
    }

    return this.findOne(userId, deliveryId);
  }

  /** 423 Locked, in object form so the body carries an `error` field like the
   * built-in Nest exceptions (consistent shape through AllExceptionsFilter). */
  private handoffLockedError(): HttpException {
    return new AppHttpException(
      HANDOFF_LOCKED,
      'error.delivery.handoff.locked',
      undefined,
      { error: 'Locked' },
    );
  }

  /** A P2002 unique violation from the trackingId registry (vs e.g. the in-tx debit
   * idempotencyKey or a promo redemption, which must NOT trigger a trackingId regenerate).
   * The collision now surfaces on tracking_id_registry's PK; match BOTH shapes the pg
   * driver adapter can emit — the parsed column list (`trackingId`) and, when present, the
   * constraint/index name (`tracking_id_registry_pkey`). Neither substring appears in the
   * debit/promo constraints, so this stays scoped to a real trackingId collision. */
  private isTrackingIdCollision(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const meta = error.meta as { target?: unknown; constraint?: unknown };
    const fingerprint = JSON.stringify([
      meta?.target ?? '',
      meta?.constraint ?? '',
    ]);
    return (
      fingerprint.includes('trackingId') ||
      fingerprint.includes('tracking_id_registry')
    );
  }

  /** Cryptographically-random 6-digit handoff code (human-readable). */
  private generateHandoffCode(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hashHandoffCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /** Constant-time compare of the provided code against the stored hash. */
  private handoffCodeMatches(code: string, storedHash: string | null): boolean {
    if (!storedHash) return false;
    const provided = Buffer.from(this.hashHandoffCode(code));
    const expected = Buffer.from(storedHash);
    return (
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected)
    );
  }
}

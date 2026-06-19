import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DeliveryFailureReason,
  DeliveryStatus,
  Prisma,
  TrackingSource,
} from '@prisma/client';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { GeoService } from '../geo/geo.service';
import { I18nService } from '../i18n/i18n.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { PromoService } from '../promo/promo.service';
import { WalletService } from '../wallet/wallet.service';
import { ProofService } from './proof/proof.service';
import { SimulationService } from './simulation/simulation.service';
import { TrackingPublisher } from './tracking/tracking.publisher';
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

const CANCELABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.SCHEDULED,
  DeliveryStatus.PENDING,
  DeliveryStatus.CONFIRMED,
];

const MAX_SCHEDULE_MS = MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  ) {}

  async create(userId: string, dto: CreateDeliveryDto) {
    const trackingId = uuidv4().slice(0, 8).toUpperCase();

    // Resolve pickup/dropoff coordinates so the drone can fly a real route.
    // Uses client-provided coords when present; otherwise geocodes the
    // addresses (best-effort — geocoding failures leave coords undefined).
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
      throw new BadRequestException(
        `Pickup can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`,
      );
    }

    // A LIVE delivery is driven by a real drone reporting its lifecycle now — it
    // starts no simulation. Scheduling a future LIVE delivery has no sim kickoff
    // to defer (and statusesBefore(PENDING) is empty, so telemetry couldn't lift
    // it out of SCHEDULED), so reject the combination rather than strand it.
    const isLive = dto.trackingSource === 'LIVE';
    if (isLive && isScheduled) {
      throw new BadRequestException(
        'A LIVE-tracked delivery cannot be scheduled for a future pickup window.',
      );
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

    const deliveryData = {
      trackingId,
      userId,
      status: isScheduled ? DeliveryStatus.SCHEDULED : DeliveryStatus.PENDING,
      trackingSource: isLive ? TrackingSource.LIVE : TrackingSource.SIMULATED,
      // A LIVE delivery is bound to exactly one drone; telemetry from any other
      // drone is rejected. The default is a high-entropy random id (NOT derived
      // from the public trackingId) so the binding is a real second factor; it's
      // returned on create so the operator/gateway knows which id to report under.
      assignedDroneId: isLive ? (dto.droneId ?? `drone-${uuidv4()}`) : null,
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
          if (promoCode) {
            await this.promoService.redeemWithinTx(
              tx,
              promoCode,
              userId,
              created.id,
              originalTotal,
              discount,
            );
          }
          if (creditsToApply > 0) {
            await this.walletService.debitWithinTx(tx, userId, creditsToApply, {
              deliveryId: created.id,
              idempotencyKey: `debit:${created.id}`,
            });
          }
          if (pendingReferral) {
            await this.walletService.maybeGrantReferralRewardWithinTx(
              tx,
              userId,
            );
          }
          return created;
        });
        break;
      } catch (error) {
        // Only a trackingId collision is retryable; anything else (incl. the in-tx
        // debit idempotencyKey P2002) propagates unchanged.
        if (!this.isTrackingIdCollision(error)) throw error;
        deliveryData.trackingId = uuidv4().slice(0, 8).toUpperCase();
        // Last attempt that still collides falls through to the throw below.
      }
    }
    if (!delivery) {
      throw new ConflictException(
        'Could not allocate a unique tracking id, please retry.',
      );
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
    if (!isLive) {
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
   * Fills in pickup/dropoff coordinates. Client-supplied coords win; any
   * missing pair is geocoded from its address via the geo provider.
   * Best-effort: a failed geocode simply leaves the coordinate undefined
   * (the simulation then falls back to its default route).
   */
  private async resolveCoords(dto: CreateDeliveryDto): Promise<ResolvedCoords> {
    let { fromLat, fromLng, toLat, toLng } = dto;

    if ((fromLat == null || fromLng == null) && dto.fromAddress) {
      const geo = await this.geoService.geocode(dto.fromAddress);
      if (geo) {
        fromLat = geo.lat;
        fromLng = geo.lng;
      }
    }

    if ((toLat == null || toLng == null) && dto.toAddress) {
      const geo = await this.geoService.geocode(dto.toAddress);
      if (geo) {
        toLat = geo.lat;
        toLng = geo.lng;
      }
    }

    return { fromLat, fromLng, toLat, toLng };
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
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message:
            "We couldn't locate the pickup or dropoff. Pick the points on the map and try again.",
          code: 'UNRESOLVED_LOCATION',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
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

    throw new HttpException(
      {
        statusCode: status,
        error: result.weatherHold
          ? 'Service Unavailable'
          : 'Unprocessable Entity',
        message:
          result.reasons[0] ?? 'This delivery cannot be flown right now.',
        reasons: result.reasons,
        code,
        ...(result.weatherHold ? { retryAfter: 1800 } : {}),
      },
      status,
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
      throw new NotFoundException(`Delivery with id "${deliveryId}" not found`);
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
      throw new NotFoundException(
        `Delivery with tracking id "${trackingId}" not found`,
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
      throw new NotFoundException(`Delivery with id "${deliveryId}" not found`);
    }

    if (!CANCELABLE_STATUSES.includes(delivery.status)) {
      throw new BadRequestException(
        `Delivery cannot be canceled in "${delivery.status}" status. Only ${CANCELABLE_STATUSES.join(', ')} deliveries can be canceled.`,
      );
    }

    // Remove the delivery's pending simulation jobs (best-effort).
    try {
      await this.simulationService.stopSimulation(deliveryId);
    } catch {
      // The processor also guards on CANCELED status, so this is non-fatal.
    }

    // Release any promo redemption + refund any spent wallet credits so the slot
    // and the credits are returned (best-effort, idempotent). No-ops when unused.
    try {
      await this.promoService.releaseForDelivery(deliveryId);
    } catch (error) {
      this.logger.warn(
        `Promo release failed for delivery ${deliveryId}: ${(error as Error).message}`,
      );
    }
    try {
      await this.walletService.refundForDelivery(deliveryId);
    } catch (error) {
      this.logger.warn(
        `Credit refund failed for delivery ${deliveryId}: ${(error as Error).message}`,
      );
    }

    return this.prisma.delivery.update({
      where: {
        id_createdAt: { id: deliveryId, createdAt: delivery.createdAt },
      },
      data: { status: DeliveryStatus.CANCELED },
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
  async adminForceCancel(deliveryId: string) {
    const { count } = await this.prisma.delivery.updateMany({
      where: {
        id: deliveryId,
        // Never resurrect a SETTLED terminal (DELIVERED/CANCELED and the exception
        // terminals DELIVERY_FAILED/RETURNED_TO_BASE) — that would corrupt the
        // recorded outcome and trigger a second, policy-violating cleanup/refund.
        // RETURNING (transient/in-flight) remains force-cancelable.
        status: { notIn: TERMINAL_STATUSES },
      },
      data: { status: DeliveryStatus.CANCELED },
    });
    if (count === 0) {
      const existing = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException(`Delivery "${deliveryId}" not found`);
      }
      throw new ConflictException(
        `Delivery cannot be canceled in "${existing.status}" status.`,
      );
    }

    // Best-effort cleanup (reuses the same services the owner-cancel uses).
    await this.simulationService
      .stopSimulation(deliveryId)
      .catch(() => undefined);
    await this.promoService
      .releaseForDelivery(deliveryId)
      .catch(() => undefined);
    await this.walletService
      .refundForDelivery(deliveryId)
      .catch(() => undefined);

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
  ): Promise<boolean> {
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: { in: FAILABLE_STATUSES } },
      data: { status: DeliveryStatus.DELIVERY_FAILED, failureReason: reason },
    });
    if (count === 0) return false;
    await this.cleanupAfterException(deliveryId, isDroneFaultReason(reason));
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
    await this.cleanupAfterException(deliveryId, isDroneFaultReason(reason));
    await this.announceException(deliveryId, DeliveryStatus.RETURNING, reason);
    this.logger.log(`Delivery ${deliveryId} → RETURNING (${reason})`);
    return true;
  }

  /**
   * Complete a return flight (RETURNING → terminal RETURNED_TO_BASE). A guarded
   * forward step OFF the happy-path order; non-resurrectable (re-firing against
   * the terminal matches 0 rows). No second cleanup — the refund already ran at
   * beginReturnToBase; the failureReason set at the abort is preserved.
   */
  async completeReturnToBase(deliveryId: string): Promise<boolean> {
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.RETURNING },
      data: { status: DeliveryStatus.RETURNED_TO_BASE },
    });
    if (count === 0) return false;
    await this.announceException(deliveryId, DeliveryStatus.RETURNED_TO_BASE);
    this.logger.log(`Delivery ${deliveryId} → RETURNED_TO_BASE`);
    return true;
  }

  /**
   * ADMIN-only fail — owner-unscoped, mirrors adminForceCancel's 404/409 contract.
   * Caller must enforce the ADMIN role.
   */
  async adminFail(deliveryId: string, reason: DeliveryFailureReason) {
    const applied = await this.failExceptional(deliveryId, reason);
    if (!applied) {
      const existing = await this.prisma.delivery.findFirst({
        where: { id: deliveryId },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException(`Delivery "${deliveryId}" not found`);
      }
      throw new ConflictException(
        `Delivery cannot be failed in "${existing.status}" status.`,
      );
    }
    return this.prisma.delivery.findFirst({
      where: { id: deliveryId },
      include: { tracking: true, payment: true },
    });
  }

  /** Stop the sim, and for a drone-fault release the promo slot + refund credits.
   * Idempotent + best-effort — the same trio cancel/adminForceCancel use. */
  private async cleanupAfterException(
    deliveryId: string,
    refundCredits: boolean,
  ): Promise<void> {
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
      fromLat: src.fromLat ?? undefined,
      fromLng: src.fromLng ?? undefined,
      toLat: src.toLat ?? undefined,
      toLng: src.toLng ?? undefined,
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
      throw new NotFoundException(`Delivery with id "${deliveryId}" not found`);
    }
    if (delivery.status === DeliveryStatus.DELIVERED) {
      throw new ConflictException('This delivery has already been completed.');
    }
    if (delivery.status !== DeliveryStatus.AWAITING_HANDOFF) {
      throw new ConflictException('This delivery is not awaiting handoff yet.');
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
      throw new UnauthorizedException('Invalid handoff code.');
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
      throw new ConflictException('This delivery has already been completed.');
    }

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
    return new HttpException(
      {
        statusCode: HANDOFF_LOCKED,
        error: 'Locked',
        message: 'Too many incorrect attempts — the handoff is locked.',
      },
      HANDOFF_LOCKED,
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

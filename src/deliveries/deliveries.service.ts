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
import { DeliveryStatus, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { GeoService } from '../geo/geo.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { PromoService } from '../promo/promo.service';
import { WalletService } from '../wallet/wallet.service';
import { ProofService } from './proof/proof.service';
import { SimulationService } from './simulation/simulation.service';
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
];

const MAX_HANDOFF_ATTEMPTS = 5;

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

    // When a promo, a credit-spend, or a pending referral reward is in play, the
    // delivery row + those balance mutations commit in ONE transaction — each
    // helper throws to roll the whole thing back on a race (cap loss / insufficient
    // credits), so there's never an orphan delivery or an over-counted code. With
    // none of them, the plain create is unchanged.
    const needsTx = !!promoCode || creditsToApply > 0 || !!pendingReferral;
    const delivery = needsTx
      ? await this.prisma.$transaction(async (tx) => {
          const created = await tx.delivery.create({ data: deliveryData });
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
            await this.walletService.maybeGrantReferralRewardWithinTx(tx, userId);
          }
          return created;
        })
      : await this.prisma.delivery.create({ data: deliveryData });

    // Create the payment (Stripe PaymentIntent) for the discounted total.
    // Best-effort; skipped entirely for a free order (Stripe rejects $0 intents).
    if (Math.round(finalTotal * 100) > 0) {
      try {
        await this.paymentsService.createDeliveryPayment(
          delivery.id,
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

    // Either defer the lifecycle to the pickup window (a single kickoff job) or
    // start it now. Best-effort: a queue/Redis hiccup must not fail creation.
    try {
      if (isScheduled) {
        await this.simulationService.scheduleKickoff(
          delivery.id,
          userId,
          coords,
          scheduledFor!,
        );
      } else {
        await this.simulationService.startSimulation(
          delivery.id,
          userId,
          coords,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to queue ${isScheduled ? 'kickoff' : 'simulation'} for delivery ${delivery.id}: ${(error as Error).message}`,
      );
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
        message: result.reasons[0] ?? 'This delivery cannot be flown right now.',
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
      where.status = DeliveryStatus.DELIVERED;
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

    const [items, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy,
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findOne(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
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
      throw new NotFoundException(
        `Delivery with id "${deliveryId}" not found`,
      );
    }

    return delivery;
  }

  async findByTrackingId(userId: string, trackingId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { trackingId },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
        proofOfDelivery: true,
        rating: true,
      },
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
    return this.prisma.delivery.findMany({
      where: {
        userId,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  async getRecent(userId: string) {
    return this.prisma.delivery.findMany({
      where: {
        userId,
        status: DeliveryStatus.DELIVERED,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
  }

  async cancel(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new NotFoundException(
        `Delivery with id "${deliveryId}" not found`,
      );
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
      where: { id: deliveryId },
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
        status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.CANCELED] },
      },
      data: { status: DeliveryStatus.CANCELED },
    });
    if (count === 0) {
      const existing = await this.prisma.delivery.findUnique({
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
    await this.simulationService.stopSimulation(deliveryId).catch(() => undefined);
    await this.promoService.releaseForDelivery(deliveryId).catch(() => undefined);
    await this.walletService.refundForDelivery(deliveryId).catch(() => undefined);

    return this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { tracking: true, payment: true },
    });
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
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      omit: { handoffCodeHash: false, handoffAttempts: false },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new NotFoundException(
        `Delivery with id "${deliveryId}" not found`,
      );
    }
    if (delivery.status === DeliveryStatus.DELIVERED) {
      throw new ConflictException('This delivery has already been completed.');
    }
    if (delivery.status !== DeliveryStatus.AWAITING_HANDOFF) {
      throw new ConflictException(
        'This delivery is not awaiting handoff yet.',
      );
    }
    if (delivery.handoffAttempts >= MAX_HANDOFF_ATTEMPTS) {
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
      if (count === 0) throw this.handoffLockedError();
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
      await this.proofService.createAutoProof(deliveryId, {
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

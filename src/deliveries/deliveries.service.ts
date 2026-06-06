import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { GeoService } from '../geo/geo.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SimulationService } from './simulation/simulation.service';
import { CreateDeliveryDto, DeliveryQueryDto } from './dto';

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
];

const CANCELABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.CONFIRMED,
];

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationService: SimulationService,
    private readonly geoService: GeoService,
    private readonly pricingService: PricingService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async create(userId: string, dto: CreateDeliveryDto) {
    const trackingId = uuidv4().slice(0, 8).toUpperCase();

    // Resolve pickup/dropoff coordinates so the drone can fly a real route.
    // Uses client-provided coords when present; otherwise geocodes the
    // addresses (best-effort — geocoding failures leave coords undefined).
    const coords = await this.resolveCoords(dto);

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

    const delivery = await this.prisma.delivery.create({
      data: {
        trackingId,
        userId,
        status: DeliveryStatus.PENDING,
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
        estimatedPrice: pricing.total,
      },
    });

    // Create the payment (Stripe PaymentIntent) for the delivery. Best-effort:
    // a payment hiccup must not block the delivery from being created.
    try {
      await this.paymentsService.createDeliveryPayment(
        delivery.id,
        pricing.total,
      );
    } catch (error) {
      this.logger.warn(
        `Payment creation failed for delivery ${delivery.id}: ${(error as Error).message}`,
      );
    }

    // Queue the delivery simulation (auto-progresses PENDING → DELIVERED).
    // Best-effort: a queue/Redis hiccup must not fail delivery creation.
    try {
      await this.simulationService.startSimulation(delivery.id, userId, coords);
    } catch (error) {
      this.logger.warn(
        `Failed to queue simulation for delivery ${delivery.id}: ${(error as Error).message}`,
      );
    }

    return delivery;
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

  async findAll(userId: string, query: DeliveryQueryDto) {
    const where: Prisma.DeliveryWhereInput = { userId };

    if (query.status === 'current') {
      where.status = { in: ACTIVE_STATUSES };
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
        `Delivery cannot be canceled in "${delivery.status}" status. Only PENDING or CONFIRMED deliveries can be canceled.`,
      );
    }

    // Remove the delivery's pending simulation jobs (best-effort).
    try {
      await this.simulationService.stopSimulation(deliveryId);
    } catch {
      // The processor also guards on CANCELED status, so this is non-fatal.
    }

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.CANCELED },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
        proofOfDelivery: true,
      },
    });
  }
}

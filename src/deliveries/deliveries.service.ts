import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../prisma/prisma.service';
import { SimulationService } from './simulation/simulation.service';
import { CreateDeliveryDto, DeliveryQueryDto } from './dto';

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

const SIZE_FEE: Record<string, number> = {
  Small: 3,
  Medium: 6,
  Large: 10,
  XL: 16,
};

const TYPE_FEE: Record<string, number> = {
  fragile: 2,
  electronics: 2,
  food: 1,
  healthcare: 1,
};

const BASE_FEE = 2;
const WEIGHT_MULTIPLIER = 3;

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationService: SimulationService,
  ) {}

  async create(userId: string, dto: CreateDeliveryDto) {
    const trackingId = uuidv4().slice(0, 8).toUpperCase();

    const sizeFee = SIZE_FEE[dto.packageSize] ?? 0;
    const weightFee = dto.packageWeight * WEIGHT_MULTIPLIER;
    const typeFee = dto.packageTypes.reduce(
      (sum, type) => sum + (TYPE_FEE[type] ?? 0),
      0,
    );
    const estimatedPrice = BASE_FEE + sizeFee + weightFee + typeFee;

    const delivery = await this.prisma.delivery.create({
      data: {
        trackingId,
        userId,
        status: DeliveryStatus.PENDING,
        fromAddress: dto.fromAddress,
        toAddress: dto.toAddress,
        fromLat: dto.fromLat,
        fromLng: dto.fromLng,
        toLat: dto.toLat,
        toLng: dto.toLng,
        receiver: dto.receiver,
        packages: dto.packages,
        packageSize: dto.packageSize,
        packageWeight: dto.packageWeight,
        packageTypes: dto.packageTypes,
        pickupDate: new Date(dto.pickupDate),
        pickupTime: dto.pickupTime,
        estimatedPrice: Math.round(estimatedPrice * 100) / 100,
      },
    });

    // Start the delivery simulation (auto-progresses PENDING → DELIVERED)
    this.simulationService.startSimulation(delivery.id, userId, {
      fromLat: dto.fromLat,
      fromLng: dto.fromLng,
      toLat: dto.toLat,
      toLng: dto.toLng,
    });

    return delivery;
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
      },
    });

    if (!delivery || delivery.userId !== userId) {
      throw new NotFoundException(
        `Delivery with id "${deliveryId}" not found`,
      );
    }

    return delivery;
  }

  async findByTrackingId(trackingId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { trackingId },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
      },
    });

    if (!delivery) {
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

    // Stop the running simulation
    this.simulationService.stopSimulation(deliveryId);

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.CANCELED },
      include: {
        tracking: true,
        workflowSteps: true,
        payment: true,
      },
    });
  }
}

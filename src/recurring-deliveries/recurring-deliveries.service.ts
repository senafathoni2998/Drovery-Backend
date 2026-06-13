import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecurringDelivery } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateRecurringDeliveryDto, RecurringQueryDto } from './dto';
import { RecurrenceRule, computeNextOccurrence } from './recurrence';

@Injectable()
export class RecurringDeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRecurringDeliveryDto) {
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate.');
    }

    let daysOfWeek: number[] = [];
    if (dto.freq === 'WEEKLY') {
      daysOfWeek = [...new Set(dto.daysOfWeek ?? [])].sort((a, b) => a - b);
      if (daysOfWeek.length === 0) {
        throw new BadRequestException(
          'WEEKLY schedules require at least one day in daysOfWeek.',
        );
      }
    }
    // DAILY ignores daysOfWeek (kept empty).

    const nextRunAt = computeNextOccurrence(
      { freq: dto.freq, daysOfWeek, timeOfDay: dto.timeOfDay, startDate, endDate },
      new Date(),
    );
    if (!nextRunAt) {
      throw new BadRequestException(
        'This schedule produces no future occurrence (check the time, days, and end date).',
      );
    }

    return this.prisma.recurringDelivery.create({
      data: {
        userId,
        freq: dto.freq,
        daysOfWeek,
        timeOfDay: dto.timeOfDay,
        startDate,
        endDate,
        nextRunAt,
        fromAddress: dto.fromAddress,
        toAddress: dto.toAddress,
        fromLat: dto.fromLat ?? null,
        fromLng: dto.fromLng ?? null,
        toLat: dto.toLat ?? null,
        toLng: dto.toLng ?? null,
        receiver: dto.receiver,
        packages: dto.packages,
        packageSize: dto.packageSize,
        packageWeight: dto.packageWeight,
        packageTypes: dto.packageTypes,
      },
    });
  }

  async findAll(userId: string, query: RecurringQueryDto) {
    const where = {
      userId,
      ...(query.active !== undefined ? { active: query.active } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.recurringDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.recurringDelivery.count({ where }),
    ]);
    return { items, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async findOne(userId: string, id: string) {
    const row = await this.prisma.recurringDelivery.findFirst({
      where: { id, userId },
    });
    if (!row) {
      throw new NotFoundException(`Recurring delivery "${id}" not found`);
    }
    return row;
  }

  /** Pause future materialization (idempotent). Does not touch nextRunAt or any
   * already-materialized SCHEDULED deliveries. */
  async pause(userId: string, id: string) {
    const { count } = await this.prisma.recurringDelivery.updateMany({
      where: { id, userId },
      data: { active: false },
    });
    if (count === 0) {
      throw new NotFoundException(`Recurring delivery "${id}" not found`);
    }
    return this.findOne(userId, id);
  }

  /** Resume, recomputing nextRunAt from NOW so a long pause never backfills. */
  async resume(userId: string, id: string) {
    const row = await this.findOne(userId, id); // 404 if not owned
    const next = computeNextOccurrence(this.toRule(row), new Date());
    if (!next) {
      throw new BadRequestException('This recurrence has already ended.');
    }
    await this.prisma.recurringDelivery.updateMany({
      where: { id, userId },
      data: { active: true, nextRunAt: next },
    });
    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.recurringDelivery.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException(`Recurring delivery "${id}" not found`);
    }
  }

  private toRule(row: RecurringDelivery): RecurrenceRule {
    return {
      freq: row.freq,
      daysOfWeek: row.daysOfWeek,
      timeOfDay: row.timeOfDay,
      startDate: row.startDate,
      endDate: row.endDate,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { RecurringDelivery } from '@prisma/client';

import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/exceptions/app-exception';
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
      throw new AppBadRequestException('error.recurring.end_before_start');
    }

    let daysOfWeek: number[] = [];
    if (dto.freq === 'WEEKLY') {
      daysOfWeek = [...new Set(dto.daysOfWeek ?? [])].sort((a, b) => a - b);
      if (daysOfWeek.length === 0) {
        throw new AppBadRequestException('error.recurring.weekly_needs_days');
      }
    }
    // DAILY ignores daysOfWeek (kept empty).

    const nextRunAt = computeNextOccurrence(
      {
        freq: dto.freq,
        daysOfWeek,
        timeOfDay: dto.timeOfDay,
        startDate,
        endDate,
      },
      new Date(),
    );
    if (!nextRunAt) {
      throw new AppBadRequestException('error.recurring.no_future_occurrence');
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
    const active = query.activeFilter;
    const where = {
      userId,
      ...(active !== undefined ? { active } : {}),
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
      throw new AppNotFoundException('error.recurring.not_found', { id });
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
      throw new AppNotFoundException('error.recurring.not_found', { id });
    }
    return this.findOne(userId, id);
  }

  /** Resume, recomputing nextRunAt from NOW so a long pause never backfills. */
  async resume(userId: string, id: string) {
    const row = await this.findOne(userId, id); // 404 if not owned
    const next = computeNextOccurrence(this.toRule(row), new Date());
    if (!next) {
      throw new AppBadRequestException('error.recurring.already_ended');
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
      throw new AppNotFoundException('error.recurring.not_found', { id });
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

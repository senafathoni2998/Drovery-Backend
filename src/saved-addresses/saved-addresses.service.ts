import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSavedAddressDto, UpdateSavedAddressDto } from './dto';

const MAX_ADDRESSES_PER_USER = 20;
const RECENT_LIMIT = 5;
const COORD_PRECISION = 4; // ~11 m — round coords when deduping recents

export interface RecentAddress {
  address: string;
  lat: number | null;
  lng: number | null;
  type: 'from' | 'to';
  usedAt: Date;
}

@Injectable()
export class SavedAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geoService: GeoService,
  ) {}

  /** A user's saved addresses, default first. */
  findAll(userId: string) {
    return this.prisma.savedAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const address = await this.prisma.savedAddress.findUnique({
      where: { id },
    });
    if (!address || address.userId !== userId) {
      throw new NotFoundException(`Saved address with id "${id}" not found`);
    }
    return address;
  }

  async create(userId: string, dto: CreateSavedAddressDto) {
    const count = await this.prisma.savedAddress.count({ where: { userId } });
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BadRequestException(
        `You can save at most ${MAX_ADDRESSES_PER_USER} addresses.`,
      );
    }

    const { lat, lng } = await this.resolveCoords(dto.address, dto.lat, dto.lng);
    // The first saved address is the default; otherwise honor the flag.
    const isDefault = count === 0 ? true : (dto.isDefault ?? false);

    const data = { userId, label: dto.label, address: dto.address, lat, lng };

    if (!isDefault) {
      return this.prisma.savedAddress.create({ data: { ...data, isDefault: false } });
    }
    // Atomic: clear any prior default, then create this one as the default.
    const [, created] = await this.prisma.$transaction([
      this.prisma.savedAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.savedAddress.create({ data: { ...data, isDefault: true } }),
    ]);
    return created;
  }

  async update(userId: string, id: string, dto: UpdateSavedAddressDto) {
    const existing = await this.findOne(userId, id); // owner-scoped 404

    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;

    if (dto.address !== undefined && dto.address !== existing.address) {
      data.address = dto.address;
      // Re-geocode unless the client supplied fresh coords with the edit.
      if (dto.lat === undefined || dto.lng === undefined) {
        const geo = await this.geoService.geocode(dto.address);
        if (geo) {
          data.lat = geo.lat;
          data.lng = geo.lng;
        }
      }
    }

    if (dto.isDefault === true) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.savedAddress.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        }),
        this.prisma.savedAddress.update({
          where: { id },
          data: { ...data, isDefault: true },
        }),
      ]);
      return updated;
    }

    return this.prisma.savedAddress.update({ where: { id }, data });
  }

  async setDefault(userId: string, id: string) {
    await this.findOne(userId, id); // owner-scoped 404
    const [, updated] = await this.prisma.$transaction([
      this.prisma.savedAddress.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.savedAddress.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    return updated;
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id); // owner-scoped 404
    await this.prisma.savedAddress.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Recently-used addresses, derived from the user's delivery history (NOT the
   * saved-address table). Deduped by address text (+ rounded coords when both
   * are present), newest first, capped. The stored coords are passed through so
   * a client prefilling from these skips re-geocoding.
   */
  async getRecent(userId: string): Promise<RecentAddress[]> {
    const deliveries = await this.prisma.delivery.findMany({
      where: { userId },
      select: {
        fromAddress: true,
        fromLat: true,
        fromLng: true,
        toAddress: true,
        toLat: true,
        toLng: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const seen = new Set<string>();
    const recents: RecentAddress[] = [];

    for (const d of deliveries) {
      for (const side of ['from', 'to'] as const) {
        const address = side === 'from' ? d.fromAddress : d.toAddress;
        if (!address) continue;
        const lat = side === 'from' ? d.fromLat : d.toLat;
        const lng = side === 'from' ? d.fromLng : d.toLng;
        const key = this.dedupeKey(address, lat, lng);
        if (seen.has(key)) continue;
        seen.add(key);
        recents.push({ address, lat, lng, type: side, usedAt: d.createdAt });
        if (recents.length >= RECENT_LIMIT) return recents;
      }
    }
    return recents;
  }

  private async resolveCoords(
    address: string,
    lat?: number,
    lng?: number,
  ): Promise<{ lat: number | null; lng: number | null }> {
    if (lat != null && lng != null) return { lat, lng };
    const geo = await this.geoService.geocode(address);
    return geo ? { lat: geo.lat, lng: geo.lng } : { lat: null, lng: null };
  }

  private dedupeKey(
    address: string,
    lat: number | null,
    lng: number | null,
  ): string {
    if (lat != null && lng != null) {
      return `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
    }
    return address.trim().toLowerCase();
  }
}

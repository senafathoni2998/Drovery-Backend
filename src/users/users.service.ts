import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';

import { AppNotFoundException } from '../common/exceptions/app-exception';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto';

// /users/me is read on nearly every authenticated app interaction, so cache it to keep
// that load off the DB at scale. The short TTL bounds staleness for the rarer change paths
// (admin role change, email-verify); the self-update path invalidates explicitly for
// immediacy. Safe to cache: the response (UserResponseDto) is stable profile data only —
// no balance, no Stripe id — and the role here is display-only (the authoritative gate is
// the DB-resolved RolesGuard, which never reads this cache).
const PROFILE_TTL_S = 60;
const profileKey = (userId: string) => `user:profile:${userId}`;

type CachedProfile = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getProfile(userId: string): Promise<CachedProfile> {
    const key = profileKey(userId);
    // A cached value round-trips through JSON, so Date columns come back as ISO strings —
    // harmless here: the only consumer is UserResponseDto (which re-serializes them to the
    // same ISO strings) + truthy existence checks. No caller does date arithmetic on this.
    const cached = await this.cache.get<CachedProfile>(key);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      // The profile read never needs the password hash — omit it so it can't be exposed
      // or cached in Redis.
      omit: { passwordHash: true },
    });

    if (!user) {
      throw new AppNotFoundException('error.user.not_found');
    }

    await this.cache.set(key, user, PROFILE_TTL_S);
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Ensure the user exists before updating (served from cache when warm).
    await this.getProfile(userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });

    // Invalidate so the next GET /users/me reflects the change immediately.
    await this.cache.del(profileKey(userId));
    return updated;
  }

  async getStats(userId: string) {
    // Ensure the user exists before querying stats
    await this.getProfile(userId);

    // Dashboard stats — lag-tolerant → read replica (falls back to primary).
    const [total, active, completed] = await this.prisma.readWithFallback((c) =>
      Promise.all([
        c.delivery.count({
          where: { userId },
        }),
        c.delivery.count({
          where: {
            userId,
            status: {
              in: [
                'PENDING',
                'CONFIRMED',
                'DRONE_ASSIGNED',
                'PICKUP_IN_PROGRESS',
                'IN_TRANSIT',
                'AWAITING_HANDOFF',
              ],
            },
          },
        }),
        c.delivery.count({
          where: {
            userId,
            status: 'DELIVERED',
          },
        }),
      ]),
    );

    return { total, active, completed };
  }
}

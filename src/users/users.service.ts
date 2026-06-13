import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Ensure the user exists before updating
    await this.getProfile(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
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

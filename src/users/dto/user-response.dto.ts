import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  // The user's own role — exposed so a client (e.g. the admin console) can render
  // role-appropriate UI. The authoritative gate remains the server-side RolesGuard.
  @ApiProperty({ enum: Role })
  role: Role;
  phone: string | null;
  address: string | null;
  bio: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  // Exposed so the client can mirror the server's chosen language (the locale that
  // drives server-emitted notifications/emails). Defaults to 'en'.
  locale: string;
  createdAt: Date;

  static from(user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    phone: string | null;
    address: string | null;
    bio: string | null;
    avatarUrl: string | null;
    emailVerified?: boolean;
    emailVerifiedAt?: Date | null;
    locale?: string;
    createdAt: Date;
  }): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.name = user.name;
    dto.role = user.role;
    dto.phone = user.phone;
    dto.address = user.address;
    dto.bio = user.bio;
    dto.avatarUrl = user.avatarUrl;
    dto.emailVerified = user.emailVerified ?? false;
    dto.emailVerifiedAt = user.emailVerifiedAt ?? null;
    dto.locale = user.locale ?? 'en';
    dto.createdAt = user.createdAt;
    return dto;
  }
}

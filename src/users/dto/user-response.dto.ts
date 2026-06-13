export class UserResponseDto {
  id: string;
  email: string;
  name: string;
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

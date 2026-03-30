export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;

  static from(user: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    address: string | null;
    bio: string | null;
    avatarUrl: string | null;
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
    dto.createdAt = user.createdAt;
    return dto;
  }
}

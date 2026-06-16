import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto, UserResponseDto } from './dto';
import { UserStatsDto } from './dto/user-stats-response.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async getProfile(@CurrentUser('sub') userId: string) {
    const user = await this.usersService.getProfile(userId);
    return UserResponseDto.from(user);
  }

  @Patch('me')
  @ApiOkResponse({ type: UserResponseDto })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.usersService.updateProfile(userId, dto);
    return UserResponseDto.from(user);
  }

  @Get('me/stats')
  @ApiOkResponse({ type: UserStatsDto })
  async getStats(@CurrentUser('sub') userId: string) {
    return this.usersService.getStats(userId);
  }
}

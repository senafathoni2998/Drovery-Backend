import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RegisterDeviceDto, UpdateNotificationPreferencesDto } from './dto';
import {
  DeviceResponseDto,
  MarkAllReadResultDto,
  NotificationPreferenceDto,
  NotificationResponseDto,
  UnreadCountDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: [NotificationResponseDto] })
  findAll(@CurrentUser('sub') userId: string) {
    return this.notificationsService.findAll(userId);
  }

  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountDto })
  getUnreadCount(@CurrentUser('sub') userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Get('preferences')
  @ApiOkResponse({ type: NotificationPreferenceDto })
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOkResponse({ type: NotificationPreferenceDto })
  updatePreferences(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }

  @Patch(':id/read')
  @ApiOkResponse({ type: NotificationResponseDto })
  markAsRead(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.notificationsService.markAsRead(userId, id);
  }

  @Patch('read-all')
  @ApiOkResponse({ type: MarkAllReadResultDto })
  markAllAsRead(@CurrentUser('sub') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Post('devices')
  @ApiCreatedResponse({ type: DeviceResponseDto })
  registerDevice(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(userId, dto);
  }
}

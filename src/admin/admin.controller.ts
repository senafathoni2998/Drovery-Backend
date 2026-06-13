import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AdminService } from './admin.service';
import {
  AdminDeliveryQueryDto,
  AdminUserQueryDto,
  CreatePromoDto,
  FailDeliveryDto,
  RefundDto,
  SetRoleDto,
  UpdatePromoDto,
} from './dto/admin.dto';

// Operator surface — admins only.
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.getOverview();
  }

  // ── Deliveries ──
  @Get('deliveries')
  listDeliveries(@Query() query: AdminDeliveryQueryDto) {
    return this.admin.listDeliveries(query);
  }

  @Get('deliveries/:id')
  getDelivery(@Param('id') id: string) {
    return this.admin.getDelivery(id);
  }

  @Post('deliveries/:id/force-cancel')
  forceCancel(@Param('id') id: string) {
    return this.admin.forceCancel(id);
  }

  @Post('deliveries/:id/fail')
  fail(@Param('id') id: string, @Body() dto: FailDeliveryDto) {
    return this.admin.fail(id, dto.reason);
  }

  @Post('deliveries/:id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.admin.refund(id, dto.amount);
  }

  // ── Promo codes ──
  @Get('promos')
  listPromos(@Query() query: PaginationDto) {
    return this.admin.listPromos(query);
  }

  @Post('promos')
  createPromo(@Body() dto: CreatePromoDto) {
    return this.admin.createPromo(dto);
  }

  @Get('promos/:id')
  getPromo(@Param('id') id: string) {
    return this.admin.getPromo(id);
  }

  @Patch('promos/:id')
  updatePromo(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    return this.admin.updatePromo(id, dto);
  }

  // ── Users / roles ──
  @Get('users')
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/role')
  setRole(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: SetRoleDto,
  ) {
    return this.admin.setRole(adminId, id, dto.role);
  }
}

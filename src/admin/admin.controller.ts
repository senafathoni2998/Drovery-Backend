import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
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
  IssueCommandDto,
  RefundDto,
  SetRoleDto,
  UpdatePromoDto,
} from './dto/admin.dto';
import {
  AdminDeliveryResponseDto,
  AdminOverviewDto,
  AdminPaginatedDeliveriesDto,
  AdminPaginatedPromosDto,
  AdminPaginatedUsersDto,
  AdminRefundResponseDto,
  AdminUserRoleDto,
  DroneCommandResponseDto,
  PromoResponseDto,
} from './dto/admin-response.dto';

// Operator surface — admins only.
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOkResponse({ type: AdminOverviewDto })
  overview() {
    return this.admin.getOverview();
  }

  // ── Deliveries ──
  @Get('deliveries')
  @ApiOkResponse({ type: AdminPaginatedDeliveriesDto })
  listDeliveries(@Query() query: AdminDeliveryQueryDto) {
    return this.admin.listDeliveries(query);
  }

  @Get('deliveries/:id')
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  getDelivery(@Param('id') id: string) {
    return this.admin.getDelivery(id);
  }

  @Post('deliveries/:id/force-cancel')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  forceCancel(@Param('id') id: string) {
    return this.admin.forceCancel(id);
  }

  @Post('deliveries/:id/fail')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  fail(@Param('id') id: string, @Body() dto: FailDeliveryDto) {
    return this.admin.fail(id, dto.reason);
  }

  @Post('deliveries/:id/refund')
  @ApiCreatedResponse({ type: AdminRefundResponseDto })
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.admin.refund(id, dto.amount);
  }

  // ── Drone commands (backend → drone) ──
  @Post('deliveries/:id/commands')
  @ApiCreatedResponse({ type: DroneCommandResponseDto })
  issueCommand(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: IssueCommandDto,
  ) {
    return this.admin.issueDroneCommand(adminId, id, dto);
  }

  @Get('deliveries/:id/commands')
  @ApiOkResponse({ type: [DroneCommandResponseDto] })
  listCommands(@Param('id') id: string) {
    return this.admin.listDroneCommands(id);
  }

  // ── Promo codes ──
  @Get('promos')
  @ApiOkResponse({ type: AdminPaginatedPromosDto })
  listPromos(@Query() query: PaginationDto) {
    return this.admin.listPromos(query);
  }

  @Post('promos')
  @ApiCreatedResponse({ type: PromoResponseDto })
  createPromo(@Body() dto: CreatePromoDto) {
    return this.admin.createPromo(dto);
  }

  @Get('promos/:id')
  @ApiOkResponse({ type: PromoResponseDto })
  getPromo(@Param('id') id: string) {
    return this.admin.getPromo(id);
  }

  @Patch('promos/:id')
  @ApiOkResponse({ type: PromoResponseDto })
  updatePromo(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    return this.admin.updatePromo(id, dto);
  }

  // ── Users / roles ──
  @Get('users')
  @ApiOkResponse({ type: AdminPaginatedUsersDto })
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/role')
  @ApiOkResponse({ type: AdminUserRoleDto })
  setRole(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: SetRoleDto,
  ) {
    return this.admin.setRole(adminId, id, dto.role);
  }
}

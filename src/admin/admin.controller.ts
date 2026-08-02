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
  AdminDroneQueryDto,
  AdminUserQueryDto,
  CreateDroneDto,
  CreatePromoDto,
  FailDeliveryDto,
  IssueCommandDto,
  RefundDto,
  SetRoleDto,
  UpdateDroneDto,
  UpdatePromoDto,
} from './dto/admin.dto';
import { AuditActor } from './audit/audit-actor.decorator';
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

  // These three ground aircraft and move money, so they are recorded against the
  // operator who called them. @AuditActor assembles that operator from the request in
  // one tested place — see the decorator for why it is not two @CurrentUser reads.
  @Post('deliveries/:id/force-cancel')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  forceCancel(@AuditActor() actor: AuditActor, @Param('id') id: string) {
    return this.admin.forceCancel(actor, id);
  }

  @Post('deliveries/:id/fail')
  @ApiCreatedResponse({ type: AdminDeliveryResponseDto })
  fail(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: FailDeliveryDto,
  ) {
    return this.admin.fail(actor, id, dto.reason);
  }

  @Post('deliveries/:id/refund')
  @ApiCreatedResponse({ type: AdminRefundResponseDto })
  refund(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    return this.admin.refund(actor, id, dto.amount);
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

  // ── Fleet ──
  @Get('drones')
  listDrones(@Query() query: AdminDroneQueryDto) {
    return this.admin.listDrones(query);
  }

  @Post('drones')
  createDrone(@AuditActor() actor: AuditActor, @Body() dto: CreateDroneDto) {
    return this.admin.createDrone(actor, dto);
  }

  @Get('drones/:id')
  getDrone(@Param('id') id: string) {
    return this.admin.getDrone(id);
  }

  @Patch('drones/:id')
  updateDrone(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: UpdateDroneDto,
  ) {
    return this.admin.updateDrone(actor, id, dto);
  }

  // ── Promo codes ──
  @Get('promos')
  @ApiOkResponse({ type: AdminPaginatedPromosDto })
  listPromos(@Query() query: PaginationDto) {
    return this.admin.listPromos(query);
  }

  @Post('promos')
  @ApiCreatedResponse({ type: PromoResponseDto })
  createPromo(@AuditActor() actor: AuditActor, @Body() dto: CreatePromoDto) {
    return this.admin.createPromo(actor, dto);
  }

  @Get('promos/:id')
  @ApiOkResponse({ type: PromoResponseDto })
  getPromo(@Param('id') id: string) {
    return this.admin.getPromo(id);
  }

  @Patch('promos/:id')
  @ApiOkResponse({ type: PromoResponseDto })
  updatePromo(
    @AuditActor() actor: AuditActor,
    @Param('id') id: string,
    @Body() dto: UpdatePromoDto,
  ) {
    return this.admin.updatePromo(actor, id, dto);
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
